import { MarketDaySchema, type MarketDayInput } from "./types.js";
import {
  buildHybridVector,
  extractNumericalVector,
  loadNormStats,
  saveNormStats,
  updateNormStats,
  reindexAll,
  type NormStats,
} from "./vectorizer.js";
import {
  insertMarketDay,
  getAllMarketDayVectors,
  getMarketDayById,
  getMarketDayByDate,
} from "./storage/database.js";
import { embeddingToBuffer, bufferToEmbedding } from "./embeddings/embed.js";
import { topKSimilar } from "./search.js";
import { W_NUM, W_TEXT, TOP_K } from "./config.js";

// ---------------------------------------------------------------------------
// Index a single market day
// ---------------------------------------------------------------------------

export async function indexMarketDay(input: unknown): Promise<number> {
  const parsed = MarketDaySchema.parse(input);

  // Check duplicate
  const existing = getMarketDayByDate(parsed.date);
  if (existing) throw new Error(`Market day already exists for ${parsed.date}`);

  // Update normalization stats
  const numVec = extractNumericalVector(parsed);
  let stats = loadNormStats();

  if (stats) {
    if (numVec.length !== stats.numDims) {
      throw new Error(
        `factor_array length mismatch: expected ${stats.numDims - 4}, got ${parsed.factor_array.length}`
      );
    }
    stats = updateNormStats(stats, numVec);
  } else {
    stats = {
      count: 1,
      sum: [...numVec],
      sumSq: numVec.map((x) => x * x),
      numDims: numVec.length,
    };
  }
  saveNormStats(stats);

  // Build hybrid vector
  const hybrid = await buildHybridVector(parsed, stats, W_NUM, W_TEXT);

  // Insert
  const id = insertMarketDay({
    date: parsed.date,
    price: parsed.price,
    arm: parsed.arm,
    srm: parsed.srm,
    factor_array: parsed.factor_array,
    pct_change: parsed.pct_change,
    text_summary: parsed.text_summary,
    hybrid_vector: embeddingToBuffer(hybrid),
    num_dims: numVec.length,
  });

  return id;
}

// ---------------------------------------------------------------------------
// Batch index + reindex
// ---------------------------------------------------------------------------

export async function indexBatch(inputs: unknown[]): Promise<number[]> {
  const ids: number[] = [];

  // Validate all first
  const parsed = inputs.map((inp) => MarketDaySchema.parse(inp));

  // Insert one by one (vectors will be recomputed)
  for (const p of parsed) {
    const existing = getMarketDayByDate(p.date);
    if (existing) {
      console.warn(`Skipping duplicate date: ${p.date}`);
      continue;
    }

    const numVec = extractNumericalVector(p);
    let stats = loadNormStats();
    if (stats) {
      if (numVec.length !== stats.numDims) {
        throw new Error(
          `factor_array length mismatch: expected ${stats.numDims - 4}, got ${p.factor_array.length}`
        );
      }
      stats = updateNormStats(stats, numVec);
    } else {
      stats = {
        count: 1,
        sum: [...numVec],
        sumSq: numVec.map((x) => x * x),
        numDims: numVec.length,
      };
    }
    saveNormStats(stats);

    const id = insertMarketDay({
      date: p.date,
      price: p.price,
      arm: p.arm,
      srm: p.srm,
      factor_array: p.factor_array,
      pct_change: p.pct_change,
      text_summary: p.text_summary,
      hybrid_vector: null, // will be computed during reindex
      num_dims: numVec.length,
    });
    ids.push(id);
  }

  // Reindex all vectors with final stats
  console.log("Reindexing all vectors...");
  const count = await reindexAll(W_NUM, W_TEXT);
  console.log(`Reindexed ${count} records`);

  return ids;
}

// ---------------------------------------------------------------------------
// Search for similar days
// ---------------------------------------------------------------------------

export interface SimilarDayResult {
  rank: number;
  score: number;
  day: MarketDayInput & { id: number };
}

export async function findSimilarDays(
  query: unknown,
  k: number = TOP_K
): Promise<SimilarDayResult[]> {
  const parsed = MarketDaySchema.parse(query);

  // Build query vector
  const stats = loadNormStats();
  const queryVec = await buildHybridVector(parsed, stats, W_NUM, W_TEXT);

  // Load all stored vectors
  const allVecs = getAllMarketDayVectors();
  if (allVecs.length === 0) return [];

  const corpus = allVecs.map((v) => bufferToEmbedding(v.hybrid_vector));
  const corpusIds = allVecs.map((v) => v.id);

  // Top-K search
  const results = topKSimilar(queryVec, corpus, corpusIds, k);

  // Fetch full records
  return results.map((r, i) => {
    const row = getMarketDayById(r.id)!;
    const factors: number[] =
      typeof row.factor_array === "string"
        ? JSON.parse(row.factor_array)
        : row.factor_array;
    return {
      rank: i + 1,
      score: Math.round(r.score * 10000) / 10000,
      day: {
        id: row.id!,
        date: row.date,
        price: row.price,
        arm: row.arm,
        srm: row.srm,
        factor_array: factors,
        pct_change: row.pct_change,
        text_summary: row.text_summary,
      },
    };
  });
}
