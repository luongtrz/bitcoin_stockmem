import type { DailyJsonInput, SearchResult, WindowSearchResult } from "./types.js";
import { vectorize, computeNormStats } from "./vectorize.js";
import { insertRecords, getAllRecords } from "./storage/database.js";
import { searchTopK, searchTopKWindows } from "./search.js";
import { TOP_K } from "./config.js";

export function indexBatch(inputs: DailyJsonInput[]): number[] {
  return insertRecords(inputs);
}

export function findSimilarDays(
  query: DailyJsonInput,
  k: number = TOP_K
): SearchResult[] {
  const records = getAllRecords();
  const allDays: DailyJsonInput[] = records.map((r) => JSON.parse(r.json_data));
  const stats = computeNormStats(allDays);
  const queryVec = vectorize(query, stats);
  return searchTopK(queryVec, records, k);
}

export function findSimilarWindows(
  queryDays: DailyJsonInput[],
  k: number = TOP_K
): WindowSearchResult[] {
  const records = getAllRecords();
  const allDays: DailyJsonInput[] = records.map((r) => JSON.parse(r.json_data));
  const stats = computeNormStats(allDays);
  const queryVecs = queryDays.map((d) => vectorize(d, stats));
  const queryStartDate = queryDays[0].date;
  return searchTopKWindows(queryVecs, records, queryStartDate, k);
}
