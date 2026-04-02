#!/usr/bin/env python3
"""Minimal Python embedding server for BGE-M3.

Usage:
    echo '["text1", "text2"]' | python embed_server.py
    => outputs JSON array of float arrays (embeddings)

Or run as a persistent stdin/stdout server:
    python embed_server.py --serve
    => reads JSON lines from stdin, writes embedding JSON lines to stdout
"""

import sys
import json
import numpy as np
import torch

def load_model():
    from sentence_transformers import SentenceTransformer
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model_name = "BAAI/bge-m3" if device == "cuda" else "sentence-transformers/all-MiniLM-L6-v2"
    print(f"Loading {model_name} on {device}", file=sys.stderr)
    return SentenceTransformer(model_name, device=device)

def encode(model, texts):
    embeddings = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return embeddings.tolist()

if __name__ == "__main__":
    model = load_model()

    if "--serve" in sys.argv:
        # Persistent mode: read JSON lines from stdin
        print("READY", flush=True)
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                texts = json.loads(line)
                result = encode(model, texts)
                print(json.dumps(result), flush=True)
            except Exception as e:
                print(json.dumps({"error": str(e)}), flush=True)
    else:
        # One-shot mode: read entire stdin
        data = json.loads(sys.stdin.read())
        result = encode(model, data)
        json.dump(result, sys.stdout)
