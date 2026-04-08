/**
 * Pre-bundle all JSON data + vectorize into a single file for serverless.
 * Output: data/bundle.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { vectorize, computeNormStats } from "../src/vectorize.js";
import type { DailyJsonInput } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

function main() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json") && f !== "bundle.json");
  files.sort();

  const allDays: DailyJsonInput[] = [];
  for (const f of files) {
    allDays.push(...JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf-8")));
  }

  const stats = computeNormStats(allDays);

  const records = allDays.map((day, i) => ({
    id: i + 1,
    date: day.date,
    asset: day.asset,
    json_data: JSON.stringify(day),
    joint_vec: JSON.stringify(vectorize(day, stats)),
  }));

  const outPath = path.join(DATA_DIR, "bundle.json");
  fs.writeFileSync(outPath, JSON.stringify(records));
  const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  console.log(`Bundled ${records.length} records → ${outPath} (${sizeMB} MB)`);
}

main();
