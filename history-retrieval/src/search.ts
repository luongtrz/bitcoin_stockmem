/**
 * Euclidean distance search: tim Top-K ban ghi gan nhat voi vector dau vao.
 *
 * Dung Euclidean distance thay vi cosine similarity vi:
 * - Cosine do goc giua 2 vector -> khi tat ca gia tri deu duong (0-1),
 *   moi vector deu chi cung huong -> score luon cao (~0.95) du gia tri rat khac nhau
 * - Euclidean do khoang cach thuc su -> RSI=20 vs RSI=50 se co khoang cach lon
 *
 * Score = 1 / (1 + distance) -> cang gan 1 cang giong, cang gan 0 cang khac
 */

import type { DailyJsonInput, SearchResult, StoredRecord } from "./types";

/**
 * Euclidean distance giua 2 vector.
 */
export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Chuyen distance thanh similarity score (0-1).
 * Cang gan -> score cang cao.
 */
export function distanceToScore(distance: number): number {
  return 1 / (1 + distance);
}

/**
 * Tim Top-K ban ghi co vector gan nhat voi queryVector.
 *
 * @param queryVector - Vector cua JSON dau vao
 * @param records - Tat ca ban ghi trong DB (da doc ra)
 * @param topK - So luong ket qua tra ve (mac dinh 5)
 * @returns Mang SearchResult sap xep theo score giam dan
 */
export function searchTopK(
  queryVector: number[],
  records: StoredRecord[],
  topK = 5
): SearchResult[] {
  const scored: Array<{ score: number; record: DailyJsonInput }> = [];

  for (const rec of records) {
    const storedVec: number[] = JSON.parse(rec.vector);
    const dist = euclideanDistance(queryVector, storedVec);
    const score = distanceToScore(dist);
    const originalJson: DailyJsonInput = JSON.parse(rec.json_data);
    scored.push({ score, record: originalJson });
  }

  // Sap xep giam dan theo score
  scored.sort((a, b) => b.score - a.score);

  // Lay Top-K
  return scored.slice(0, topK).map((item, idx) => ({
    rank: idx + 1,
    score: Math.round(item.score * 10000) / 10000, // lam tron 4 chu so
    record: item.record,
  }));
}

