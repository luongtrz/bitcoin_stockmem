/**
 * Similarity search theo paper StockMem (Section 3.3):
 *
 * Cong thuc (5): TypeSim(ti, tj) = Jaccard(V_ti, V_tj)
 * Cong thuc (6): GroupSim(ti, tj) = Jaccard(G_ti, G_tj)
 * Cong thuc (7): DailySim(ti, tj) = α × TypeSim + (1-α) × GroupSim,  α=0.7
 * Cong thuc (8): SeqSim(Sa, Sb) = (1/W) × Σ DailySim(t_a-k, t_b-k),  k=0..W-1
 *
 * Ho tro 2 che do:
 *   - searchTopK: single-day (DailySim)
 *   - searchTopKWindows: window W ngay (SeqSim) + history rhymes output
 */

import type { DailyJsonInput, DayVector, SearchResult, StoredRecord, WindowSearchResult } from "./types";

// ----------------------------------------------------------------
// Hyperparameters theo paper
// ----------------------------------------------------------------

/** α: trong so type vs group trong DailySim (paper: 0.7) */
const ALPHA = 0.7;

/** W: kich thuoc window cho SeqSim (paper: 5) */
const WINDOW_SIZE = 5;

// ----------------------------------------------------------------
// Jaccard similarity - cong thuc (5), (6)
// ----------------------------------------------------------------

/**
 * Jaccard similarity cho binary vectors.
 * J(A,B) = |A ∩ B| / |A ∪ B|
 */
function jaccard(a: number[], b: number[]): number {
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) union++;
    if (a[i] && b[i]) intersection++;
  }
  return union === 0 ? 0 : intersection / union;
}

// ----------------------------------------------------------------
// Parse stored vectors
// ----------------------------------------------------------------

function parseVectors(rec: StoredRecord): DayVector {
  return {
    typeVec: JSON.parse(rec.type_vec),
    groupVec: JSON.parse(rec.group_vec),
  };
}

// ----------------------------------------------------------------
// DailySim - cong thuc (7)
// ----------------------------------------------------------------

/**
 * DailySim(ti, tj) = α × TypeSim(ti, tj) + (1-α) × GroupSim(ti, tj)
 *
 * Khi ca 2 ngay khong co event nao -> tra ve 0.
 */
function dailySim(a: DayVector, b: DayVector): number {
  const aHasEvents = a.typeVec.some((v) => v === 1);
  const bHasEvents = b.typeVec.some((v) => v === 1);

  if (!aHasEvents || !bHasEvents) return 0;

  const typeSim = jaccard(a.typeVec, b.typeVec);   // cong thuc (5)
  const groupSim = jaccard(a.groupVec, b.groupVec); // cong thuc (6)

  return ALPHA * typeSim + (1 - ALPHA) * groupSim;  // cong thuc (7)
}

// ----------------------------------------------------------------
// Single-day search
// ----------------------------------------------------------------

export function searchTopK(
  queryVector: DayVector,
  records: StoredRecord[],
  topK = 5
): SearchResult[] {
  const scored: Array<{ score: number; record: DailyJsonInput }> = [];

  for (const rec of records) {
    const candVec = parseVectors(rec);
    const score = dailySim(queryVector, candVec);
    const originalJson: DailyJsonInput = JSON.parse(rec.json_data);
    scored.push({ score, record: originalJson });
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map((item, idx) => ({
    rank: idx + 1,
    score: Math.round(item.score * 10000) / 10000,
    record: item.record,
  }));
}

// ----------------------------------------------------------------
// Window/Sequence search - cong thuc (8)
// ----------------------------------------------------------------

/**
 * SeqSim(Series_a, Series_b) = (1/W) × Σ DailySim(t_a-k, t_b-k)
 *
 * So sanh aligned tu cuoi (ngay gan nhat khop ngay gan nhat).
 */
export function searchTopKWindows(
  queryWindow: DayVector[],
  records: StoredRecord[],
  queryStartDate: string,
  topK = 5
): WindowSearchResult[] {
  const W = queryWindow.length;
  if (W === 0 || records.length < W) return [];

  const scored: Array<{
    score: number;
    window: DailyJsonInput[];
  }> = [];

  for (let i = 0; i <= records.length - W; i++) {
    const candRecords = records.slice(i, i + W);

    // Temporal exclusion: skip overlap voi query window
    if (candRecords[W - 1].date >= queryStartDate) continue;

    const candVecs = candRecords.map(parseVectors);

    // SeqSim = trung binh DailySim aligned tu cuoi - cong thuc (8)
    let totalSim = 0;
    for (let k = 0; k < W; k++) {
      totalSim += dailySim(queryWindow[W - 1 - k], candVecs[W - 1 - k]);
    }
    const seqSim = totalSim / W;

    const windowData = candRecords.map(
      (r) => JSON.parse(r.json_data) as DailyJsonInput
    );

    scored.push({ score: seqSim, window: windowData });
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map((item, idx) => ({
    rank: idx + 1,
    score: Math.round(item.score * 10000) / 10000,
    window: item.window,
  }));
}
