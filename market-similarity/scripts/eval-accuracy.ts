/**
 * Evaluate search accuracy.
 *
 * For each market day, run a similarity search and check whether
 * the top-K results share the same sentiment category:
 *   bullish  (pct_change > 1)
 *   bearish  (pct_change < -1)
 *   neutral  (-1 <= pct_change <= 1)
 *
 * Reports: category-match accuracy, avg pct_change delta, rank-weighted scores.
 */

import "dotenv/config";
import {
  getDb,
  closeDb,
  getAllMarketDays,
  getAllMarketDayVectors,
  getMarketDayById,
} from "../src/storage/database.ts";
import { reindexAll } from "../src/vectorizer.ts";
import {
  buildHybridVector,
  loadNormStats,
} from "../src/vectorizer.ts";
import { bufferToEmbedding, shutdown } from "../src/embeddings/embed.ts";
import { topKSimilar } from "../src/search.ts";
import { W_NUM, W_TEXT } from "../src/config.ts";
import type { MarketDayInput } from "../src/types.ts";

function category(pct: number): string {
  if (pct > 1) return "bullish";
  if (pct < -1) return "bearish";
  return "neutral";
}

async function main() {
  getDb();

  // Reindex with TS embeddings
  console.log("Reindexing all vectors with TS embeddings...");
  const reindexed = await reindexAll(W_NUM, W_TEXT);
  console.log(`Reindexed ${reindexed} records\n`);

  const rows = getAllMarketDays();
  const stats = loadNormStats();
  const K = 5;

  // Pre-load all vectors
  const allVecs = getAllMarketDayVectors();
  const vecMap = new Map(allVecs.map((v) => [v.id, bufferToEmbedding(v.hybrid_vector)]));
  const corpus = allVecs.map((v) => bufferToEmbedding(v.hybrid_vector));
  const corpusIds = allVecs.map((v) => v.id);

  let totalQueries = 0;
  let categoryMatches = 0;      // top-1 category match
  let categoryMatchesTopK = 0;  // majority of top-K match
  let pctDeltas: number[] = [];
  let armDeltas: number[] = [];
  let selfFound = 0;

  // Sample every 3rd day to keep runtime reasonable
  const sampleIndices: number[] = [];
  for (let i = 0; i < rows.length; i += 3) sampleIndices.push(i);

  console.log(`Testing ${sampleIndices.length} queries (every 3rd day, K=${K})...\n`);

  for (const idx of sampleIndices) {
    const row = rows[idx];
    const factors: number[] =
      typeof row.factor_array === "string"
        ? JSON.parse(row.factor_array)
        : row.factor_array;

    const input: MarketDayInput = {
      date: row.date,
      price: row.price,
      arm: row.arm,
      srm: row.srm,
      factor_array: factors,
      pct_change: row.pct_change,
      text_summary: row.text_summary,
    };

    const queryVec = await buildHybridVector(input, stats, W_NUM, W_TEXT);

    // Search (exclude self)
    const results = topKSimilar(queryVec, corpus, corpusIds, K + 1)
      .filter((r) => r.id !== row.id)
      .slice(0, K);

    totalQueries++;
    const queryCat = category(row.pct_change);

    // Top-1 accuracy
    const top1Row = getMarketDayById(results[0].id)!;
    if (category(top1Row.pct_change) === queryCat) categoryMatches++;

    // Top-K majority
    let catCount = 0;
    for (const r of results) {
      const rRow = getMarketDayById(r.id)!;
      if (category(rRow.pct_change) === queryCat) catCount++;
      pctDeltas.push(Math.abs(rRow.pct_change - row.pct_change));
      armDeltas.push(Math.abs(rRow.arm - row.arm));
    }
    if (catCount > K / 2) categoryMatchesTopK++;

    // Self-retrieval check (should be rank 1 with score ~1.0)
    const selfResults = topKSimilar(queryVec, corpus, corpusIds, 1);
    if (selfResults[0]?.id === row.id) selfFound++;
  }

  // Compute stats
  const avgPctDelta = pctDeltas.reduce((a, b) => a + b, 0) / pctDeltas.length;
  const avgArmDelta = armDeltas.reduce((a, b) => a + b, 0) / armDeltas.length;

  // Category distribution
  const catDist = { bullish: 0, bearish: 0, neutral: 0 };
  for (const row of rows) catDist[category(row.pct_change) as keyof typeof catDist]++;

  console.log("═══════════════════════════════════════════");
  console.log("           EVALUATION RESULTS");
  console.log("═══════════════════════════════════════════");
  console.log(`Dataset:              ${rows.length} days`);
  console.log(`Queries tested:       ${totalQueries}`);
  console.log(`Category distribution: bullish=${catDist.bullish} bearish=${catDist.bearish} neutral=${catDist.neutral}`);
  console.log(`Random baseline:      ${Math.round(Math.max(catDist.bullish, catDist.bearish, catDist.neutral) / rows.length * 100)}% (majority class)`);
  console.log("───────────────────────────────────────────");
  console.log(`Self-retrieval:       ${selfFound}/${totalQueries} (${(selfFound / totalQueries * 100).toFixed(1)}%)`);
  console.log(`Top-1 category match: ${categoryMatches}/${totalQueries} (${(categoryMatches / totalQueries * 100).toFixed(1)}%)`);
  console.log(`Top-K majority match: ${categoryMatchesTopK}/${totalQueries} (${(categoryMatchesTopK / totalQueries * 100).toFixed(1)}%)`);
  console.log(`Avg |Δpct_change|:    ${avgPctDelta.toFixed(3)}%`);
  console.log(`Avg |ΔARM|:           ${avgArmDelta.toFixed(3)}`);
  console.log("═══════════════════════════════════════════");

  shutdown();
  closeDb();
}

main().catch((err) => {
  console.error("Error:", err);
  shutdown();
  closeDb();
  process.exit(1);
});
