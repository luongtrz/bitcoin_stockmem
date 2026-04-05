/**
 * Similarity search: tim Top-K ban ghi gan nhat voi vector dau vao.
 *
 * Tinh score rieng cho 2 phan:
 *   - Numeric similarity (6 chieu): MSI, RSI, sentiment, FGI, price_change, price
 *   - Text similarity (128 chieu): feature hash cua text + factors
 * Ket hop voi trong so: numeric 50% + text 50%
 * Khi text rong: chi dung numeric 100%
 */

import type { DailyJsonInput, SearchResult, StoredRecord } from "./types";
import { NUMERIC_DIM, TEXT_HASH_DIM } from "./vectorize";

// Trong so ket hop
const W_NUMERIC = 0.5;
const W_TEXT = 0.5;

/**
 * Euclidean distance giua 2 vector.
 */
function euclidean(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Tinh similarity score giua 2 vector day du.
 * Tach rieng numeric va text, normalize tung phan, roi ket hop.
 */
function similarity(query: number[], candidate: number[]): number {
  // Tach 2 phan
  const qNum = query.slice(0, NUMERIC_DIM);
  const cNum = candidate.slice(0, NUMERIC_DIM);
  const qText = query.slice(NUMERIC_DIM, NUMERIC_DIM + TEXT_HASH_DIM);
  const cText = candidate.slice(NUMERIC_DIM, NUMERIC_DIM + TEXT_HASH_DIM);

  // Numeric distance: max co the = sqrt(6) ~ 2.45 (moi chieu max diff = 1)
  const numDist = euclidean(qNum, cNum);
  const maxNumDist = Math.sqrt(NUMERIC_DIM); // ~2.45
  const numScore = Math.max(0, 1 - numDist / maxNumDist);

  // Text distance: vector da L2 normalize, max dist = sqrt(2) ~ 1.41
  const qTextNorm = qText.reduce((s, v) => s + v * v, 0);
  const cTextNorm = cText.reduce((s, v) => s + v * v, 0);

  // Khi query text rong (all zeros) -> chi dung numeric
  if (qTextNorm < 0.001) {
    return numScore;
  }

  const textDist = euclidean(qText, cText);
  const maxTextDist = Math.sqrt(2); // max dist giua 2 unit vectors
  const textScore = Math.max(0, 1 - textDist / maxTextDist);

  return W_NUMERIC * numScore + W_TEXT * textScore;
}

/**
 * Tim Top-K ban ghi co vector gan nhat voi queryVector.
 */
export function searchTopK(
  queryVector: number[],
  records: StoredRecord[],
  topK = 5
): SearchResult[] {
  const scored: Array<{ score: number; record: DailyJsonInput }> = [];

  for (const rec of records) {
    const storedVec: number[] = JSON.parse(rec.vector);
    const score = similarity(queryVector, storedVec);
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
