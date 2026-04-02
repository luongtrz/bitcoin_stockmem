"""Evaluation metrics: Accuracy and Matthews Correlation Coefficient."""

from __future__ import annotations

import math


def accuracy(predictions: list[str], actuals: list[str]) -> float:
    """Standard accuracy: correct / total."""
    if not predictions:
        return 0.0
    correct = sum(1 for p, a in zip(predictions, actuals) if p == a)
    return correct / len(predictions)


def mcc(predictions: list[str], actuals: list[str]) -> float:
    """Matthews Correlation Coefficient for binary classification.

    Treats "up" as positive and "down" as negative.
    MCC = (TP*TN - FP*FN) / sqrt((TP+FP)*(TP+FN)*(TN+FP)*(TN+FN))
    """
    tp = fp = tn = fn = 0
    for pred, actual in zip(predictions, actuals):
        if pred == "up" and actual == "up":
            tp += 1
        elif pred == "up" and actual == "down":
            fp += 1
        elif pred == "down" and actual == "down":
            tn += 1
        elif pred == "down" and actual == "up":
            fn += 1

    denom = math.sqrt(
        (tp + fp) * (tp + fn) * (tn + fp) * (tn + fn)
    )
    if denom == 0:
        return 0.0
    return (tp * tn - fp * fn) / denom


def evaluate(predictions: list[str], actuals: list[str]) -> dict:
    """Compute all metrics and return as a dict."""
    return {
        "accuracy": round(accuracy(predictions, actuals), 4),
        "mcc": round(mcc(predictions, actuals), 4),
        "total": len(predictions),
        "correct": sum(1 for p, a in zip(predictions, actuals) if p == a),
    }
