import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import type { StoredRecord, DailyJsonInput } from "../types.js";
import { vectorize, computeNormStats } from "../vectorize.js";
import { DB_PATH } from "../config.js";
import { SCHEMA_SQL } from "./schemas.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  return db;
}

export function closeDb(): void {
  if (db) { db.close(); db = null; }
}

export function insertRecords(inputs: DailyJsonInput[]): number[] {
  const d = getDb();
  const stats = computeNormStats(inputs);
  const stmt = d.prepare(
    `INSERT OR REPLACE INTO daily_records (date, asset, json_data, joint_vec)
     VALUES (?, ?, ?, ?)`
  );
  const ids: number[] = [];
  const tx = d.transaction(() => {
    for (const input of inputs) {
      const vec = vectorize(input, stats);
      const info = stmt.run(
        input.date, input.asset,
        JSON.stringify(input),
        JSON.stringify(vec)
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

export function countRecords(): number {
  const d = getDb();
  return (d.prepare("SELECT COUNT(*) as cnt FROM daily_records").get() as { cnt: number }).cnt;
}

export function clearAllRecords(): void {
  const d = getDb();
  d.prepare("DELETE FROM daily_records").run();
}
