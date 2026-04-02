"""Event Memory: storage, chain queries, and series construction."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

from storage.database import get_cursor, query_merged_events_by_date_range
from memory.similarity import store_daily_vector

logger = logging.getLogger(__name__)


def get_events_for_date(date: str, asset: str | None = None) -> list[dict]:
    """Get all merged events for a specific date."""
    with get_cursor() as cur:
        if asset:
            cur.execute(
                """SELECT * FROM merged_events
                   WHERE date = ? AND (asset = ? OR asset = 'ALL')
                   ORDER BY id""",
                (date, asset),
            )
        else:
            cur.execute(
                "SELECT * FROM merged_events WHERE date = ? ORDER BY id",
                (date,),
            )
        rows = [dict(r) for r in cur.fetchall()]
    # Parse JSON fields
    for r in rows:
        for field in ("entities", "industries", "extended_attrs", "source_raw_event_ids"):
            if isinstance(r.get(field), str):
                try:
                    r[field] = json.loads(r[field])
                except Exception:
                    pass
    return rows


def get_event_chain(event_id: int, max_depth: int = 5) -> list[dict]:
    """Follow prev_event_id links to build the event chain.

    Returns events in chronological order (oldest first).
    """
    chain = []
    visited = set()
    current_id = event_id

    while current_id and len(chain) < max_depth:
        if current_id in visited:
            break
        visited.add(current_id)

        with get_cursor() as cur:
            cur.execute("SELECT * FROM merged_events WHERE id = ?", (current_id,))
            row = cur.fetchone()

        if not row:
            break
        chain.append(dict(row))
        current_id = row["prev_event_id"]

    chain.reverse()
    return chain


def build_event_series(
    end_date: str,
    window: int,
    asset: str | None = None,
) -> tuple[list[str], list[list[dict]]]:
    """Build an event series for the window [end_date - window, end_date].

    Returns:
        (dates_list, events_per_day) where events_per_day[i] is the list
        of events for dates_list[i].
    """
    end_dt = datetime.strptime(end_date, "%Y-%m-%d")
    dates = []
    for i in range(window, -1, -1):
        d = (end_dt - timedelta(days=i)).strftime("%Y-%m-%d")
        dates.append(d)

    events_per_day = []
    for d in dates:
        events = get_events_for_date(d, asset)
        events_per_day.append(events)

    return dates, events_per_day


def format_series_for_prompt(
    dates: list[str],
    events_per_day: list[list[dict]],
    include_delta_info: bool = True,
) -> str:
    """Format an event series as readable text for LLM prompts."""
    lines = []
    for date, events in zip(dates, events_per_day):
        if not events:
            continue
        lines.append(f"\n=== {date} ===")
        for ev in events:
            lines.append(f"  [{ev['event_group']} / {ev['event_type']}] {ev['description']}")
            if include_delta_info and ev.get("delta_info"):
                lines.append(f"    ΔInfo: {ev['delta_info']}")
    return "\n".join(lines)


def compute_and_store_daily_vectors(date: str, asset: str) -> None:
    """Compute binary vectors for a date and store them."""
    events = get_events_for_date(date, asset)
    if events:
        store_daily_vector(date, asset, events)
