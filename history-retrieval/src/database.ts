/**
 * SQLite database: luu tru JSON records + type/group vectors.
 *
 * Schema v3: 2 cot vector (type_vec 62d, group_vec 13d) theo paper StockMem.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import type { StoredRecord, DailyJsonInput } from "./types";
import { vectorize } from "./vectorize";

const DB_DIR = path.resolve(__dirname, "..", "data");
const DB_PATH = path.join(DB_DIR, "json-stockmem.db");
const SCHEMA_VERSION = 3;

let db: Database.Database | null = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS daily_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    asset       TEXT    NOT NULL,
    json_data   TEXT    NOT NULL,
    type_vec    TEXT    NOT NULL,
    group_vec   TEXT    NOT NULL,
    UNIQUE(date, asset)
);
CREATE INDEX IF NOT EXISTS idx_daily_records_date ON daily_records(date);
`;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  const row = db.pragma("user_version") as Array<{ user_version: number }>;
  const currentVersion = row[0]?.user_version ?? 0;
  if (currentVersion < SCHEMA_VERSION) {
    db.exec("DROP TABLE IF EXISTS daily_records");
    db.exec(SCHEMA_SQL);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  } else {
    db.exec(SCHEMA_SQL);
  }

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function insertRecord(input: DailyJsonInput): number {
  const d = getDb();
  const vec = vectorize(input);
  const info = d.prepare(`
    INSERT OR REPLACE INTO daily_records (date, asset, json_data, type_vec, group_vec)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    input.date,
    input.asset,
    JSON.stringify(input),
    JSON.stringify(vec.typeVec),
    JSON.stringify(vec.groupVec)
  );
  return info.lastInsertRowid as number;
}

export function insertRecords(inputs: DailyJsonInput[]): number[] {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT OR REPLACE INTO daily_records (date, asset, json_data, type_vec, group_vec)
    VALUES (?, ?, ?, ?, ?)
  `);
  const ids: number[] = [];
  const tx = d.transaction(() => {
    for (const input of inputs) {
      const vec = vectorize(input);
      const info = stmt.run(
        input.date,
        input.asset,
        JSON.stringify(input),
        JSON.stringify(vec.typeVec),
        JSON.stringify(vec.groupVec)
      );
      ids.push(info.lastInsertRowid as number);
    }
  });
  tx();
  return ids;
}

export function getAllRecords(): StoredRecord[] {
  const d = getDb();
  return d.prepare("SELECT * FROM daily_records ORDER BY date").all() as StoredRecord[];
}

export function getRecordById(id: number): StoredRecord | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM daily_records WHERE id = ?").get(id) as StoredRecord | undefined;
  return row ?? null;
}

/**
 * Lay N ban ghi truoc 1 ngay cu the (cho window query).
 * Tra ve sorted by date DESC (can reverse khi dung).
 */
export function getPrecedingRecords(date: string, asset: string, count: number): StoredRecord[] {
  const d = getDb();
  return d.prepare(
    `SELECT * FROM daily_records
     WHERE date < ? AND asset = ?
     ORDER BY date DESC
     LIMIT ?`
  ).all(date, asset, count) as StoredRecord[];
}

export function countRecords(): number {
  const d = getDb();
  const row = d.prepare("SELECT COUNT(*) as cnt FROM daily_records").get() as any;
  return row.cnt;
}

export function clearAllRecords(): void {
  const d = getDb();
  d.prepare("DELETE FROM daily_records").run();
}
