/**
 * Vectorize ket hop StockMem + History Rhymes:
 *
 * Joint vector = [typeVec(62d); groupVec(13d); α × numeric(5d)]
 *              → L2-normalize
 *
 * - Binary event vectors: StockMem formulas (3)-(4)
 * - Numerical concat + α=0.5: History Rhymes (Khanna, 2024)
 * - Numeric fields z-score normalized truoc khi scale
 */

import type { DailyJsonInput, JointVector } from "./types.js";
import { buildTypeVector, buildGroupVector } from "./taxonomy.js";
import { ALPHA } from "./config.js";

// ----------------------------------------------------------------
// Z-score normalization stats (computed from corpus)
// ----------------------------------------------------------------

export interface NormStats {
  count: number;
  sum: number[];
  sumSq: number[];
}

export function computeNormStats(days: DailyJsonInput[]): NormStats {
  const stats: NormStats = { count: 0, sum: [0, 0, 0, 0, 0], sumSq: [0, 0, 0, 0, 0] };
  for (const d of days) {
    const nums = extractNumerical(d);
    for (let i = 0; i < 5; i++) {
      stats.sum[i] += nums[i];
      stats.sumSq[i] += nums[i] * nums[i];
    }
    stats.count++;
  }
  return stats;
}

function zScoreNormalize(raw: number[], stats: NormStats): number[] {
  return raw.map((x, i) => {
    const mean = stats.sum[i] / stats.count;
    const variance = stats.sumSq[i] / stats.count - mean * mean;
    const std = Math.sqrt(Math.max(variance, 0)) || 1e-8;
    return (x - mean) / std;
  });
}

// ----------------------------------------------------------------
// Extract numerical indicators
// ----------------------------------------------------------------

function extractNumerical(input: DailyJsonInput): number[] {
  return [
    input.msi,
    input.rsi,
    input.sentiment_score_avg,
    input.fear_greed_index,
    input.price_change_pct,
  ];
}

// ----------------------------------------------------------------
// L2 normalize
// ----------------------------------------------------------------

function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  if (norm === 0) return vec;
  return vec.map((x) => x / norm);
}

// ----------------------------------------------------------------
// Build joint vector
// ----------------------------------------------------------------

export function vectorize(input: DailyJsonInput, stats?: NormStats): JointVector {
  // Binary event vectors (StockMem formulas 3-4)
  const typeVec = buildTypeVector(input.factors);   // 62d
  const groupVec = buildGroupVector(input.factors);  // 13d

  // Numerical indicators (History Rhymes α=0.5)
  const rawNum = extractNumerical(input);            // 5d
  const normNum = stats && stats.count > 1
    ? zScoreNormalize(rawNum, stats)
    : rawNum;
  const scaledNum = normNum.map((x) => x * ALPHA);  // α × numeric

  // Concat + L2-normalize
  return l2Normalize([...typeVec, ...groupVec, ...scaledNum]);
}
