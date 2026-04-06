import { encodeSingle, embeddingToBuffer, bufferToEmbedding } from "./embeddings/embed.js";
import {
  getMeta,
  setMeta,
  getAllMarketDays,
  updateMarketDayVector,
} from "./storage/database.js";
import { W_NUM, W_TEXT } from "./config.js";
import type { MarketDayInput } from "./types.js";

// ---------------------------------------------------------------------------
// Normalization statistics
// ---------------------------------------------------------------------------

export interface NormStats {
  count: number;
  sum: number[];
  sumSq: number[];
  numDims: number;
}

export function loadNormStats(): NormStats | null {
  const raw = getMeta("norm_stats");
  if (!raw) return null;
  return JSON.parse(raw) as NormStats;
}

export function saveNormStats(stats: NormStats): void {
  setMeta("norm_stats", JSON.stringify(stats));
}

export function updateNormStats(stats: NormStats, vec: number[]): NormStats {
  const newCount = stats.count + 1;
  const newSum = stats.sum.map((s, i) => s + vec[i]);
  const newSumSq = stats.sumSq.map((s, i) => s + vec[i] * vec[i]);
  return { count: newCount, sum: newSum, sumSq: newSumSq, numDims: stats.numDims };
}

// ---------------------------------------------------------------------------
// Vector operations
// ---------------------------------------------------------------------------

export function extractNumericalVector(input: MarketDayInput): number[] {
  return [input.price, input.arm, input.srm, input.pct_change, ...input.factor_array];
}

export function zScoreNormalize(raw: number[], stats: NormStats): number[] {
  return raw.map((x, i) => {
    const mean = stats.sum[i] / stats.count;
    const variance = stats.sumSq[i] / stats.count - mean * mean;
    const std = Math.sqrt(Math.max(variance, 0)) || 1e-8;
    return (x - mean) / std;
  });
}

export function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  if (norm === 0) return vec;
  return vec.map((x) => x / norm);
}

export async function buildHybridVector(
  input: MarketDayInput,
  stats: NormStats | null,
  wNum = W_NUM,
  wText = W_TEXT
): Promise<number[]> {
  const rawNum = extractNumericalVector(input);

  // Z-score normalize if we have enough data
  const normalized =
    stats && stats.count > 1 ? zScoreNormalize(rawNum, stats) : rawNum;

  // L2-normalize numerical sub-vector
  const numNormed = l2Normalize(normalized);

  // Text embedding (already L2-normalized)
  const textEmb = await encodeSingle(input.text_summary);

  // Scale and concatenate
  const scaledNum = numNormed.map((x) => x * wNum);
  const scaledText = textEmb.map((x) => x * wText);

  return [...scaledNum, ...scaledText];
}

// ---------------------------------------------------------------------------
// Reindex all stored records
// ---------------------------------------------------------------------------

export async function reindexAll(wNum = W_NUM, wText = W_TEXT): Promise<number> {
  const rows = getAllMarketDays();
  if (rows.length === 0) return 0;

  // Recompute normalization stats from scratch
  const firstFactors: number[] = JSON.parse(
    typeof rows[0].factor_array === "string"
      ? rows[0].factor_array
      : JSON.stringify(rows[0].factor_array)
  );
  const firstNum = [rows[0].price, rows[0].arm, rows[0].srm, rows[0].pct_change, ...firstFactors];
  const numDims = firstNum.length;

  let stats: NormStats = {
    count: 0,
    sum: new Array(numDims).fill(0),
    sumSq: new Array(numDims).fill(0),
    numDims,
  };

  // First pass: compute stats
  for (const row of rows) {
    const factors: number[] =
      typeof row.factor_array === "string"
        ? JSON.parse(row.factor_array)
        : row.factor_array;
    const numVec = [row.price, row.arm, row.srm, row.pct_change, ...factors];
    stats = updateNormStats(stats, numVec);
  }
  saveNormStats(stats);

  // Second pass: rebuild vectors
  for (const row of rows) {
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
    const hybrid = await buildHybridVector(input, stats, wNum, wText);
    updateMarketDayVector(row.id!, embeddingToBuffer(hybrid));
  }

  return rows.length;
}
