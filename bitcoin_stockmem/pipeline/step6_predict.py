"""Step 6: Final Prediction (LLM_predict).

Synthesises current event sequence + ΔInfo + historical references
to predict the next day's price direction.
"""

from __future__ import annotations

import logging

from config import WINDOW_SIZE
from llm.gemini_client import GeminiClient
from llm.prompts import PREDICT_PROMPT
from llm.response_parser import parse_predict_result
from memory.event_memory import build_event_series, format_series_for_prompt
from memory.reflection_memory import format_reflections_for_prompt
from pipeline.step5_retrieve import retrieve_references
from storage.database import insert_prediction

logger = logging.getLogger(__name__)


def predict(
    client: GeminiClient,
    date: str,
    asset: str,
) -> dict | None:
    """Predict next-day price direction for the given date and asset.

    Args:
        client: Gemini client.
        date: Current date (prediction targets date+1).
        asset: "BTC" or "ETH".

    Returns:
        Dict with 'predicted_direction', 'reason', 'reference_reflection_ids',
        or None on failure.
    """
    # Build current event series
    dates, events_per_day = build_event_series(date, WINDOW_SIZE, asset)
    information = format_series_for_prompt(dates, events_per_day, include_delta_info=True)

    if not information.strip():
        logger.warning(f"No events for prediction on {date}/{asset}")
        return None

    # Retrieve historical references
    reflections, ref_ids = retrieve_references(client, date, asset)
    hist_reflection_text = format_reflections_for_prompt(reflections)

    # Generate prediction
    prompt = PREDICT_PROMPT.format(
        asset=asset,
        information=information,
        hist_reflection=hist_reflection_text,
    )

    try:
        result = client.generate_json(prompt)
        parsed = parse_predict_result(result)
    except Exception as e:
        logger.warning(f"Prediction failed for {date}/{asset}: {e}")
        return None

    direction = parsed.direction.lower().strip()
    if direction not in ("up", "down"):
        direction = "up" if "up" in direction.lower() else "down"

    # Store prediction
    pred_id = insert_prediction({
        "date": date,
        "asset": asset,
        "predicted_direction": direction,
        "reason": parsed.reason,
        "reference_reflection_ids": ref_ids,
    })

    logger.info(f"Prediction {pred_id}: {date}/{asset} -> {direction}")
    return {
        "id": pred_id,
        "date": date,
        "asset": asset,
        "predicted_direction": direction,
        "reason": parsed.reason,
        "reference_reflection_ids": ref_ids,
    }
