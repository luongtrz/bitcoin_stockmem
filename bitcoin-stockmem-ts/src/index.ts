/**
 * Bitcoin StockMem — Main entry point.
 *
 * Usage:
 *   npx tsx src/index.ts
 *   npx tsx src/index.ts --train-start 2025-01-01 --train-end 2025-03-31 \
 *                        --test-start 2025-04-01 --test-end 2025-06-30
 */

import "dotenv/config";

import { ASSETS } from "./config";
import { GeminiClient } from "./llm/gemini-client";
import { getDb } from "./storage/database";
import { fetchDailyOhlcv } from "./data/price-fetcher";
import { fetchAllNews, type NewsArticle } from "./data/news-fetcher";
import { generateLabels, filterTradableDays, type LabelledRow } from "./data/label-generator";
import { buildEventMemory, buildReflectionMemory, runBacktest } from "./evaluation/backtest";
import { shutdown as shutdownEmbed } from "./embeddings/bge-m3";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, def: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : def;
  };
  return {
    trainStart: get("--train-start", "2026-03-25"),
    trainEnd: get("--train-end", "2026-03-31"),
    testStart: get("--test-start", "2026-04-01"),
    testEnd: get("--test-end", "2026-04-01"),
  };
}

function groupByDate(articles: NewsArticle[]): Record<string, NewsArticle[]> {
  const map: Record<string, NewsArticle[]> = {};
  for (const a of articles) {
    (map[a.date] ??= []).push(a);
  }
  return map;
}

async function main() {
  const { trainStart, trainEnd, testStart, testEnd } = parseArgs();

  console.log("=== Bitcoin StockMem Pipeline ===");
  console.log(`Train: ${trainStart} -> ${trainEnd}`);
  console.log(`Test:  ${testStart} -> ${testEnd}`);

  // Init
  getDb();
  const client = new GeminiClient();

  // ---------------------------------------------------------------
  // 1. Data Collection
  // ---------------------------------------------------------------
  console.log("\n=== Phase 1: Data Collection ===");

  const prices: Record<string, LabelledRow[]> = {};
  for (const asset of ASSETS) {
    const raw = await fetchDailyOhlcv(asset, trainStart, testEnd);
    const labelled = generateLabels(raw);
    prices[asset] = labelled;
    const up = labelled.filter((r) => r.label === "up").length;
    const down = labelled.filter((r) => r.label === "down").length;
    console.log(`${asset}: ${labelled.length} days (up=${up}, down=${down})`);
  }

  const allNews = await fetchAllNews(trainStart, testEnd);
  const newsByDate = groupByDate(allNews);
  console.log(`Total articles: ${allNews.length}, days with news: ${Object.keys(newsByDate).length}`);

  const trainDates = Object.keys(newsByDate).filter((d) => d >= trainStart && d <= trainEnd).sort();
  const testDates = Object.keys(newsByDate).filter((d) => d >= testStart && d <= testEnd).sort();

  const trainLabels: Record<string, LabelledRow[]> = {};
  const testLabels: Record<string, LabelledRow[]> = {};
  for (const asset of ASSETS) {
    trainLabels[asset] = filterTradableDays(
      prices[asset].filter((r) => r.date >= trainStart && r.date <= trainEnd)
    );
    testLabels[asset] = filterTradableDays(
      prices[asset].filter((r) => r.date >= testStart && r.date <= testEnd)
    );
  }

  // ---------------------------------------------------------------
  // 2. Build Event Memory (Training)
  // ---------------------------------------------------------------
  console.log("\n=== Phase 2: Building Event Memory ===");
  const trainNews: Record<string, NewsArticle[]> = {};
  for (const d of trainDates) trainNews[d] = newsByDate[d] ?? [];
  await buildEventMemory(client, trainNews, trainDates);

  // ---------------------------------------------------------------
  // 3. Build Reflection Memory (Training)
  // ---------------------------------------------------------------
  console.log("\n=== Phase 3: Building Reflection Memory ===");
  await buildReflectionMemory(client, trainLabels);

  // ---------------------------------------------------------------
  // 4. Backtest (Test with Online Learning)
  // ---------------------------------------------------------------
  console.log("\n=== Phase 4: Running Backtest ===");
  const testNews: Record<string, NewsArticle[]> = {};
  for (const d of testDates) testNews[d] = newsByDate[d] ?? [];
  const results = await runBacktest(client, testNews, testLabels, testDates);

  // ---------------------------------------------------------------
  // 5. Report
  // ---------------------------------------------------------------
  console.log("\n=== Final Results ===");
  console.table(
    Object.entries(results).map(([asset, m]) => ({
      Asset: asset,
      Accuracy: m.accuracy,
      MCC: m.mcc,
      Total: m.total,
      Correct: m.correct,
    }))
  );

  shutdownEmbed();
  console.log("Done.");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
