/**
 * In-memory data store for serverless deployment.
 * Loads pre-bundled data from data/bundle.json.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { StoredRecord } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = path.join(__dirname, "..", "..", "data", "bundle.json");

let records: StoredRecord[] | null = null;

export function getAllRecords(): StoredRecord[] {
  if (records) return records;
  records = JSON.parse(fs.readFileSync(BUNDLE_PATH, "utf-8")) as StoredRecord[];
  return records;
}
