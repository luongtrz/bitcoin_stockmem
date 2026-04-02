"""Fetch crypto news from CryptoPanic Developer API v2 (primary) and RSS feeds (fallback).

CryptoPanic Developer tier provides title + description + content.clean.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime

import requests

from config import CRYPTOPANIC_API_KEY

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CryptoPanic API
# ---------------------------------------------------------------------------

CRYPTOPANIC_BASE = "https://cryptopanic.com/api/developer/v2/posts/"


def fetch_cryptopanic(
    currencies: str = "BTC,ETH",
    start_date: str | None = None,
    end_date: str | None = None,
    max_pages: int = 20,
) -> list[dict]:
    """Fetch news from CryptoPanic API.

    Returns list of dicts with keys: date, title, url, source, asset.
    """
    if not CRYPTOPANIC_API_KEY:
        logger.warning("CRYPTOPANIC_API_KEY not set, skipping CryptoPanic")
        return []

    results = []
    params = {
        "auth_token": CRYPTOPANIC_API_KEY,
        "currencies": currencies,
        "kind": "news",
        "public": "true",
    }

    next_url = CRYPTOPANIC_BASE
    for page in range(max_pages):
        try:
            resp = requests.get(next_url, params=params if page == 0 else None, timeout=30)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.warning(f"CryptoPanic page {page} failed: {e}")
            break

        for post in data.get("results", []):
            pub = post.get("published_at", "")[:10]

            # Date filtering
            if start_date and pub < start_date:
                return results  # CryptoPanic returns newest first
            if end_date and pub > end_date:
                continue

            # Determine asset — Developer API v2 uses "instruments"
            instrument_codes = [
                c["code"] for c in post.get("instruments", [])
            ]
            asset = "ALL"
            if "BTC" in instrument_codes and "ETH" not in instrument_codes:
                asset = "BTC"
            elif "ETH" in instrument_codes and "BTC" not in instrument_codes:
                asset = "ETH"

            # Developer tier provides content.clean
            content = post.get("content") or {}
            body = content.get("clean") or post.get("description") or None

            results.append({
                "date": pub,
                "title": post.get("title", ""),
                "url": post.get("original_url") or post.get("url", ""),
                "source": post.get("source", {}).get("title", "cryptopanic"),
                "asset": asset,
                "body": body,
            })

        next_url = data.get("next")
        if not next_url:
            break
        time.sleep(1)  # rate limiting

    logger.info(f"CryptoPanic: fetched {len(results)} articles")
    return results


# ---------------------------------------------------------------------------
# RSS feeds (fallback)
# ---------------------------------------------------------------------------

RSS_FEEDS = [
    ("https://www.coindesk.com/arc/outboundfeeds/rss/", "CoinDesk"),
    ("https://cointelegraph.com/rss", "CoinTelegraph"),
    ("https://www.theblock.co/rss.xml", "The Block"),
]


def fetch_rss(
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict]:
    """Fetch news from RSS feeds."""
    try:
        import feedparser
    except ImportError:
        logger.warning("feedparser not installed, skipping RSS")
        return []

    results = []
    for feed_url, source_name in RSS_FEEDS:
        try:
            feed = feedparser.parse(feed_url)
            for entry in feed.entries:
                # Parse date
                pub = ""
                if hasattr(entry, "published_parsed") and entry.published_parsed:
                    pub = datetime(*entry.published_parsed[:6]).strftime("%Y-%m-%d")
                elif hasattr(entry, "updated_parsed") and entry.updated_parsed:
                    pub = datetime(*entry.updated_parsed[:6]).strftime("%Y-%m-%d")

                if not pub:
                    continue
                if start_date and pub < start_date:
                    continue
                if end_date and pub > end_date:
                    continue

                title = entry.get("title", "")
                # Simple heuristic for asset detection
                title_upper = title.upper()
                if "BITCOIN" in title_upper or "BTC" in title_upper:
                    asset = "BTC"
                elif "ETHEREUM" in title_upper or "ETH" in title_upper:
                    asset = "ETH"
                else:
                    asset = "ALL"

                results.append({
                    "date": pub,
                    "title": title,
                    "url": entry.get("link", ""),
                    "source": source_name,
                    "asset": asset,
                    "body": entry.get("summary", None),
                })
        except Exception as e:
            logger.warning(f"RSS {source_name} failed: {e}")

    logger.info(f"RSS: fetched {len(results)} articles")
    return results


# ---------------------------------------------------------------------------
# Article body scraping
# ---------------------------------------------------------------------------

def scrape_body(url: str) -> str | None:
    """Scrape full article text from a URL using trafilatura."""
    try:
        import trafilatura
        downloaded = trafilatura.fetch_url(url)
        if downloaded:
            return trafilatura.extract(downloaded)
    except Exception as e:
        logger.debug(f"Scrape failed for {url}: {e}")
    return None


def enrich_bodies(articles: list[dict], max_articles: int = 50) -> list[dict]:
    """Scrape full bodies for articles that lack one (up to max_articles)."""
    count = 0
    for article in articles:
        if article.get("body"):
            continue
        if count >= max_articles:
            break
        body = scrape_body(article.get("url", ""))
        if body:
            article["body"] = body
            count += 1
        time.sleep(0.5)  # polite scraping
    logger.info(f"Scraped bodies for {count} articles")
    return articles


# ---------------------------------------------------------------------------
# Combined fetcher
# ---------------------------------------------------------------------------

def fetch_all_news(
    start_date: str,
    end_date: str,
    scrape_bodies: bool = True,
) -> list[dict]:
    """Fetch from CryptoPanic + RSS, dedupe by URL, optionally scrape bodies."""
    cp_news = fetch_cryptopanic(start_date=start_date, end_date=end_date)
    rss_news = fetch_rss(start_date=start_date, end_date=end_date)

    # Deduplicate by URL
    seen_urls = set()
    combined = []
    for article in cp_news + rss_news:
        url = article.get("url", "")
        if url and url in seen_urls:
            continue
        seen_urls.add(url)
        combined.append(article)

    combined.sort(key=lambda x: x["date"])

    if scrape_bodies:
        combined = enrich_bodies(combined)

    logger.info(f"Total unique articles: {len(combined)}")
    return combined
