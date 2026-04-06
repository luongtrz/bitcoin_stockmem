/**
 * Deep evaluation: kiểm tra score có đáng tin không.
 *
 * 1. Score distribution: min/max/mean/median của top-1 và random pairs
 * 2. Discrimination: score giữa ngày bullish↔bullish vs bullish↔bearish
 * 3. Text template overlap: bao nhiêu text embedding gần giống nhau
 * 4. Stress test: query sai lệch (swap text bullish → bearish) có score drop không
 */

import "dotenv/config";
import {
  getDb,
  closeDb,
  getAllMarketDays,
  getAllMarketDayVectors,
  getMarketDayById,
} from "../src/storage/database.ts";
import {
  buildHybridVector,
  loadNormStats,
} from "../src/vectorizer.ts";
import { bufferToEmbedding, encodeSingle, shutdown } from "../src/embeddings/embed.ts";
import { cosineSimilarity, topKSimilar } from "../src/search.ts";
import { W_NUM, W_TEXT } from "../src/config.ts";
import type { MarketDayInput } from "../src/types.ts";

function category(pct: number): string {
  if (pct > 1) return "bullish";
  if (pct < -1) return "bearish";
  return "neutral";
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function stats(arr: number[]) {
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const med = median(arr);
  return { min: +min.toFixed(4), max: +max.toFixed(4), mean: +mean.toFixed(4), median: +med.toFixed(4) };
}

async function main() {
  getDb();

  const rows = getAllMarketDays();
  const normStats = loadNormStats();
  const allVecs = getAllMarketDayVectors();
  const vecMap = new Map(allVecs.map((v) => [v.id, bufferToEmbedding(v.hybrid_vector)]));

  const corpus = allVecs.map((v) => bufferToEmbedding(v.hybrid_vector));
  const corpusIds = allVecs.map((v) => v.id);

  // ──────────────────────────────────────
  // 1. Score distribution
  // ──────────────────────────────────────
  console.log("═══ 1. SCORE DISTRIBUTION ═══\n");

  const top1Scores: number[] = [];
  const top5Scores: number[] = [];
  const randomScores: number[] = [];

  // Sample every 5th day
  for (let i = 0; i < rows.length; i += 5) {
    const row = rows[i];
    const vec = vecMap.get(row.id!);
    if (!vec) continue;

    const results = topKSimilar(vec, corpus, corpusIds, 6)
      .filter((r) => r.id !== row.id);

    top1Scores.push(results[0].score);
    for (const r of results.slice(0, 5)) top5Scores.push(r.score);

    // Random pair
    const randIdx = Math.floor(Math.random() * corpus.length);
    randomScores.push(cosineSimilarity(vec, corpus[randIdx]));
  }

  console.log("Top-1 scores:", stats(top1Scores));
  console.log("Top-5 scores:", stats(top5Scores));
  console.log("Random pairs:", stats(randomScores));
  console.log(`\n→ Gap top1 vs random: ${(stats(top1Scores).mean - stats(randomScores).mean).toFixed(4)}`);

  // ──────────────────────────────────────
  // 2. Cross-category discrimination
  // ──────────────────────────────────────
  console.log("\n═══ 2. CROSS-CATEGORY DISCRIMINATION ═══\n");

  const bullishRows = rows.filter((r) => category(r.pct_change) === "bullish");
  const bearishRows = rows.filter((r) => category(r.pct_change) === "bearish");

  const bbScores: number[] = []; // bullish↔bullish
  const bxScores: number[] = []; // bullish↔bearish

  for (let i = 0; i < Math.min(100, bullishRows.length); i++) {
    const v1 = vecMap.get(bullishRows[i].id!);
    if (!v1) continue;

    // Same category
    const j = (i + 1) % bullishRows.length;
    const v2 = vecMap.get(bullishRows[j].id!);
    if (v2) bbScores.push(cosineSimilarity(v1, v2));

    // Opposite category
    const k = i % bearishRows.length;
    const v3 = vecMap.get(bearishRows[k].id!);
    if (v3) bxScores.push(cosineSimilarity(v1, v3));
  }

  console.log("Bullish↔Bullish:", stats(bbScores));
  console.log("Bullish↔Bearish:", stats(bxScores));
  console.log(`\n→ Discrimination gap: ${(stats(bbScores).mean - stats(bxScores).mean).toFixed(4)}`);

  // ──────────────────────────────────────
  // 3. Text embedding uniqueness
  // ──────────────────────────────────────
  console.log("\n═══ 3. TEXT EMBEDDING UNIQUENESS ═══\n");

  // Sample 200 text embeddings, check pairwise similarity
  const sampleTexts = rows.slice(0, 200).map((r) => r.text_summary);
  const textEmbeddings: number[][] = [];
  for (const t of sampleTexts) {
    textEmbeddings.push(await encodeSingle(t));
  }

  const textPairScores: number[] = [];
  for (let i = 0; i < 200; i += 5) {
    for (let j = i + 1; j < 200; j += 5) {
      textPairScores.push(cosineSimilarity(textEmbeddings[i], textEmbeddings[j]));
    }
  }

  // Count near-duplicates (similarity > 0.95)
  const nearDups = textPairScores.filter((s) => s > 0.95).length;
  const highSim = textPairScores.filter((s) => s > 0.85).length;

  console.log("Text pairwise similarity:", stats(textPairScores));
  console.log(`Near-duplicates (>0.95): ${nearDups}/${textPairScores.length} (${(nearDups / textPairScores.length * 100).toFixed(1)}%)`);
  console.log(`High similarity (>0.85): ${highSim}/${textPairScores.length} (${(highSim / textPairScores.length * 100).toFixed(1)}%)`);

  // ──────────────────────────────────────
  // 4. Stress test: contradictory query
  // ──────────────────────────────────────
  console.log("\n═══ 4. STRESS TEST: CONTRADICTORY QUERY ═══\n");

  // Take a strong bullish day, swap its text to bearish
  const bullDay = rows.find((r) => r.pct_change > 3)!;
  const bearDay = rows.find((r) => r.pct_change < -3)!;

  const factors = (r: typeof bullDay) =>
    typeof r.factor_array === "string" ? JSON.parse(r.factor_array) : r.factor_array;

  // Original query
  const origInput: MarketDayInput = {
    date: bullDay.date, price: bullDay.price, arm: bullDay.arm,
    srm: bullDay.srm, factor_array: factors(bullDay),
    pct_change: bullDay.pct_change, text_summary: bullDay.text_summary,
  };
  const origVec = await buildHybridVector(origInput, normStats, W_NUM, W_TEXT);
  const origResults = topKSimilar(origVec, corpus, corpusIds, 6)
    .filter((r) => r.id !== bullDay.id).slice(0, 3);

  // Contradictory: bullish numbers + bearish text
  const contraInput: MarketDayInput = {
    ...origInput,
    text_summary: bearDay.text_summary, // swap text!
  };
  const contraVec = await buildHybridVector(contraInput, normStats, W_NUM, W_TEXT);
  const contraResults = topKSimilar(contraVec, corpus, corpusIds, 6)
    .filter((r) => r.id !== bullDay.id).slice(0, 3);

  console.log(`Query day: ${bullDay.date} (pct=${bullDay.pct_change}%, ${category(bullDay.pct_change)})`);
  console.log(`Original text: "${bullDay.text_summary.slice(0, 60)}..."`);
  console.log(`Swapped text:  "${bearDay.text_summary.slice(0, 60)}..."\n`);

  console.log("Original query top-3:");
  for (const r of origResults) {
    const row = getMarketDayById(r.id)!;
    console.log(`  score=${r.score.toFixed(4)}  ${row.date}  pct=${row.pct_change}%  ${category(row.pct_change)}`);
  }

  console.log("\nContradictory query top-3 (bullish numbers + bearish text):");
  for (const r of contraResults) {
    const row = getMarketDayById(r.id)!;
    console.log(`  score=${r.score.toFixed(4)}  ${row.date}  pct=${row.pct_change}%  ${category(row.pct_change)}`);
  }

  // ──────────────────────────────────────
  // 5. Verdict
  // ──────────────────────────────────────
  console.log("\n═══ 5. VERDICT ═══\n");

  const gap = stats(top1Scores).mean - stats(randomScores).mean;
  const discGap = stats(bbScores).mean - stats(bxScores).mean;

  const issues: string[] = [];
  if (gap < 0.15) issues.push(`Score gap quá nhỏ (${gap.toFixed(4)}): top-1 vs random gần nhau → score không phân biệt tốt`);
  if (discGap < 0.05) issues.push(`Discrimination gap quá nhỏ (${discGap.toFixed(4)}): bullish↔bullish ≈ bullish↔bearish`);
  if (nearDups / textPairScores.length > 0.1) issues.push(`${(nearDups / textPairScores.length * 100).toFixed(0)}% text near-duplicates: template lặp quá nhiều, text embedding thiếu diversity`);
  if (stats(top1Scores).min > 0.9) issues.push(`Min top-1 score > 0.9: mọi thứ đều "giống nhau" → score bão hòa`);

  if (issues.length === 0) {
    console.log("Score đáng tin cậy.");
  } else {
    console.log(`Phát hiện ${issues.length} vấn đề:\n`);
    issues.forEach((iss, i) => console.log(`  ${i + 1}. ${iss}`));
    console.log("\n→ Score 0.98 CHƯA đáng tin. Cần cải thiện data diversity hoặc tuning weights.");
  }

  shutdown();
  closeDb();
}

main().catch((err) => {
  console.error("Error:", err);
  shutdown();
  closeDb();
  process.exit(1);
});
