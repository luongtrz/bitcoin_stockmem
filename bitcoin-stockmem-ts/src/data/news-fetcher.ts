/**
 * Fetch crypto news from CryptoPanic Developer API v2 (primary) and RSS feeds (fallback).
 */

import { CRYPTOPANIC_API_KEY } from "../config";

export interface NewsArticle {
  date: string;
  title: string;
  url: string;
  source: string;
  asset: string;
  body: string | null;
}

// ---------------------------------------------------------------------------
// CryptoPanic Developer API v2
// ---------------------------------------------------------------------------

const CRYPTOPANIC_BASE = "https://cryptopanic.com/api/developer/v2/posts/";

export async function fetchCryptoPanic(
  startDate?: string,
  endDate?: string,
  maxPages = 20
): Promise<NewsArticle[]> {
  if (!CRYPTOPANIC_API_KEY) {
    console.warn("CRYPTOPANIC_API_KEY not set, skipping CryptoPanic");
    return [];
  }

  const results: NewsArticle[] = [];
  let nextUrl: string | null =
    `${CRYPTOPANIC_BASE}?auth_token=${CRYPTOPANIC_API_KEY}&currencies=BTC,ETH&kind=news&public=true`;

  for (let page = 0; page < maxPages && nextUrl; page++) {
    try {
      const resp = await fetch(nextUrl);
      if (!resp.ok) {
        console.warn(`CryptoPanic HTTP ${resp.status}: ${resp.statusText}`);
        break;
      }
      const data: any = await resp.json();

      for (const post of data.results ?? []) {
        const pub = (post.published_at ?? "").slice(0, 10);
        if (startDate && pub < startDate) return results; // API returns newest first
        if (endDate && pub > endDate) continue;

        // Developer API v2 uses "instruments" instead of "currencies"
        const instrumentCodes: string[] = (post.instruments ?? []).map(
          (c: any) => c.code
        );
        let asset = "ALL";
        if (instrumentCodes.includes("BTC") && !instrumentCodes.includes("ETH")) asset = "BTC";
        else if (instrumentCodes.includes("ETH") && !instrumentCodes.includes("BTC")) asset = "ETH";

        // Extract body from content.clean (Developer tier provides this)
        const body: string | null = post.content?.clean ?? post.description ?? null;

        results.push({
          date: pub,
          title: post.title ?? "",
          url: post.original_url ?? post.url ?? "",
          source: post.source?.title ?? "cryptopanic",
          asset,
          body,
        });
      }

      nextUrl = data.next ?? null;
      await sleep(600); // respect rate limit (~2 req/sec for Developer)
    } catch (e: any) {
      console.warn(`CryptoPanic page ${page} failed: ${e.message}`);
      break;
    }
  }

  console.log(`CryptoPanic: fetched ${results.length} articles`);
  return results;
}

// ---------------------------------------------------------------------------
// RSS feeds (fallback)
// ---------------------------------------------------------------------------

const RSS_FEEDS = [
  { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", source: "CoinDesk" },
  { url: "https://cointelegraph.com/rss", source: "CoinTelegraph" },
  { url: "https://www.theblock.co/rss.xml", source: "The Block" },
];

export async function fetchRss(
  startDate?: string,
  endDate?: string
): Promise<NewsArticle[]> {
  let Parser: any;
  try {
    Parser = (await import("rss-parser")).default;
  } catch {
    console.warn("rss-parser not available, skipping RSS");
    return [];
  }

  const parser = new Parser();
  const results: NewsArticle[] = [];

  for (const feed of RSS_FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const item of parsed.items ?? []) {
        const pub = item.isoDate?.slice(0, 10) ?? item.pubDate?.slice(0, 10) ?? "";
        if (!pub) continue;
        if (startDate && pub < startDate) continue;
        if (endDate && pub > endDate) continue;

        const titleUpper = (item.title ?? "").toUpperCase();
        let asset = "ALL";
        if (titleUpper.includes("BITCOIN") || titleUpper.includes("BTC")) asset = "BTC";
        else if (titleUpper.includes("ETHEREUM") || titleUpper.includes("ETH")) asset = "ETH";

        results.push({
          date: pub,
          title: item.title ?? "",
          url: item.link ?? "",
          source: feed.source,
          asset,
          body: item.contentSnippet ?? null,
        });
      }
    } catch (e: any) {
      console.warn(`RSS ${feed.source} failed: ${e.message}`);
    }
  }

  console.log(`RSS: fetched ${results.length} articles`);
  return results;
}

// ---------------------------------------------------------------------------
// Combined
// ---------------------------------------------------------------------------

export async function fetchAllNews(
  startDate: string,
  endDate: string
): Promise<NewsArticle[]> {
  const [cpNews, rssNews] = await Promise.all([
    fetchCryptoPanic(startDate, endDate),
    fetchRss(startDate, endDate),
  ]);

  // Deduplicate by URL
  const seen = new Set<string>();
  const combined: NewsArticle[] = [];
  for (const article of [...cpNews, ...rssNews]) {
    if (article.url && seen.has(article.url)) continue;
    if (article.url) seen.add(article.url);
    combined.push(article);
  }

  combined.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`Total unique articles: ${combined.length}`);
  return combined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
