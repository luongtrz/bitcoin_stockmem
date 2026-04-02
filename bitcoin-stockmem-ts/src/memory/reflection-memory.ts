/**
 * Reflection Memory: storage and retrieval of causal experience.
 */

import { getDb, insertReflection } from "../storage/database";

export function storeReflection(params: {
  date: string;
  asset: string;
  windowStart: string;
  windowEnd: string;
  priceDirection: string;
  reason: string;
  keyEvents: string | string[];
  priceChangePct?: number;
  source?: string;
}): number {
  return insertReflection({
    date: params.date,
    asset: params.asset,
    window_start: params.windowStart,
    window_end: params.windowEnd,
    price_direction: params.priceDirection,
    reason: params.reason,
    key_events: params.keyEvents,
    price_change_pct: params.priceChangePct,
    source: params.source ?? "train",
  });
}

export function getReflectionByWindow(
  windowEnd: string,
  asset: string
): Record<string, any> | null {
  const d = getDb();
  const row = d.prepare(
    `SELECT * FROM reflections WHERE window_end = ? AND asset = ? ORDER BY id DESC LIMIT 1`
  ).get(windowEnd, asset) as any;
  return row ?? null;
}

export function getReflectionsForDateRange(
  startDate: string,
  endDate: string,
  asset?: string
): Record<string, any>[] {
  const d = getDb();
  if (asset) {
    return d.prepare(
      `SELECT * FROM reflections WHERE date >= ? AND date <= ? AND asset = ? ORDER BY date, id`
    ).all(startDate, endDate, asset) as any[];
  }
  return d.prepare(
    `SELECT * FROM reflections WHERE date >= ? AND date <= ? ORDER BY date, id`
  ).all(startDate, endDate) as any[];
}

export function formatReflectionsForPrompt(reflections: Record<string, any>[]): string {
  if (!reflections.length) return "No historical reference experience available.";

  return reflections.map((ref, i) => {
    let keyEvents = ref.key_events;
    if (typeof keyEvents === "string") {
      try { keyEvents = JSON.parse(keyEvents); } catch {}
    }
    const keStr = Array.isArray(keyEvents) ? keyEvents.join("; ") : String(keyEvents);

    return [
      `\n--- Historical Reference ${i + 1} ---`,
      `Period: ${ref.window_start} to ${ref.window_end}`,
      `Actual price movement: ${ref.price_direction}`,
      `Analysis: ${ref.reason}`,
      `Key events: ${keStr}`,
    ].join("\n");
  }).join("\n");
}
