/**
 * Jaccard-based similarity for event sequences (paper equations 3-8).
 */

import { ALPHA } from "../config";
import { TYPE_TO_INDEX, GROUP_TO_INDEX, NUM_TYPES, NUM_GROUPS } from "../data/taxonomy";
import { getDb } from "../storage/database";

// ---------------------------------------------------------------------------
// Binary vector construction
// ---------------------------------------------------------------------------

export function buildTypeVector(eventTypes: string[]): number[] {
  const v = new Array(NUM_TYPES).fill(0);
  for (const t of eventTypes) {
    const idx = TYPE_TO_INDEX.get(t);
    if (idx !== undefined) v[idx] = 1;
  }
  return v;
}

export function buildGroupVector(eventGroups: string[]): number[] {
  const g = new Array(NUM_GROUPS).fill(0);
  for (const grp of eventGroups) {
    const idx = GROUP_TO_INDEX.get(grp);
    if (idx !== undefined) g[idx] = 1;
  }
  return g;
}

// ---------------------------------------------------------------------------
// Jaccard
// ---------------------------------------------------------------------------

export function jaccard(a: number[], b: number[]): number {
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) union++;
    if (a[i] && b[i]) intersection++;
  }
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Daily & Sequence similarity
// ---------------------------------------------------------------------------

export function dailySim(
  tv1: number[], gv1: number[],
  tv2: number[], gv2: number[],
  alpha = ALPHA
): number {
  return alpha * jaccard(tv1, tv2) + (1 - alpha) * jaccard(gv1, gv2);
}

type DayVectors = { typeVec: number[]; groupVec: number[] };

export function seqSim(seriesA: DayVectors[], seriesB: DayVectors[]): number {
  const w = Math.min(seriesA.length, seriesB.length);
  if (w === 0) return 0;
  let total = 0;
  for (let k = 0; k < w; k++) {
    const a = seriesA[seriesA.length - 1 - k];
    const b = seriesB[seriesB.length - 1 - k];
    total += dailySim(a.typeVec, a.groupVec, b.typeVec, b.groupVec);
  }
  return total / w;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

export function storeDailyVector(
  date: string, asset: string, events: Array<{ event_group: string; event_type: string }>
): void {
  const types = events.map((e) => e.event_type);
  const groups = events.map((e) => e.event_group);
  const tv = buildTypeVector(types);
  const gv = buildGroupVector(groups);

  const d = getDb();
  d.prepare(`
    INSERT OR REPLACE INTO daily_vectors (date, asset, type_vector, group_vector, event_count)
    VALUES (?, ?, ?, ?, ?)
  `).run(date, asset, JSON.stringify(tv), JSON.stringify(gv), events.length);
}

export function loadDailyVector(date: string, asset: string): DayVectors | null {
  const d = getDb();
  const row = d.prepare(
    "SELECT type_vector, group_vector FROM daily_vectors WHERE date = ? AND asset = ?"
  ).get(date, asset) as any;
  if (!row) return null;
  return {
    typeVec: JSON.parse(row.type_vector),
    groupVec: JSON.parse(row.group_vector),
  };
}

export function loadSeriesVectors(dates: string[], asset: string): DayVectors[] {
  return dates.map((d) => {
    const v = loadDailyVector(d, asset);
    return v ?? { typeVec: new Array(NUM_TYPES).fill(0), groupVec: new Array(NUM_GROUPS).fill(0) };
  });
}

export function findTopKSequences(
  currentDates: string[],
  allHistoryDates: string[],
  asset: string,
  k = 10
): Array<{ dates: string[]; score: number }> {
  const w = currentDates.length;
  if (w === 0 || allHistoryDates.length < w) return [];

  const currentSeries = loadSeriesVectors(currentDates, asset);
  const candidates: Array<{ dates: string[]; score: number }> = [];

  for (let i = 0; i <= allHistoryDates.length - w; i++) {
    const histDates = allHistoryDates.slice(i, i + w);
    if (histDates[histDates.length - 1] >= currentDates[0]) continue;
    const histSeries = loadSeriesVectors(histDates, asset);
    const sim = seqSim(currentSeries, histSeries);
    candidates.push({ dates: histDates, score: sim });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, k);
}
