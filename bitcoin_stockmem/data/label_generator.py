"""Generate up/down/flat labels from daily price returns."""

from __future__ import annotations

import pandas as pd

from config import PRICE_THRESHOLD


def generate_labels(
    prices_df: pd.DataFrame,
    threshold: float | None = None,
) -> pd.DataFrame:
    """Add a 'label' column to a price DataFrame.

    Args:
        prices_df: Must have columns 'date' and 'return_pct'.
        threshold: Override the default ±2% threshold.

    Returns:
        Same DataFrame with added 'label' column ("up", "down", or "flat").
        The label for day t reflects the return from t to t+1.
    """
    thr = threshold or PRICE_THRESHOLD
    df = prices_df.copy()

    # Shift return by -1: label[t] = return from t to t+1
    df["next_return"] = df["return_pct"].shift(-1)

    conditions = [
        df["next_return"] > thr,
        df["next_return"] < -thr,
    ]
    choices = ["up", "down"]
    df["label"] = pd.np.select(conditions, choices, default="flat") if hasattr(pd, "np") else "flat"

    # Use numpy directly for compatibility
    import numpy as np
    df["label"] = np.select(conditions, choices, default="flat")

    return df


def filter_tradable_days(df: pd.DataFrame) -> pd.DataFrame:
    """Remove 'flat' days from evaluation (following the paper)."""
    return df[df["label"] != "flat"].copy()
