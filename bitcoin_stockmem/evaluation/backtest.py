"""Rolling-window backtesting with online learning.

Follows the paper's evaluation protocol:
  - Train on period A (build event + reflection memory).
  - Test on period B, day-by-day in chronological order.
  - After each test prediction, add ground truth + reflection (online learning).
"""

from __future__ import annotations

import logging
from collections import defaultdict

import pandas as pd

from config import ASSETS, WINDOW_SIZE
from evaluation.metrics import evaluate
from llm.gemini_client import GeminiClient
from memory.event_memory import compute_and_store_daily_vectors
from pipeline.step1_extract import extract_events_for_day
from pipeline.step2_merge import merge_events_for_day
from pipeline.step3_track import track_events_for_day
from pipeline.step4_reason import generate_reflection
from pipeline.step6_predict import predict
from storage.database import get_cursor, insert_raw_news

logger = logging.getLogger(__name__)


def _group_news_by_date(news: list[dict]) -> dict[str, list[dict]]:
    groups = defaultdict(list)
    for article in news:
        groups[article["date"]].append(article)
    return dict(groups)


def build_event_memory(
    client: GeminiClient,
    news_by_date: dict[str, list[dict]],
    dates: list[str],
) -> None:
    """Run steps 1-3 (extract, merge, track) for a list of dates."""
    for date in sorted(dates):
        articles = news_by_date.get(date, [])

        # Store news
        if articles:
            insert_raw_news(articles)

        # Step 1: Extract
        events = extract_events_for_day(client, articles, date)
        if events:
            from storage.database import insert_raw_events
            insert_raw_events(events)

        # Step 2: Merge
        merge_events_for_day(client, date)

        # Step 3: Track
        track_events_for_day(client, date)

        # Compute daily vectors for all assets
        for asset in ASSETS:
            compute_and_store_daily_vectors(date, asset)

        logger.info(f"Event memory built for {date}")


def build_reflection_memory(
    client: GeminiClient,
    labels: dict[str, pd.DataFrame],
) -> None:
    """Run step 4 (reflection) for all training labels.

    Args:
        labels: {asset: DataFrame with 'date', 'label', 'next_return'}.
    """
    for asset, df in labels.items():
        for _, row in df.iterrows():
            if row["label"] == "flat":
                continue
            generate_reflection(
                client,
                date=row["date"],
                asset=asset,
                price_direction=row["label"],
                price_change_pct=row.get("next_return"),
                source="train",
            )
        logger.info(f"Reflections built for {asset} training data")


def run_backtest(
    client: GeminiClient,
    test_news_by_date: dict[str, list[dict]],
    test_labels: dict[str, pd.DataFrame],
    test_dates: list[str],
) -> dict[str, dict]:
    """Run the full backtest loop on test data.

    Args:
        client: Gemini client.
        test_news_by_date: {date: [articles]} for test period.
        test_labels: {asset: DataFrame} with test labels.
        test_dates: Sorted list of test dates.

    Returns:
        {asset: {accuracy, mcc, total, correct, predictions}}
    """
    results: dict[str, dict] = {}
    predictions_log: dict[str, list[tuple[str, str]]] = defaultdict(list)

    for date in test_dates:
        # Build event memory for this day
        articles = test_news_by_date.get(date, [])
        if articles:
            insert_raw_news(articles)
            events = extract_events_for_day(client, articles, date)
            if events:
                from storage.database import insert_raw_events
                insert_raw_events(events)

        merge_events_for_day(client, date)
        track_events_for_day(client, date)

        for asset in ASSETS:
            compute_and_store_daily_vectors(date, asset)

        # Predict for each asset
        for asset in ASSETS:
            df = test_labels.get(asset)
            if df is None:
                continue

            day_row = df[df["date"] == date]
            if day_row.empty:
                continue

            actual = day_row.iloc[0]["label"]
            if actual == "flat":
                continue

            # Step 5-6: Retrieve + Predict
            pred = predict(client, date, asset)
            if not pred:
                continue

            predicted = pred["predicted_direction"]
            predictions_log[asset].append((predicted, actual))

            # Update prediction with actual
            with get_cursor() as cur:
                cur.execute(
                    "UPDATE predictions SET actual_direction = ? WHERE id = ?",
                    (actual, pred["id"]),
                )

            # Online learning: generate reflection with true label
            generate_reflection(
                client,
                date=date,
                asset=asset,
                price_direction=actual,
                price_change_pct=day_row.iloc[0].get("next_return"),
                source="online",
            )

            logger.info(
                f"Test {date}/{asset}: predicted={predicted}, actual={actual}"
            )

    # Compute metrics
    for asset in ASSETS:
        preds_actuals = predictions_log.get(asset, [])
        if preds_actuals:
            preds = [p for p, _ in preds_actuals]
            actuals = [a for _, a in preds_actuals]
            metrics = evaluate(preds, actuals)
            metrics["predictions"] = preds_actuals
            results[asset] = metrics
            logger.info(f"{asset} results: ACC={metrics['accuracy']}, MCC={metrics['mcc']}")

    return results
