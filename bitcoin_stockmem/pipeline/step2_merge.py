"""Step 2: Event Merging (LLM_merge).

Groups raw events per day by event_group, clusters via vector similarity,
then uses Gemini to merge duplicates and produce unified descriptions.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict

import numpy as np
from sklearn.cluster import AgglomerativeClustering

from config import CLUSTER_DISTANCE_THRESHOLD
from embeddings.bge_m3 import encode, embedding_to_bytes, bytes_to_embedding
from llm.gemini_client import GeminiClient
from llm.prompts import MERGE_PROMPT
from llm.response_parser import parse_merged_events
from storage.database import get_cursor, insert_merged_events

logger = logging.getLogger(__name__)


def _load_raw_events_for_date(date: str) -> list[dict]:
    """Load raw events for a given date from DB."""
    with get_cursor() as cur:
        cur.execute(
            "SELECT * FROM raw_events WHERE date = ? ORDER BY id", (date,)
        )
        return [dict(r) for r in cur.fetchall()]


def _cluster_events(events: list[dict]) -> list[list[dict]]:
    """Cluster events by embedding similarity using agglomerative clustering.

    Returns list of clusters, each cluster is a list of event dicts.
    """
    if len(events) <= 1:
        return [events] if events else []

    # Build embedding matrix
    embeddings = []
    for ev in events:
        if ev.get("embedding"):
            emb = bytes_to_embedding(ev["embedding"])
            embeddings.append(emb)
        else:
            embeddings.append(np.zeros(1024, dtype=np.float32))  # fallback

    X = np.stack(embeddings)

    # Agglomerative clustering with cosine distance
    try:
        clustering = AgglomerativeClustering(
            n_clusters=None,
            distance_threshold=CLUSTER_DISTANCE_THRESHOLD,
            metric="cosine",
            linkage="average",
        )
        labels = clustering.fit_predict(X)
    except Exception:
        # Fallback: treat each event as its own cluster
        labels = list(range(len(events)))

    clusters: dict[int, list[dict]] = defaultdict(list)
    for ev, label in zip(events, labels):
        clusters[label].append(ev)

    return list(clusters.values())


def merge_events_for_day(
    client: GeminiClient,
    date: str,
) -> list[dict]:
    """Merge raw events for one day.

    Process:
      1. Load raw events from DB.
      2. Group by event_group.
      3. Cluster within each group (vector similarity).
      4. For multi-event clusters, call LLM to merge.
      5. Store merged events in DB.

    Returns:
        List of merged event dicts.
    """
    raw_events = _load_raw_events_for_date(date)
    if not raw_events:
        return []

    # Group by event_group
    by_group: dict[str, list[dict]] = defaultdict(list)
    for ev in raw_events:
        by_group[ev["event_group"]].append(ev)

    all_merged = []

    for group, group_events in by_group.items():
        clusters = _cluster_events(group_events)

        for cluster in clusters:
            if len(cluster) == 1:
                # Single event — no merging needed, promote directly
                ev = cluster[0]
                all_merged.append({
                    "date": date,
                    "asset": ev.get("asset", "ALL"),
                    "event_group": ev["event_group"],
                    "event_type": ev["event_type"],
                    "time": ev.get("time"),
                    "location": ev.get("location"),
                    "entities": json.loads(ev["entities"]) if isinstance(ev["entities"], str) else ev.get("entities", []),
                    "industries": json.loads(ev["industries"]) if isinstance(ev["industries"], str) else ev.get("industries", []),
                    "description": ev["description"],
                    "extended_attrs": json.loads(ev["extended_attrs"]) if isinstance(ev["extended_attrs"], str) else ev.get("extended_attrs", {}),
                    "source_raw_event_ids": [ev["id"]],
                })
            else:
                # Multi-event cluster — call LLM to merge
                cluster_json = json.dumps([
                    {
                        "id": ev["id"],
                        "event_group": ev["event_group"],
                        "event_type": ev["event_type"],
                        "description": ev["description"],
                        "entities": json.loads(ev["entities"]) if isinstance(ev["entities"], str) else ev.get("entities", []),
                    }
                    for ev in cluster
                ], ensure_ascii=False)

                prompt = MERGE_PROMPT.format(
                    date=date,
                    cluster_events_json=cluster_json,
                )

                try:
                    result = client.generate_json(prompt)
                    if not isinstance(result, list):
                        result = [result]
                    merged_list = parse_merged_events(result)
                except Exception as e:
                    logger.warning(f"Merge LLM failed for cluster in {group} on {date}: {e}")
                    # Fallback: keep first event
                    ev = cluster[0]
                    merged_list = []
                    all_merged.append({
                        "date": date,
                        "asset": ev.get("asset", "ALL"),
                        "event_group": ev["event_group"],
                        "event_type": ev["event_type"],
                        "time": ev.get("time"),
                        "location": ev.get("location"),
                        "entities": json.loads(ev["entities"]) if isinstance(ev["entities"], str) else ev.get("entities", []),
                        "industries": json.loads(ev["industries"]) if isinstance(ev["industries"], str) else ev.get("industries", []),
                        "description": ev["description"],
                        "source_raw_event_ids": [e["id"] for e in cluster],
                    })
                    continue

                for m in merged_list:
                    all_merged.append({
                        "date": date,
                        "asset": cluster[0].get("asset", "ALL"),
                        "event_group": m.event_group,
                        "event_type": m.event_type,
                        "time": m.time,
                        "location": m.location,
                        "entities": m.entities,
                        "industries": m.industries,
                        "description": m.description,
                        "source_raw_event_ids": m.source_event_ids,
                    })

    # Compute embeddings for merged events
    if all_merged:
        descriptions = [e["description"] for e in all_merged]
        embeddings = encode(descriptions)
        for ev, emb in zip(all_merged, embeddings):
            ev["embedding"] = embedding_to_bytes(emb)

    # Insert into DB
    if all_merged:
        ids = insert_merged_events(all_merged)
        logger.info(f"{date}: merged {len(raw_events)} raw -> {len(all_merged)} events")

    return all_merged


def run_merging(
    client: GeminiClient,
    dates: list[str],
) -> None:
    """Run event merging for a list of dates."""
    for date in sorted(dates):
        merge_events_for_day(client, date)
