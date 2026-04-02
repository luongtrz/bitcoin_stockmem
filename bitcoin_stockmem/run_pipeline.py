"""Main orchestrator: end-to-end StockMem pipeline for Bitcoin/ETH.

Usage:
    python run_pipeline.py --train-start 2025-01-01 --train-end 2025-03-31 \
                           --test-start 2025-04-01 --test-end 2025-06-30

Or import and call run_full_pipeline() from a Colab notebook.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import defaultdict

import pandas as pd

from config import ASSETS
from data.label_generator import generate_labels, filter_tradable_days
from data.news_fetcher import fetch_all_news
from data.price_fetcher import fetch_daily_ohlcv
from evaluation.backtest import (
    build_event_memory,
    build_reflection_memory,
    run_backtest,
)
from llm.gemini_client import GeminiClient
from storage.database import get_connection

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def _group_news_by_date(news: list[dict]) -> dict[str, list[dict]]:
    groups = defaultdict(list)
    for a in news:
        groups[a["date"]].append(a)
    return dict(groups)


def run_full_pipeline(
    train_start: str = "2025-01-01",
    train_end: str = "2025-03-31",
    test_start: str = "2025-04-01",
    test_end: str = "2025-06-30",
) -> dict:
    """Run the complete StockMem pipeline.

    Returns:
        Dict with results per asset.
    """
    # Initialise DB
    get_connection()

    # Initialise Gemini
    client = GeminiClient()

    # ---------------------------------------------------------------
    # 1. Fetch data
    # ---------------------------------------------------------------
    logger.info("=== Phase 1: Data Collection ===")

    # Prices
    prices = {}
    labels = {}
    for asset in ASSETS:
        df = fetch_daily_ohlcv(asset, train_start, test_end)
        df = generate_labels(df)
        prices[asset] = df
        logger.info(f"{asset}: {len(df)} days fetched")

    # News
    all_news = fetch_all_news(train_start, test_end, scrape_bodies=True)
    news_by_date = _group_news_by_date(all_news)
    logger.info(f"Total news articles: {len(all_news)}")

    # Split dates
    train_dates = sorted(
        d for d in news_by_date.keys() if train_start <= d <= train_end
    )
    test_dates = sorted(
        d for d in news_by_date.keys() if test_start <= d <= test_end
    )

    # Split labels
    train_labels = {}
    test_labels = {}
    for asset, df in prices.items():
        train_df = df[(df["date"] >= train_start) & (df["date"] <= train_end)]
        test_df = df[(df["date"] >= test_start) & (df["date"] <= test_end)]
        train_labels[asset] = filter_tradable_days(train_df)
        test_labels[asset] = filter_tradable_days(test_df)

    # ---------------------------------------------------------------
    # 2. Build Event Memory (training period)
    # ---------------------------------------------------------------
    logger.info("=== Phase 2: Building Event Memory (Training) ===")
    train_news = {d: news_by_date[d] for d in train_dates if d in news_by_date}
    build_event_memory(client, train_news, train_dates)

    # ---------------------------------------------------------------
    # 3. Build Reflection Memory (training period)
    # ---------------------------------------------------------------
    logger.info("=== Phase 3: Building Reflection Memory (Training) ===")
    build_reflection_memory(client, train_labels)

    # ---------------------------------------------------------------
    # 4. Run Backtest (test period with online learning)
    # ---------------------------------------------------------------
    logger.info("=== Phase 4: Running Backtest ===")
    test_news = {d: news_by_date[d] for d in test_dates if d in news_by_date}
    results = run_backtest(client, test_news, test_labels, test_dates)

    # ---------------------------------------------------------------
    # 5. Report
    # ---------------------------------------------------------------
    logger.info("=== Final Results ===")
    for asset, metrics in results.items():
        logger.info(
            f"{asset}: ACC={metrics['accuracy']}, MCC={metrics['mcc']}, "
            f"Total={metrics['total']}, Correct={metrics['correct']}"
        )

    return results


def main():
    parser = argparse.ArgumentParser(description="Bitcoin StockMem Pipeline")
    parser.add_argument("--train-start", default="2025-01-01")
    parser.add_argument("--train-end", default="2025-03-31")
    parser.add_argument("--test-start", default="2025-04-01")
    parser.add_argument("--test-end", default="2025-06-30")
    args = parser.parse_args()

    results = run_full_pipeline(
        train_start=args.train_start,
        train_end=args.train_end,
        test_start=args.test_start,
        test_end=args.test_end,
    )
    return results


if __name__ == "__main__":
    main()
