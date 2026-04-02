"""SQLite connection manager for Bitcoin StockMem."""

import os
import sqlite3
from contextlib import contextmanager

from storage.schemas import SCHEMA_SQL


_connection: sqlite3.Connection | None = None


def get_connection(db_path: str | None = None) -> sqlite3.Connection:
    """Return (and cache) a SQLite connection, creating the DB if needed."""
    global _connection
    if _connection is not None:
        return _connection

    from config import DB_PATH
    path = db_path or DB_PATH

    os.makedirs(os.path.dirname(path), exist_ok=True)
    _connection = sqlite3.connect(path)
    _connection.row_factory = sqlite3.Row
    _connection.execute("PRAGMA journal_mode=WAL")
    _connection.executescript(SCHEMA_SQL)
    return _connection


@contextmanager
def get_cursor(db_path: str | None = None):
    """Context manager that yields a cursor and commits on success."""
    conn = get_connection(db_path)
    cursor = conn.cursor()
    try:
        yield cursor
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def close():
    """Close the cached connection."""
    global _connection
    if _connection is not None:
        _connection.close()
        _connection = None


# ---------------------------------------------------------------------------
# Convenience helpers
# ---------------------------------------------------------------------------

def insert_raw_news(rows: list[dict]) -> list[int]:
    """Insert news rows and return their ids. Skips duplicates (same url)."""
    ids = []
    with get_cursor() as cur:
        for r in rows:
            cur.execute(
                """INSERT OR IGNORE INTO raw_news
                   (date, source, title, body, url, asset, fetched_at)
                   VALUES (?, ?, ?, ?, ?, ?, datetime('now'))""",
                (r["date"], r.get("source"), r["title"],
                 r.get("body"), r.get("url"), r.get("asset", "ALL")),
            )
            ids.append(cur.lastrowid)
    return ids


def insert_raw_events(rows: list[dict]) -> list[int]:
    """Insert raw event rows."""
    import json
    ids = []
    with get_cursor() as cur:
        for r in rows:
            cur.execute(
                """INSERT INTO raw_events
                   (news_id, date, asset, event_group, event_type, time,
                    location, entities, industries, description,
                    extended_attrs, embedding, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
                (r.get("news_id"), r["date"], r.get("asset", "ALL"),
                 r["event_group"], r["event_type"], r.get("time"),
                 r.get("location"),
                 json.dumps(r.get("entities", []), ensure_ascii=False),
                 json.dumps(r.get("industries", []), ensure_ascii=False),
                 r["description"],
                 json.dumps(r.get("extended_attrs", {}), ensure_ascii=False),
                 r.get("embedding")),
            )
            ids.append(cur.lastrowid)
    return ids


def insert_merged_events(rows: list[dict]) -> list[int]:
    """Insert merged event rows."""
    import json
    ids = []
    with get_cursor() as cur:
        for r in rows:
            cur.execute(
                """INSERT INTO merged_events
                   (date, asset, event_group, event_type, time, location,
                    entities, industries, description, extended_attrs,
                    embedding, source_raw_event_ids, prev_event_id,
                    chain_depth, delta_info, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
                (r["date"], r.get("asset", "ALL"),
                 r["event_group"], r["event_type"], r.get("time"),
                 r.get("location"),
                 json.dumps(r.get("entities", []), ensure_ascii=False),
                 json.dumps(r.get("industries", []), ensure_ascii=False),
                 r["description"],
                 json.dumps(r.get("extended_attrs", {}), ensure_ascii=False),
                 r.get("embedding"),
                 json.dumps(r.get("source_raw_event_ids", []), ensure_ascii=False),
                 r.get("prev_event_id"),
                 r.get("chain_depth", 0),
                 r.get("delta_info")),
            )
            ids.append(cur.lastrowid)
    return ids


def insert_reflection(row: dict) -> int:
    """Insert a reflection row."""
    import json
    with get_cursor() as cur:
        cur.execute(
            """INSERT INTO reflections
               (date, asset, window_start, window_end, price_direction,
                price_change_pct, reason, key_events, source, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
            (row["date"], row["asset"], row["window_start"], row["window_end"],
             row["price_direction"], row.get("price_change_pct"),
             row["reason"],
             json.dumps(row.get("key_events", []), ensure_ascii=False),
             row.get("source", "train")),
        )
        return cur.lastrowid


def insert_prediction(row: dict) -> int:
    """Insert a prediction row."""
    import json
    with get_cursor() as cur:
        cur.execute(
            """INSERT INTO predictions
               (date, asset, predicted_direction, actual_direction, reason,
                reference_reflection_ids, created_at)
               VALUES (?, ?, ?, ?, ?, ?, datetime('now'))""",
            (row["date"], row["asset"], row["predicted_direction"],
             row.get("actual_direction"), row.get("reason"),
             json.dumps(row.get("reference_reflection_ids", []))),
        )
        return cur.lastrowid


def query_merged_events_by_date_range(
    start_date: str, end_date: str, asset: str | None = None
) -> list[dict]:
    """Return merged events in a date range, optionally filtered by asset."""
    with get_cursor() as cur:
        if asset:
            cur.execute(
                """SELECT * FROM merged_events
                   WHERE date >= ? AND date <= ? AND (asset = ? OR asset = 'ALL')
                   ORDER BY date, id""",
                (start_date, end_date, asset),
            )
        else:
            cur.execute(
                """SELECT * FROM merged_events
                   WHERE date >= ? AND date <= ?
                   ORDER BY date, id""",
                (start_date, end_date),
            )
        return [dict(row) for row in cur.fetchall()]


def query_reflections_by_ids(ids: list[int]) -> list[dict]:
    """Return reflections by their ids."""
    if not ids:
        return []
    placeholders = ",".join("?" for _ in ids)
    with get_cursor() as cur:
        cur.execute(
            f"SELECT * FROM reflections WHERE id IN ({placeholders})", ids
        )
        return [dict(row) for row in cur.fetchall()]
