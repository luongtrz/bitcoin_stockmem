/**
 * Cosine similarity search: tim Top-K ban ghi gan nhat voi vector dau vao.
 */

import type { DailyJsonInput, SearchResult, StoredRecord } from "./types";

/**
 * Cosine similarity giua 2 vector.
 * Tra ve gia tri tu -1 den 1 (1 = giong nhat).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
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
    const score = cosineSimilarity(queryVector, storedVec);
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
