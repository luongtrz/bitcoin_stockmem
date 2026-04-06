/**
 * SQLite database: luu tru JSON records + vectors.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import type { StoredRecord, DailyJsonInput } from "./types";
import { vectorize } from "./vectorize";

const DB_DIR = path.resolve(__dirname, "..", "data");
const DB_PATH = path.join(DB_DIR, "json-stockmem.db");

let db: Database.Database | null = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS daily_records (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    date      TEXT    NOT NULL,
    asset     TEXT    NOT NULL,
    json_data TEXT    NOT NULL,
    vector    TEXT    NOT NULL,
    UNIQUE(date, asset)
);
CREATE INDEX IF NOT EXISTS idx_daily_records_date ON daily_records(date);
`;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
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

/**
 * Chen 1 ban ghi JSON vao DB. Tu dong vectorize.
 */
export function insertRecord(input: DailyJsonInput): number {
  const d = getDb();
  const vec = vectorize(input);
  const info = d.prepare(`
    INSERT OR REPLACE INTO daily_records (date, asset, json_data, vector)
    VALUES (?, ?, ?, ?)
  `).run(
    input.date,
    input.asset,
    JSON.stringify(input),
    JSON.stringify(vec)
  );
  return info.lastInsertRowid as number;
}

/**
 * Chen nhieu ban ghi (batch insert trong transaction).
 */
export function insertRecords(inputs: DailyJsonInput[]): number[] {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT OR REPLACE INTO daily_records (date, asset, json_data, vector)
    VALUES (?, ?, ?, ?)
  `);
  const ids: number[] = [];
  const tx = d.transaction(() => {
    for (const input of inputs) {
      const vec = vectorize(input);
      const info = stmt.run(
        input.date,
        input.asset,
        JSON.stringify(input),
        JSON.stringify(vec)
      );
      ids.push(info.lastInsertRowid as number);
    }
  });
  tx();
  return ids;
}

/**
 * Doc tat ca ban ghi tu DB.
 */
export function getAllRecords(): StoredRecord[] {
  const d = getDb();
  return d.prepare("SELECT * FROM daily_records ORDER BY date").all() as StoredRecord[];
}

/**
 * Doc 1 ban ghi theo ID.
 */
export function getRecordById(id: number): StoredRecord | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM daily_records WHERE id = ?").get(id) as StoredRecord | undefined;
  return row ?? null;
}

/**
 * Dem so ban ghi.
 */
export function countRecords(): number {
  const d = getDb();
  const row = d.prepare("SELECT COUNT(*) as cnt FROM daily_records").get() as any;
  return row.cnt;
}

/**
 * Xoa toan bo ban ghi (dung khi re-generate mock data).
 */
export function clearAllRecords(): void {
  const d = getDb();
  d.prepare("DELETE FROM daily_records").run();
}
