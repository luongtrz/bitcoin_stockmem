/**
 * Similarity search ket hop StockMem + History Rhymes:
 *
 * - DailySim = inner_product(joint_vecA, joint_vecB)
 *   (joint_vec da L2-normalized nen inner_product = cosine similarity)
 * - SeqSim (formula 8): trung binh DailySim aligned tu cuoi, W=5
 */

import type {
  DailyJsonInput,
  JointVector,
  SearchResult,
  StoredRecord,
  WindowSearchResult,
} from "./types.js";

// ----------------------------------------------------------------
// Inner product (= cosine since L2-normalized)
// ----------------------------------------------------------------

function innerProduct(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// ----------------------------------------------------------------
// Parse stored vector
// ----------------------------------------------------------------

function parseVector(rec: StoredRecord): JointVector {
  return JSON.parse(rec.joint_vec);
}

// ----------------------------------------------------------------
// Single-day search
// ----------------------------------------------------------------

export function searchTopK(
  queryVec: JointVector,
  records: StoredRecord[],
  topK = 5
): SearchResult[] {
  const scored: Array<{ score: number; record: DailyJsonInput }> = [];

  for (const rec of records) {
    const candVec = parseVector(rec);
    const score = innerProduct(queryVec, candVec);
    scored.push({ score, record: JSON.parse(rec.json_data) });
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map((item, idx) => ({
    rank: idx + 1,
    score: Math.round(item.score * 10000) / 10000,
    record: item.record,
  }));
}

// ----------------------------------------------------------------
// Window/Sequence search — StockMem formula (8)
// ----------------------------------------------------------------

export function searchTopKWindows(
  queryVecs: JointVector[],
  records: StoredRecord[],
  queryStartDate: string,
  topK = 5
): WindowSearchResult[] {
  const W = queryVecs.length;
  if (W === 0 || records.length < W) return [];

  const scored: Array<{ score: number; dailyScores: number[]; window: DailyJsonInput[] }> = [];

  for (let i = 0; i <= records.length - W; i++) {
    const candRecords = records.slice(i, i + W);

    // Temporal exclusion: candidate window must be before query
    if (candRecords[W - 1].date >= queryStartDate) continue;

    const candVecs = candRecords.map(parseVector);

    // SeqSim = avg DailySim aligned from end (formula 8)
    const dailyScores: number[] = new Array(W);
    let totalSim = 0;
    for (let k = 0; k < W; k++) {
      const sim = innerProduct(queryVecs[W - 1 - k], candVecs[W - 1 - k]);
      dailyScores[W - 1 - k] = sim;
      totalSim += sim;
    }
    const seqSim = totalSim / W;

    scored.push({
      score: seqSim,
      dailyScores,
      window: candRecords.map((r) => JSON.parse(r.json_data)),
    });
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map((item, idx) => ({
    rank: idx + 1,
    score: Math.round(item.score * 10000) / 10000,
    daily_scores: item.dailyScores.map((s) => Math.round(s * 10000) / 10000),
    window: item.window,
  }));
}
