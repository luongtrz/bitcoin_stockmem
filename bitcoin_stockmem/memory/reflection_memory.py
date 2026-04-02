"""Reflection Memory: storage and retrieval of causal experience knowledge."""

from __future__ import annotations

import json
import logging

from storage.database import get_cursor, insert_reflection, query_reflections_by_ids

logger = logging.getLogger(__name__)


def store_reflection(
    date: str,
    asset: str,
    window_start: str,
    window_end: str,
    price_direction: str,
    reason: str,
    key_events: str | list,
    price_change_pct: float | None = None,
    source: str = "train",
) -> int:
    """Store a reflection in the database.

    Returns the reflection ID.
    """
    return insert_reflection({
        "date": date,
        "asset": asset,
        "window_start": window_start,
        "window_end": window_end,
        "price_direction": price_direction,
        "price_change_pct": price_change_pct,
        "reason": reason,
        "key_events": key_events if isinstance(key_events, list) else [key_events],
        "source": source,
    })


def get_reflections_for_date(date: str, asset: str) -> list[dict]:
    """Get all reflections where the window ends on the given date."""
    with get_cursor() as cur:
        cur.execute(
            """SELECT * FROM reflections
               WHERE date = ? AND asset = ?
               ORDER BY id""",
            (date, asset),
        )
        return [dict(r) for r in cur.fetchall()]


def get_reflections_for_date_range(
    start_date: str, end_date: str, asset: str | None = None
) -> list[dict]:
    """Get reflections within a date range."""
    with get_cursor() as cur:
        if asset:
            cur.execute(
                """SELECT * FROM reflections
                   WHERE date >= ? AND date <= ? AND asset = ?
                   ORDER BY date, id""",
                (start_date, end_date, asset),
            )
        else:
            cur.execute(
                """SELECT * FROM reflections
                   WHERE date >= ? AND date <= ?
                   ORDER BY date, id""",
                (start_date, end_date),
            )
        return [dict(r) for r in cur.fetchall()]


def get_reflection_by_window(
    window_end: str, asset: str
) -> dict | None:
    """Get a specific reflection by its window end date and asset."""
    with get_cursor() as cur:
        cur.execute(
            """SELECT * FROM reflections
               WHERE window_end = ? AND asset = ?
               ORDER BY id DESC LIMIT 1""",
            (window_end, asset),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def format_reflections_for_prompt(reflections: list[dict]) -> str:
    """Format reflections as readable text for LLM prompts."""
    if not reflections:
        return "No historical reference experience available."

    lines = []
    for i, ref in enumerate(reflections):
        lines.append(f"\n--- Historical Reference {i + 1} ---")
        lines.append(f"Period: {ref.get('window_start', '?')} to {ref.get('window_end', '?')}")
        lines.append(f"Actual price movement: {ref.get('price_direction', '?')}")
        lines.append(f"Analysis: {ref.get('reason', 'N/A')}")
        key_events = ref.get("key_events", "")
        if isinstance(key_events, str):
            try:
                key_events = json.loads(key_events)
            except Exception:
                pass
        if isinstance(key_events, list):
            lines.append(f"Key events: {'; '.join(str(e) for e in key_events)}")
        else:
            lines.append(f"Key events: {key_events}")
    return "\n".join(lines)
