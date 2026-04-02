"""Fetch daily OHLCV data for BTC and ETH from Binance via ccxt."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

import ccxt
import pandas as pd

from config import TRADING_PAIRS

logger = logging.getLogger(__name__)


def fetch_daily_ohlcv(
    asset: str = "BTC",
    start_date: str = "2025-01-01",
    end_date: str | None = None,
) -> pd.DataFrame:
    """Fetch daily candles from Binance.

    Args:
        asset: "BTC" or "ETH".
        start_date: ISO date string (YYYY-MM-DD).
        end_date: ISO date string; defaults to today.

    Returns:
        DataFrame with columns: date, open, high, low, close, volume, return_pct
    """
    exchange = ccxt.binance({"enableRateLimit": True})
    symbol = TRADING_PAIRS[asset]

    since = exchange.parse8601(f"{start_date}T00:00:00Z")
    end_dt = datetime.fromisoformat(end_date) if end_date else datetime.utcnow()
    end_ts = int(end_dt.timestamp() * 1000)

    all_candles = []
    while since < end_ts:
        candles = exchange.fetch_ohlcv(symbol, "1d", since=since, limit=500)
        if not candles:
            break
        all_candles.extend(candles)
        since = candles[-1][0] + 86_400_000  # next day
        if len(candles) < 500:
            break

    df = pd.DataFrame(
        all_candles,
        columns=["timestamp", "open", "high", "low", "close", "volume"],
    )
    df["date"] = pd.to_datetime(df["timestamp"], unit="ms").dt.strftime("%Y-%m-%d")
    df = df[df["date"] <= (end_date or end_dt.strftime("%Y-%m-%d"))]
    df = df.drop_duplicates(subset="date", keep="last").sort_values("date")

    # Daily return
    df["return_pct"] = df["close"].pct_change()
    df = df.reset_index(drop=True)

    logger.info(f"Fetched {len(df)} daily candles for {asset}")
    return df[["date", "open", "high", "low", "close", "volume", "return_pct"]]
