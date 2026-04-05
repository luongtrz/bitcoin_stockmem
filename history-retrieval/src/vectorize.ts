/**
 * Vectorize: chuyen doi DailyJsonInput thanh vector so.
 *
 * Vector gom 2 phan:
 *   Phan 1 - Numeric (6 chieu):
 *     [0]  msi / 100
 *     [1]  rsi / 100
 *     [2]  (sentiment_score_avg + 1) / 2
 *     [3]  fear_greed_index / 100
 *     [4]  sigmoid(price_change_pct / 10)
 *     [5]  log(price) / 15
 *
 *   Phan 2 - Text hash (128 chieu):
 *     Hash moi tu trong (text + factors) vao 128 bucket
 *     Dung feature hashing (hashing trick) - khong can vocabulary
 *
 *   Tong: 134 chieu
 */

import type { DailyJsonInput } from "./types";

// ----------------------------------------------------------------
// Constants
// ----------------------------------------------------------------

export const NUMERIC_DIM = 6;
export const TEXT_HASH_DIM = 128;
export const VECTOR_DIM = NUMERIC_DIM + TEXT_HASH_DIM; // 134

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Hash function don gian (djb2) cho string -> so nguyen duong.
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Tach text thanh cac tu (tokenize don gian).
 * Bo cac tu qua ngan (< 2 ky tu) va chuyen ve lowercase.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\s]/g, " ") // giu chu, so, unicode
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/**
 * Feature hashing: hash moi tu vao 1 bucket trong vector co dinh.
 * Moi bucket cong 1 khi co tu hash vao do.
 * Cuoi cung normalize vector theo L2 norm.
 */
function featureHash(texts: string[]): number[] {
  const vec = new Array(TEXT_HASH_DIM).fill(0);

  for (const text of texts) {
    const tokens = tokenize(text);
    for (const token of tokens) {
      const bucket = hashString(token) % TEXT_HASH_DIM;
      vec[bucket] += 1;
    }
  }

  // L2 normalize
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);

  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] = vec[i] / norm;
    }
  }

  return vec;
}

// ----------------------------------------------------------------
// Vectorize
// ----------------------------------------------------------------

export function vectorize(input: DailyJsonInput): number[] {
  // Phan 1: Numeric
  const numericPart = [
    input.msi / 100,
    input.rsi / 100,
    (input.sentiment_score_avg + 1) / 2,
    input.fear_greed_index / 100,
    sigmoid(input.price_change_pct / 10),
    Math.log(Math.max(input.price, 1)) / 15,
  ];

  // Phan 2: Text hash (text + factors gop lai)
  const allTexts = [input.text, ...input.factors].filter((t) => t && t.trim());
  const textPart = featureHash(allTexts);

  return [...numericPart, ...textPart];
}
