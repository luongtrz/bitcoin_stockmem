"""Step 3: Event Tracking (LLM_track).

For each merged event, finds predecessor events in the historical window,
builds event chains (max depth D_MAX), and extracts incremental information
(ΔInfo) — the key metric for quantifying expectation deviation.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

import numpy as np

from config import WINDOW_SIZE, D_MAX, TOP_K_TRACK
from embeddings.bge_m3 import bytes_to_embedding, encode_single, embedding_to_bytes
from embeddings.vector_store import top_k_similar
from llm.gemini_client import GeminiClient
from llm.prompts import TRACK_PROMPT
from llm.response_parser import parse_track_result
from storage.database import get_cursor, query_merged_events_by_date_range

logger = logging.getLogger(__name__)


def _get_window_dates(date: str, window: int) -> tuple[str, str]:
    """Return (start_date, end_date) for the historical window [t-w, t-1]."""
    dt = datetime.strptime(date, "%Y-%m-%d")
    start = (dt - timedelta(days=window)).strftime("%Y-%m-%d")
    end = (dt - timedelta(days=1)).strftime("%Y-%m-%d")
    return start, end


def _build_candidate_pool(
    hist_events: list[dict],
) -> tuple[np.ndarray, list[int]]:
    """Build embedding matrix and ID list from historical events."""
    embeddings = []
    ids = []
    for ev in hist_events:
        if ev.get("embedding"):
            emb = bytes_to_embedding(ev["embedding"])
            embeddings.append(emb)
            ids.append(ev["id"])
    if not embeddings:
        return np.array([]), []
    return np.stack(embeddings), ids


def track_event(
    client: GeminiClient,
    event: dict,
    hist_events: list[dict],
    corpus_matrix: np.ndarray,
    corpus_ids: list[int],
    chain_cache: dict[int, list[dict]],
) -> tuple[int | None, str | None]:
    """Track a single event: find predecessor + extract ΔInfo.

    Args:
        client: Gemini client.
        event: The current merged event dict.
        hist_events: All historical merged events in the window.
        corpus_matrix: Pre-computed embedding matrix for hist_events.
        corpus_ids: IDs corresponding to corpus_matrix rows.
        chain_cache: {event_id: [chain_events]} for reuse.

    Returns:
        (predecessor_id or None, delta_info or None)
    """
    if corpus_matrix.size == 0:
        return None, None

    # Get query embedding
    if event.get("embedding"):
        query_emb = bytes_to_embedding(event["embedding"])
    else:
        query_emb = encode_single(event["description"])

    # Top-K candidate retrieval
    candidates = top_k_similar(query_emb, corpus_matrix, corpus_ids, k=TOP_K_TRACK)
    if not candidates:
        return None, None

    # Build candidate info for LLM
    id_to_event = {ev["id"]: ev for ev in hist_events}
    candidates_info = []
    for cand_id, sim_score in candidates:
        cand = id_to_event.get(cand_id)
        if cand:
            candidates_info.append({
                "id": cand["id"],
                "date": cand["date"],
                "event_group": cand["event_group"],
                "event_type": cand["event_type"],
                "description": cand["description"],
                "similarity": round(sim_score, 3),
            })

    if not candidates_info:
        return None, None

    prompt = TRACK_PROMPT.format(
        window=WINDOW_SIZE,
        current_id=event.get("id", "?"),
        current_date=event["date"],
        current_event_json=json.dumps({
            "event_group": event["event_group"],
            "event_type": event["event_type"],
            "description": event["description"],
        }, ensure_ascii=False),
        candidates_json=json.dumps(candidates_info, ensure_ascii=False),
    )

    try:
        result = client.generate_json(prompt)
        track = parse_track_result(result)
    except Exception as e:
        logger.warning(f"Track LLM failed for event {event.get('id')}: {e}")
        return None, None

    if not track.has_predecessor:
        return None, None

    return track.predecessor_id, track.delta_info


def _build_chain(
    event_id: int,
    id_to_event: dict[int, dict],
    chain_cache: dict[int, list[dict]],
    max_depth: int = D_MAX,
) -> list[dict]:
    """Recursively build event chain by following prev_event_id links."""
    if event_id in chain_cache:
        return chain_cache[event_id]

    chain = []
    current_id = event_id
    for _ in range(max_depth):
        ev = id_to_event.get(current_id)
        if not ev:
            break
        chain.append(ev)
        prev_id = ev.get("prev_event_id")
        if not prev_id:
            break
        # Reuse existing chain
        if prev_id in chain_cache:
            chain.extend(chain_cache[prev_id])
            break
        current_id = prev_id

    chain.reverse()  # oldest first
    chain_cache[event_id] = chain
    return chain


def track_events_for_day(
    client: GeminiClient,
    date: str,
) -> None:
    """Run event tracking for all merged events on a given day.

    Updates the merged_events table with prev_event_id, chain_depth, delta_info.
    """
    # Load today's merged events
    with get_cursor() as cur:
        cur.execute(
            "SELECT * FROM merged_events WHERE date = ? ORDER BY id", (date,)
        )
        today_events = [dict(r) for r in cur.fetchall()]

    if not today_events:
        return

    # Load historical events in window
    start, end = _get_window_dates(date, WINDOW_SIZE)
    hist_events = query_merged_events_by_date_range(start, end)
    if not hist_events:
        logger.info(f"{date}: no historical events in window, skipping tracking")
        return

    corpus_matrix, corpus_ids = _build_candidate_pool(hist_events)
    id_to_event = {ev["id"]: ev for ev in hist_events + today_events}
    chain_cache: dict[int, list[dict]] = {}

    for event in today_events:
        prev_id, delta_info = track_event(
            client, event, hist_events, corpus_matrix, corpus_ids, chain_cache
        )

        # Calculate chain depth
        chain_depth = 0
        if prev_id:
            chain = _build_chain(prev_id, id_to_event, chain_cache)
            chain_depth = min(len(chain), D_MAX)

        # Update DB
        with get_cursor() as cur:
            cur.execute(
                """UPDATE merged_events
                   SET prev_event_id = ?, chain_depth = ?, delta_info = ?
                   WHERE id = ?""",
                (prev_id, chain_depth, delta_info, event["id"]),
            )

        if prev_id:
            logger.debug(
                f"Event {event['id']} -> predecessor {prev_id} (depth {chain_depth})"
            )

    tracked = sum(1 for ev in today_events if ev.get("prev_event_id") is not None)
    logger.info(f"{date}: tracked {len(today_events)} events, {tracked} have predecessors")


def run_tracking(
    client: GeminiClient,
    dates: list[str],
) -> None:
    """Run event tracking for a list of dates (must be in chronological order)."""
    for date in sorted(dates):
        track_events_for_day(client, date)
