"""Step 4: Reflection Generation (LLM_reason).

Generates causal analysis linking event sequences to actual price movements.
Used during training and online learning (after test predictions are resolved).
"""

from __future__ import annotations

import logging

from config import WINDOW_SIZE
from llm.gemini_client import GeminiClient
from llm.prompts import REASON_PROMPT
from llm.response_parser import parse_reason_result
from memory.event_memory import build_event_series, format_series_for_prompt
from memory.reflection_memory import store_reflection

logger = logging.getLogger(__name__)


def generate_reflection(
    client: GeminiClient,
    date: str,
    asset: str,
    price_direction: str,
    price_change_pct: float | None = None,
    source: str = "train",
) -> int | None:
    """Generate a reflection for a given date and store it.

    Args:
        client: Gemini client.
        date: The analysis date (end of event window; prediction targets date+1).
        asset: "BTC" or "ETH".
        price_direction: Actual direction ("up" or "down").
        price_change_pct: Actual return percentage.
        source: "train" or "online".

    Returns:
        Reflection ID or None on failure.
    """
    # Build event series
    dates, events_per_day = build_event_series(date, WINDOW_SIZE, asset)
    information = format_series_for_prompt(dates, events_per_day, include_delta_info=True)

    if not information.strip():
        logger.warning(f"No events found for reflection on {date}/{asset}")
        return None

    prompt = REASON_PROMPT.format(
        asset=asset,
        information=information,
        price_change=price_direction,
    )

    try:
        result = client.generate_json(prompt)
        parsed = parse_reason_result(result)
    except Exception as e:
        logger.warning(f"Reflection generation failed for {date}/{asset}: {e}")
        return None

    # Store reflection
    ref_id = store_reflection(
        date=date,
        asset=asset,
        window_start=dates[0],
        window_end=dates[-1],
        price_direction=price_direction,
        reason=parsed.reason,
        key_events=parsed.key_events,
        price_change_pct=price_change_pct,
        source=source,
    )

    logger.info(f"Reflection {ref_id} stored for {date}/{asset} ({source})")
    return ref_id


def run_reflection_generation(
    client: GeminiClient,
    labels_df,
    asset: str,
    source: str = "train",
) -> list[int]:
    """Generate reflections for all labelled dates.

    Args:
        client: Gemini client.
        labels_df: DataFrame with columns 'date', 'label', 'next_return'.
        asset: "BTC" or "ETH".
        source: "train" or "online".

    Returns:
        List of reflection IDs.
    """
    ids = []
    for _, row in labels_df.iterrows():
        if row["label"] == "flat":
            continue
        ref_id = generate_reflection(
            client,
            date=row["date"],
            asset=asset,
            price_direction=row["label"],
            price_change_pct=row.get("next_return"),
            source=source,
        )
        if ref_id:
            ids.append(ref_id)
    return ids
