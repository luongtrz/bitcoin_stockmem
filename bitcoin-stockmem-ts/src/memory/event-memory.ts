/**
 * Event Memory: queries, chain building, and series construction.
 */

import { getDb } from "../storage/database";
import { storeDailyVector } from "./similarity";

export function getEventsForDate(date: string, asset?: string): Record<string, any>[] {
  const d = getDb();
  let rows: any[];
  if (asset) {
    rows = d.prepare(
      `SELECT * FROM merged_events WHERE date = ? AND (asset = ? OR asset = 'ALL') ORDER BY id`
    ).all(date, asset);
  } else {
    rows = d.prepare("SELECT * FROM merged_events WHERE date = ? ORDER BY id").all(date);
  }
  return rows.map(parseJsonFields);
}

export function getEventChain(eventId: number, maxDepth = 5): Record<string, any>[] {
  const d = getDb();
  const chain: Record<string, any>[] = [];
  const visited = new Set<number>();
  let currentId: number | null = eventId;

  while (currentId && chain.length < maxDepth) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const row = d.prepare("SELECT * FROM merged_events WHERE id = ?").get(currentId) as any;
    if (!row) break;
    chain.push(parseJsonFields(row));
    currentId = row.prev_event_id;
  }

  chain.reverse();
  return chain;
}

export function buildEventSeries(
  endDate: string,
  window: number,
  asset?: string
): { dates: string[]; eventsPerDay: Record<string, any>[][] } {
  const endDt = new Date(endDate);
  const dates: string[] = [];
  for (let i = window; i >= 0; i--) {
    const d = new Date(endDt);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const eventsPerDay = dates.map((d) => getEventsForDate(d, asset));
  return { dates, eventsPerDay };
}

export function formatSeriesForPrompt(
  dates: string[],
  eventsPerDay: Record<string, any>[][],
  includeDeltaInfo = true
): string {
  const lines: string[] = [];
  for (let i = 0; i < dates.length; i++) {
    const events = eventsPerDay[i];
    if (!events.length) continue;
    lines.push(`\n=== ${dates[i]} ===`);
    for (const ev of events) {
      lines.push(`  [${ev.event_group} / ${ev.event_type}] ${ev.description}`);
      if (includeDeltaInfo && ev.delta_info) {
        lines.push(`    ΔInfo: ${ev.delta_info}`);
      }
    }
  }
  return lines.join("\n");
}

export function computeAndStoreDailyVectors(date: string, asset: string): void {
  const events = getEventsForDate(date, asset);
  if (events.length > 0) {
    storeDailyVector(date, asset, events as any);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJsonFields(row: any): Record<string, any> {
  const r = { ...row };
  for (const field of ["entities", "industries", "extended_attrs", "source_raw_event_ids"]) {
    if (typeof r[field] === "string") {
      try { r[field] = JSON.parse(r[field]); } catch {}
    }
  }
  return r;
}
