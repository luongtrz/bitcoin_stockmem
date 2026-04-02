"""Step 5: Historical Sequence Retrieval.

Two-stage retrieval:
  1. Coarse: Jaccard-based SeqSim over binary event vectors.
  2. Fine: LLM_retrieve filters candidates to genuine references.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

from config import WINDOW_SIZE, TOP_K_RETRIEVE
from llm.gemini_client import GeminiClient
from llm.prompts import RETRIEVE_PROMPT
from llm.response_parser import parse_retrieve_result
from memory.event_memory import (
    build_event_series, format_series_for_prompt, compute_and_store_daily_vectors,
)
from memory.reflection_memory import (
    get_reflection_by_window, format_reflections_for_prompt,
)
from memory.similarity import find_top_k_sequences
from storage.database import get_cursor

logger = logging.getLogger(__name__)


def _get_all_available_dates(before_date: str, asset: str) -> list[str]:
    """Get all dates that have merged events, before the given date."""
    with get_cursor() as cur:
        cur.execute(
            """SELECT DISTINCT date FROM merged_events
               WHERE date < ? AND (asset = ? OR asset = 'ALL')
               ORDER BY date""",
            (before_date, asset),
        )
        return [row["date"] for row in cur.fetchall()]


def retrieve_references(
    client: GeminiClient,
    date: str,
    asset: str,
) -> tuple[list[dict], list[int]]:
    """Retrieve historically similar event sequences and their reflections.

    Args:
        client: Gemini client.
        date: Current date (end of query window).
        asset: "BTC" or "ETH".

    Returns:
        (reflections_list, reflection_ids) for the selected references.
    """
    # Ensure daily vectors are computed
    end_dt = datetime.strptime(date, "%Y-%m-%d")
    current_dates = []
    for i in range(WINDOW_SIZE, -1, -1):
        d = (end_dt - timedelta(days=i)).strftime("%Y-%m-%d")
        compute_and_store_daily_vectors(d, asset)
        current_dates.append(d)

    # Also ensure historical vectors exist
    all_hist_dates = _get_all_available_dates(current_dates[0], asset)
    for d in all_hist_dates:
        compute_and_store_daily_vectors(d, asset)

    if len(all_hist_dates) < WINDOW_SIZE:
        logger.info(f"Not enough history for retrieval on {date}/{asset}")
        return [], []

    # Stage 1: Coarse — Jaccard-based Top-K
    top_sequences = find_top_k_sequences(
        current_dates, all_hist_dates, asset, k=TOP_K_RETRIEVE
    )

    if not top_sequences:
        logger.info(f"No similar sequences found for {date}/{asset}")
        return [], []

    # Build candidate info with their reflections
    current_dates_list, current_events = build_event_series(date, WINDOW_SIZE, asset)
    current_text = format_series_for_prompt(current_dates_list, current_events)

    candidates_text = []
    candidate_reflections = []
    for i, (hist_dates, sim_score) in enumerate(top_sequences):
        ref = get_reflection_by_window(hist_dates[-1], asset)
        if not ref:
            # Try cross-asset matching
            other_asset = "ETH" if asset == "BTC" else "BTC"
            ref = get_reflection_by_window(hist_dates[-1], other_asset)

        candidate_reflections.append(ref)

        hist_dates_list, hist_events = build_event_series(
            hist_dates[-1], WINDOW_SIZE, asset
        )
        hist_text = format_series_for_prompt(hist_dates_list, hist_events)

        entry = f"\n--- Candidate {i} (similarity: {sim_score:.3f}) ---\n"
        entry += f"Period: {hist_dates[0]} to {hist_dates[-1]}\n"
        entry += hist_text
        if ref:
            entry += f"\nOutcome: price went {ref['price_direction']}"
            entry += f"\nAnalysis: {ref['reason'][:300]}"
        candidates_text.append(entry)

    # Stage 2: Fine — LLM filters
    prompt = RETRIEVE_PROMPT.format(
        window=WINDOW_SIZE,
        asset=asset,
        current_series_text=current_text,
        candidates_with_reflections="\n".join(candidates_text),
    )

    try:
        result = client.generate_json(prompt)
        parsed = parse_retrieve_result(result)
        selected_indices = parsed.selected_indices
    except Exception as e:
        logger.warning(f"Retrieval LLM failed for {date}/{asset}: {e}")
        # Fallback: use top-3 by similarity
        selected_indices = list(range(min(3, len(top_sequences))))

    # Collect selected reflections
    selected_reflections = []
    selected_ids = []
    for idx in selected_indices:
        if 0 <= idx < len(candidate_reflections):
            ref = candidate_reflections[idx]
            if ref:
                selected_reflections.append(ref)
                selected_ids.append(ref["id"])

    logger.info(
        f"{date}/{asset}: retrieved {len(selected_reflections)} references "
        f"from {len(top_sequences)} candidates"
    )
    return selected_reflections, selected_ids
