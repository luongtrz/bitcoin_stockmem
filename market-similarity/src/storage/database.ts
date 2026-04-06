import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { DB_PATH } from "../config.js";
import { SCHEMA_SQL } from "./schemas.js";

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

function now(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// ---------------------------------------------------------------------------
// market_days
// ---------------------------------------------------------------------------

export interface MarketDayRow {
  id?: number;
  date: string;
  price: number;
  arm: number;
  srm: number;
  factor_array: number[] | string;
  pct_change: number;
  text_summary: string;
  hybrid_vector?: Buffer | null;
  num_dims: number;
  created_at?: string;
}

export function insertMarketDay(row: MarketDayRow): number {
  const d = getDb();
  const info = d
    .prepare(
      `INSERT INTO market_days
      (date, price, arm, srm, factor_array, pct_change, text_summary,
       hybrid_vector, num_dims, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.date,
      row.price,
      row.arm,
      row.srm,
      typeof row.factor_array === "string"
        ? row.factor_array
        : JSON.stringify(row.factor_array),
      row.pct_change,
      row.text_summary,
      row.hybrid_vector ?? null,
      row.num_dims,
      now()
    );
  return info.lastInsertRowid as number;
}

export function getMarketDayById(id: number): MarketDayRow | null {
  const d = getDb();
  return (d.prepare("SELECT * FROM market_days WHERE id = ?").get(id) as MarketDayRow) ?? null;
}

export function getMarketDayByDate(date: string): MarketDayRow | null {
  const d = getDb();
  return (d.prepare("SELECT * FROM market_days WHERE date = ?").get(date) as MarketDayRow) ?? null;
}

export function getAllMarketDays(): MarketDayRow[] {
  const d = getDb();
  return d.prepare("SELECT * FROM market_days ORDER BY date").all() as MarketDayRow[];
}

export function getAllMarketDayVectors(): Array<{ id: number; hybrid_vector: Buffer }> {
  const d = getDb();
  return d
    .prepare("SELECT id, hybrid_vector FROM market_days WHERE hybrid_vector IS NOT NULL")
    .all() as Array<{ id: number; hybrid_vector: Buffer }>;
}

export function updateMarketDayVector(id: number, vector: Buffer): void {
  const d = getDb();
  d.prepare("UPDATE market_days SET hybrid_vector = ? WHERE id = ?").run(vector, id);
}

// ---------------------------------------------------------------------------
// market_days_meta
// ---------------------------------------------------------------------------

export function getMeta(key: string): string | null {
  const d = getDb();
  const row = d.prepare("SELECT value FROM market_days_meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  const d = getDb();
  d.prepare(
    "INSERT INTO market_days_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?"
  ).run(key, value, value);
}
