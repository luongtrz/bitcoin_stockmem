/**
 * SQLite connection manager using better-sqlite3 (synchronous).
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { DB_PATH } from "../config";
import { SCHEMA_SQL } from "./schemas";

let db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (db) return db;

  const p = dbPath || DB_PATH;
  fs.mkdirSync(path.dirname(p), { recursive: true });

  db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// ---------------------------------------------------------------------------
// raw_news
// ---------------------------------------------------------------------------

export interface RawNewsRow {
  id?: number;
  date: string;
  source?: string;
  title: string;
  body?: string | null;
  url?: string;
  asset?: string;
}

export function insertRawNews(rows: RawNewsRow[]): number[] {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT OR IGNORE INTO raw_news (date, source, title, body, url, asset, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const ids: number[] = [];
  const tx = d.transaction(() => {
    for (const r of rows) {
      const info = stmt.run(
        r.date, r.source ?? null, r.title, r.body ?? null,
        r.url ?? null, r.asset ?? "ALL", now()
      );
      ids.push(info.lastInsertRowid as number);
    }
  });
  tx();
  return ids;
}

// ---------------------------------------------------------------------------
// raw_events
// ---------------------------------------------------------------------------

export interface RawEventRow {
  news_id?: number | null;
  date: string;
  asset?: string;
  event_group: string;
  event_type: string;
  time?: string | null;
  location?: string | null;
  entities?: string[] | string;
  industries?: string[] | string;
  description: string;
  extended_attrs?: Record<string, unknown> | string;
  embedding?: Buffer | null;
}

export function insertRawEvents(rows: RawEventRow[]): number[] {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO raw_events
    (news_id, date, asset, event_group, event_type, time, location,
     entities, industries, description, extended_attrs, embedding, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const ids: number[] = [];
  const tx = d.transaction(() => {
    for (const r of rows) {
      const info = stmt.run(
        r.news_id ?? null, r.date, r.asset ?? "ALL",
        r.event_group, r.event_type, r.time ?? null, r.location ?? null,
        typeof r.entities === "string" ? r.entities : JSON.stringify(r.entities ?? []),
        typeof r.industries === "string" ? r.industries : JSON.stringify(r.industries ?? []),
        r.description,
        typeof r.extended_attrs === "string" ? r.extended_attrs : JSON.stringify(r.extended_attrs ?? {}),
        r.embedding ?? null, now()
      );
      ids.push(info.lastInsertRowid as number);
    }
  });
  tx();
  return ids;
}

// ---------------------------------------------------------------------------
// merged_events
// ---------------------------------------------------------------------------

export interface MergedEventRow {
  date: string;
  asset?: string;
  event_group: string;
  event_type: string;
  time?: string | null;
  location?: string | null;
  entities?: string[] | string;
  industries?: string[] | string;
  description: string;
  extended_attrs?: Record<string, unknown> | string;
  embedding?: Buffer | null;
  source_raw_event_ids?: number[];
  prev_event_id?: number | null;
  chain_depth?: number;
  delta_info?: string | null;
}

export function insertMergedEvents(rows: MergedEventRow[]): number[] {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO merged_events
    (date, asset, event_group, event_type, time, location,
     entities, industries, description, extended_attrs, embedding,
     source_raw_event_ids, prev_event_id, chain_depth, delta_info, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const ids: number[] = [];
  const tx = d.transaction(() => {
    for (const r of rows) {
      const info = stmt.run(
        r.date, r.asset ?? "ALL",
        r.event_group, r.event_type, r.time ?? null, r.location ?? null,
        typeof r.entities === "string" ? r.entities : JSON.stringify(r.entities ?? []),
        typeof r.industries === "string" ? r.industries : JSON.stringify(r.industries ?? []),
        r.description,
        typeof r.extended_attrs === "string" ? r.extended_attrs : JSON.stringify(r.extended_attrs ?? {}),
        r.embedding ?? null,
        JSON.stringify(r.source_raw_event_ids ?? []),
        r.prev_event_id ?? null,
        r.chain_depth ?? 0,
        r.delta_info ?? null,
        now()
      );
      ids.push(info.lastInsertRowid as number);
    }
  });
  tx();
  return ids;
}

// ---------------------------------------------------------------------------
// reflections
// ---------------------------------------------------------------------------

export interface ReflectionRow {
  date: string;
  asset: string;
  window_start: string;
  window_end: string;
  price_direction: string;
  price_change_pct?: number | null;
  reason: string;
  key_events: string[] | string;
  source?: string;
}

export function insertReflection(row: ReflectionRow): number {
  const d = getDb();
  const info = d.prepare(`
    INSERT INTO reflections
    (date, asset, window_start, window_end, price_direction,
     price_change_pct, reason, key_events, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.date, row.asset, row.window_start, row.window_end,
    row.price_direction, row.price_change_pct ?? null,
    row.reason,
    typeof row.key_events === "string" ? row.key_events : JSON.stringify(row.key_events),
    row.source ?? "train", now()
  );
  return info.lastInsertRowid as number;
}

// ---------------------------------------------------------------------------
// predictions
// ---------------------------------------------------------------------------

export interface PredictionRow {
  date: string;
  asset: string;
  predicted_direction: string;
  actual_direction?: string | null;
  reason?: string | null;
  reference_reflection_ids?: number[];
}

export function insertPrediction(row: PredictionRow): number {
  const d = getDb();
  const info = d.prepare(`
    INSERT INTO predictions
    (date, asset, predicted_direction, actual_direction, reason,
     reference_reflection_ids, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.date, row.asset, row.predicted_direction,
    row.actual_direction ?? null, row.reason ?? null,
    JSON.stringify(row.reference_reflection_ids ?? []), now()
  );
  return info.lastInsertRowid as number;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function queryMergedEventsByDateRange(
  startDate: string,
  endDate: string,
  asset?: string
): Record<string, unknown>[] {
  const d = getDb();
  if (asset) {
    return d.prepare(`
      SELECT * FROM merged_events
      WHERE date >= ? AND date <= ? AND (asset = ? OR asset = 'ALL')
      ORDER BY date, id
    `).all(startDate, endDate, asset) as Record<string, unknown>[];
  }
  return d.prepare(`
    SELECT * FROM merged_events
    WHERE date >= ? AND date <= ? ORDER BY date, id
  `).all(startDate, endDate) as Record<string, unknown>[];
}

export function queryReflectionsByIds(ids: number[]): Record<string, unknown>[] {
  if (ids.length === 0) return [];
  const d = getDb();
  const placeholders = ids.map(() => "?").join(",");
  return d.prepare(
    `SELECT * FROM reflections WHERE id IN (${placeholders})`
  ).all(...ids) as Record<string, unknown>[];
}
