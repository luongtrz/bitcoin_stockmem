"""BGE-M3 embedding wrapper using sentence-transformers.

Loads the model once (on GPU if available) and provides batch encoding.
Falls back to a lightweight model when no GPU is detected.
"""

from __future__ import annotations

import logging

import numpy as np
import torch

from config import EMBEDDING_MODEL, EMBEDDING_FALLBACK

logger = logging.getLogger(__name__)

_model = None
_model_name_loaded: str | None = None


def _get_model():
    """Lazy-load the sentence-transformer model."""
    global _model, _model_name_loaded
    if _model is not None:
        return _model

    from sentence_transformers import SentenceTransformer

    has_gpu = torch.cuda.is_available()
    model_name = EMBEDDING_MODEL if has_gpu else EMBEDDING_FALLBACK
    device = "cuda" if has_gpu else "cpu"

    logger.info(f"Loading embedding model {model_name} on {device}")
    _model = SentenceTransformer(model_name, device=device)
    _model_name_loaded = model_name
    return _model


def encode(texts: list[str], batch_size: int = 64) -> np.ndarray:
    """Encode a list of texts into embedding vectors.

    Args:
        texts: List of strings to encode.
        batch_size: Batch size for encoding.

    Returns:
        numpy array of shape (len(texts), embedding_dim).
    """
    if not texts:
        return np.array([])
    model = _get_model()
    embeddings = model.encode(
        texts,
        batch_size=batch_size,
        show_progress_bar=False,
        normalize_embeddings=True,  # L2 normalise for cosine similarity
    )
    return np.array(embeddings, dtype=np.float32)


def encode_single(text: str) -> np.ndarray:
    """Encode a single text string."""
    return encode([text])[0]


def embedding_to_bytes(embedding: np.ndarray) -> bytes:
    """Serialise a numpy embedding for SQLite BLOB storage."""
    return embedding.astype(np.float32).tobytes()


def bytes_to_embedding(data: bytes, dim: int | None = None) -> np.ndarray:
    """Deserialise a BLOB back to a numpy vector."""
    arr = np.frombuffer(data, dtype=np.float32)
    return arr
