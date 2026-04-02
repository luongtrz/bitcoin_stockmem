"""Step 1: Event Extraction (LLM_ext).

Extracts structured events from raw news articles using Gemini.
Batches multiple short articles per LLM call to reduce API usage.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime

from data.taxonomy import format_taxonomy_for_prompt
from embeddings.bge_m3 import encode, embedding_to_bytes
from llm.gemini_client import GeminiClient
from llm.prompts import EXTRACT_PROMPT
from llm.response_parser import parse_extracted_events
from storage.database import insert_raw_events

logger = logging.getLogger(__name__)

BATCH_SIZE = 3  # articles per LLM call


def extract_events_for_day(
    client: GeminiClient,
    articles: list[dict],
    date: str,
) -> list[dict]:
    """Extract events from a day's news articles.

    Args:
        client: Gemini client instance.
        articles: List of article dicts with 'title', 'body', 'url', etc.
        date: The date string (YYYY-MM-DD).

    Returns:
        List of raw event dicts (ready for DB insertion).
    """
    if not articles:
        return []

    groups_str, type_list_str = format_taxonomy_for_prompt()
    all_events = []

    # Process in batches
    for i in range(0, len(articles), BATCH_SIZE):
        batch = articles[i:i + BATCH_SIZE]

        # Format articles for prompt
        articles_text = ""
        news_id_map = {}  # track which article produced which events
        for idx, art in enumerate(batch):
            body = art.get("body") or art.get("title", "")
            articles_text += f"\n--- Article {idx + 1} (source: {art.get('source', 'unknown')}) ---\n"
            articles_text += f"Title: {art['title']}\n"
            if body != art["title"]:
                articles_text += f"Content: {body[:2000]}\n"  # truncate long articles
            news_id_map[idx] = art.get("news_id")

        prompt = EXTRACT_PROMPT.format(
            groups=groups_str,
            type_list=type_list_str,
            articles=articles_text,
        )

        try:
            result = client.generate_json(prompt)
            if not isinstance(result, list):
                result = [result]
            events = parse_extracted_events(result)
        except Exception as e:
            logger.warning(f"Event extraction failed for batch starting at {i}: {e}")
            continue

        for ev in events:
            all_events.append({
                "news_id": batch[0].get("news_id"),  # approximate mapping
                "date": date,
                "asset": batch[0].get("asset", "ALL"),
                "event_group": ev.event_group,
                "event_type": ev.event_type,
                "time": ev.time,
                "location": ev.location,
                "entities": ev.entities,
                "industries": ev.industries,
                "description": ev.description,
                "extended_attrs": ev.extended_attrs,
            })

    # Compute embeddings
    if all_events:
        descriptions = [e["description"] for e in all_events]
        embeddings = encode(descriptions)
        for ev, emb in zip(all_events, embeddings):
            ev["embedding"] = embedding_to_bytes(emb)

    logger.info(f"Extracted {len(all_events)} events for {date}")
    return all_events


def run_extraction(
    client: GeminiClient,
    news_by_date: dict[str, list[dict]],
) -> dict[str, list[int]]:
    """Run event extraction for multiple dates.

    Args:
        client: Gemini client.
        news_by_date: {date_str: [article_dicts]}.

    Returns:
        {date_str: [raw_event_ids]}.
    """
    result = {}
    for date in sorted(news_by_date.keys()):
        articles = news_by_date[date]
        events = extract_events_for_day(client, articles, date)
        if events:
            ids = insert_raw_events(events)
            result[date] = ids
            logger.info(f"{date}: inserted {len(ids)} raw events")
        else:
            result[date] = []
    return result
