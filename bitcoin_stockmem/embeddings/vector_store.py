"""Lightweight numpy-based cosine similarity search over embeddings."""

from __future__ import annotations

import numpy as np


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two 1-D vectors (assumed L2-normalised)."""
    return float(np.dot(a, b))


def cosine_similarity_matrix(
    queries: np.ndarray, corpus: np.ndarray
) -> np.ndarray:
    """Cosine similarity between every query and every corpus vector.

    Args:
        queries: (Q, D) array of query vectors.
        corpus: (C, D) array of corpus vectors.

    Returns:
        (Q, C) similarity matrix.
    """
    # Both assumed L2-normalised, so cosine = dot product
    return queries @ corpus.T


def top_k_similar(
    query: np.ndarray,
    corpus: np.ndarray,
    corpus_ids: list[int],
    k: int = 10,
) -> list[tuple[int, float]]:
    """Return the top-k most similar corpus items to a query.

    Args:
        query: 1-D embedding vector.
        corpus: (C, D) array of corpus embeddings.
        corpus_ids: List of IDs corresponding to corpus rows.
        k: Number of results.

    Returns:
        List of (id, similarity_score) tuples, sorted descending.
    """
    if corpus.size == 0:
        return []
    sims = corpus @ query  # (C,) — assumes L2-normalised
    k = min(k, len(sims))
    top_indices = np.argpartition(sims, -k)[-k:]
    top_indices = top_indices[np.argsort(sims[top_indices])[::-1]]

    return [(corpus_ids[i], float(sims[i])) for i in top_indices]
