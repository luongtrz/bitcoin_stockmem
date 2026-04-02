"""Jaccard-based similarity computation for event sequences.

Implements the paper's formulas (equations 3-8):
  - TypeSim: Jaccard over type-level binary vectors
  - GroupSim: Jaccard over group-level binary vectors
  - DailySim = alpha * TypeSim + (1 - alpha) * GroupSim
  - SeqSim = average DailySim across aligned window days
"""

from __future__ import annotations

import json
import logging

import numpy as np

from config import ALPHA, WINDOW_SIZE
from data.taxonomy import (
    NUM_TYPES, NUM_GROUPS, TYPE_TO_INDEX, GROUP_TO_INDEX, EVENT_TAXONOMY,
)
from storage.database import get_cursor

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Binary vector construction
# ---------------------------------------------------------------------------

def build_type_vector(event_types: list[str]) -> np.ndarray:
    """Build a binary type-level vector V_t ∈ {0,1}^M."""
    v = np.zeros(NUM_TYPES, dtype=np.int8)
    for t in event_types:
        idx = TYPE_TO_INDEX.get(t)
        if idx is not None:
            v[idx] = 1
    return v


def build_group_vector(event_groups: list[str]) -> np.ndarray:
    """Build a binary group-level vector G_t ∈ {0,1}^G."""
    g = np.zeros(NUM_GROUPS, dtype=np.int8)
    for grp in event_groups:
        idx = GROUP_TO_INDEX.get(grp)
        if idx is not None:
            g[idx] = 1
    return g


def build_daily_vectors_from_events(events: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Build both type and group vectors from a list of event dicts."""
    types = [ev["event_type"] for ev in events]
    groups = [ev["event_group"] for ev in events]
    return build_type_vector(types), build_group_vector(groups)


# ---------------------------------------------------------------------------
# Jaccard similarity
# ---------------------------------------------------------------------------

def jaccard(a: np.ndarray, b: np.ndarray) -> float:
    """Jaccard similarity for binary vectors: |A ∩ B| / |A ∪ B|."""
    intersection = np.sum(a & b)
    union = np.sum(a | b)
    if union == 0:
        return 0.0
    return float(intersection / union)


# ---------------------------------------------------------------------------
# Daily and sequence similarity (paper equations 5-8)
# ---------------------------------------------------------------------------

def daily_sim(
    type_v1: np.ndarray, group_v1: np.ndarray,
    type_v2: np.ndarray, group_v2: np.ndarray,
    alpha: float = ALPHA,
) -> float:
    """DailySim(t_i, t_j) = α·TypeSim + (1-α)·GroupSim."""
    type_sim = jaccard(type_v1, type_v2)
    group_sim = jaccard(group_v1, group_v2)
    return alpha * type_sim + (1 - alpha) * group_sim


def seq_sim(
    series_a: list[tuple[np.ndarray, np.ndarray]],
    series_b: list[tuple[np.ndarray, np.ndarray]],
) -> float:
    """SeqSim: average DailySim across aligned positions.

    Each series is a list of (type_vector, group_vector) tuples,
    ordered chronologically. Both must have the same length.
    """
    if not series_a or not series_b:
        return 0.0

    w = min(len(series_a), len(series_b))
    total = 0.0
    for k in range(w):
        tv_a, gv_a = series_a[-(k + 1)]  # align from the most recent
        tv_b, gv_b = series_b[-(k + 1)]
        total += daily_sim(tv_a, gv_a, tv_b, gv_b)
    return total / w


# ---------------------------------------------------------------------------
# DB helpers for daily vectors
# ---------------------------------------------------------------------------

def store_daily_vector(date: str, asset: str, events: list[dict]) -> None:
    """Compute and store daily vectors in the database."""
    tv, gv = build_daily_vectors_from_events(events)
    with get_cursor() as cur:
        cur.execute(
            """INSERT OR REPLACE INTO daily_vectors
               (date, asset, type_vector, group_vector, event_count)
               VALUES (?, ?, ?, ?, ?)""",
            (date, asset, json.dumps(tv.tolist()), json.dumps(gv.tolist()), len(events)),
        )


def load_daily_vector(date: str, asset: str) -> tuple[np.ndarray, np.ndarray] | None:
    """Load daily vectors from DB. Returns (type_vec, group_vec) or None."""
    with get_cursor() as cur:
        cur.execute(
            "SELECT type_vector, group_vector FROM daily_vectors WHERE date = ? AND asset = ?",
            (date, asset),
        )
        row = cur.fetchone()
    if not row:
        return None
    tv = np.array(json.loads(row["type_vector"]), dtype=np.int8)
    gv = np.array(json.loads(row["group_vector"]), dtype=np.int8)
    return tv, gv


def load_series_vectors(
    dates: list[str], asset: str
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Load a sequence of daily vectors for the given dates."""
    series = []
    for d in dates:
        vecs = load_daily_vector(d, asset)
        if vecs:
            series.append(vecs)
        else:
            # Zero vectors if no data
            series.append(
                (np.zeros(NUM_TYPES, dtype=np.int8), np.zeros(NUM_GROUPS, dtype=np.int8))
            )
    return series


def find_top_k_sequences(
    current_dates: list[str],
    all_history_dates: list[str],
    asset: str,
    k: int = 10,
) -> list[tuple[list[str], float]]:
    """Find top-K most similar historical sequences.

    Args:
        current_dates: Dates in the current window (chronological).
        all_history_dates: All available historical dates.
        asset: Asset to match.
        k: Number of results.

    Returns:
        List of (dates_list, similarity_score) tuples, sorted descending.
    """
    w = len(current_dates)
    if w == 0 or len(all_history_dates) < w:
        return []

    current_series = load_series_vectors(current_dates, asset)

    candidates = []
    for i in range(len(all_history_dates) - w + 1):
        hist_dates = all_history_dates[i:i + w]
        # Don't match overlapping periods
        if hist_dates[-1] >= current_dates[0]:
            continue
        hist_series = load_series_vectors(hist_dates, asset)
        sim = seq_sim(current_series, hist_series)
        candidates.append((hist_dates, sim))

    candidates.sort(key=lambda x: x[1], reverse=True)
    return candidates[:k]
