import "dotenv/config";
import { getDb, closeDb, getAllRecords } from "../src/storage/database.ts";
import { vectorize, computeNormStats } from "../src/vectorize.ts";
import { searchTopK, searchTopKWindows } from "../src/search.ts";
import { WINDOW_SIZE } from "../src/config.ts";
import type { DailyJsonInput } from "../src/types.ts";

function category(pct: number): string {
  if (pct > 1) return "bullish";
  if (pct < -1) return "bearish";
  return "neutral";
}

function main(): void {
  getDb();
  const records = getAllRecords();
  const K = 5;
  if (records.length === 0) { console.log("No records."); closeDb(); return; }

  const allDays: DailyJsonInput[] = records.map((r) => JSON.parse(r.json_data));
  const stats = computeNormStats(allDays);

  let total = 0, catMatch1 = 0, catMatchK = 0, selfFound = 0;
  const scores: number[] = [];
  const pctDeltas: number[] = [];

  for (let i = 0; i < allDays.length; i += 3) {
    const query = allDays[i];
    const queryVec = vectorize(query, stats);
    const results = searchTopK(queryVec, records, K + 1);
    const filtered = results.filter((r) => r.record.date !== query.date).slice(0, K);
    if (filtered.length === 0) continue;
    total++;

    const queryCat = category(query.price_change_pct);
    if (results[0].record.date === query.date) selfFound++;
    if (category(filtered[0].record.price_change_pct) === queryCat) catMatch1++;

    let catCount = 0;
    for (const r of filtered) {
      if (category(r.record.price_change_pct) === queryCat) catCount++;
      scores.push(r.score);
      pctDeltas.push(Math.abs(r.record.price_change_pct - query.price_change_pct));
    }
    if (catCount > K / 2) catMatchK++;
  }

  // Window search test
  let windowScore = 0;
  const W = WINDOW_SIZE;
  if (allDays.length > W * 3) {
    const mid = Math.floor(allDays.length / 2);
    const qWindow = allDays.slice(mid, mid + W);
    const qVecs = qWindow.map((d) => vectorize(d, stats));
    const wResults = searchTopKWindows(qVecs, records, qWindow[0].date, 1);
    if (wResults.length > 0) windowScore = wResults[0].score;
  }

  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const avgPctDelta = pctDeltas.reduce((a, b) => a + b, 0) / pctDeltas.length;
  const catDist = { bullish: 0, bearish: 0, neutral: 0 };
  for (const d of allDays) catDist[category(d.price_change_pct) as keyof typeof catDist]++;

  console.log("═══════════════════════════════════════════");
  console.log("  EVAL (StockMem + History Rhymes Hybrid)");
  console.log("═══════════════════════════════════════════");
  console.log(`Dataset:              ${records.length} days`);
  console.log(`Queries tested:       ${total}`);
  console.log(`Category dist:        bull=${catDist.bullish} bear=${catDist.bearish} neutral=${catDist.neutral}`);
  console.log("───────────────────────────────────────────");
  console.log(`Self-retrieval:       ${selfFound}/${total} (${(selfFound / total * 100).toFixed(1)}%)`);
  console.log(`Top-1 category match: ${catMatch1}/${total} (${(catMatch1 / total * 100).toFixed(1)}%)`);
  console.log(`Top-K majority match: ${catMatchK}/${total} (${(catMatchK / total * 100).toFixed(1)}%)`);
  console.log(`Avg similarity score: ${avgScore.toFixed(4)}`);
  console.log(`Avg |Δpct_change|:    ${avgPctDelta.toFixed(3)}%`);
  console.log(`Window search top-1:  ${windowScore.toFixed(4)} (W=${W})`);
  console.log("═══════════════════════════════════════════");

  closeDb();
}

main();
