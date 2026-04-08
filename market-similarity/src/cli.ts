import "dotenv/config";
import fs from "fs";
import { getDb, closeDb, getAllRecords, countRecords } from "./storage/database.js";
import { indexBatch, findSimilarDays, findSimilarWindows } from "./store.js";
import type { DailyJsonInput } from "./types.js";

function printUsage(): void {
  console.log(`
Usage: npx tsx src/cli.ts <command> [options]

Commands:
  index   --file <path.json> | --json '<json>'   Index market day(s)
  search  --json '<json>' [--k <number>]         1 object → DailySim (single-day)
                                                  1 array  → SeqSim  (window W days)
  list                                            List all indexed days
`);
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      result[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return result;
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  getDb();

  try {
    switch (command) {
      case "index": {
        const opts = parseArgs(args.slice(1));
        if (opts.file) {
          const data = JSON.parse(fs.readFileSync(opts.file, "utf-8"));
          const items: DailyJsonInput[] = Array.isArray(data) ? data : [data];
          console.log(`Indexing ${items.length} market day(s)...`);
          const ids = indexBatch(items);
          console.log(`Indexed ${ids.length} record(s)`);
        } else if (opts.json) {
          const data = JSON.parse(opts.json);
          const items: DailyJsonInput[] = Array.isArray(data) ? data : [data];
          const ids = indexBatch(items);
          console.log(`Indexed ${ids.length} record(s)`);
        } else {
          console.error("Error: --file or --json required");
          process.exit(1);
        }
        break;
      }

      case "search": {
        const opts = parseArgs(args.slice(1));
        if (!opts.json) { console.error("Error: --json required"); process.exit(1); }
        const parsed = JSON.parse(opts.json);
        const k = opts.k ? parseInt(opts.k, 10) : 5;

        if (Array.isArray(parsed)) {
          const results = findSimilarWindows(parsed as DailyJsonInput[], k);
          console.log(JSON.stringify(results, null, 2));
        } else {
          const results = findSimilarDays(parsed as DailyJsonInput, k);
          console.log(JSON.stringify(results, null, 2));
        }
        break;
      }

      case "list": {
        const total = countRecords();
        if (total === 0) { console.log("No records indexed."); break; }
        const rows = getAllRecords();
        console.log(`Total: ${total} record(s)\n`);
        for (const row of rows) {
          const d: DailyJsonInput = JSON.parse(row.json_data);
          const pct = (d.price_change_pct >= 0 ? "+" : "") + d.price_change_pct.toFixed(2);
          console.log(`${d.date}  ${d.asset}  $${d.price.toFixed(0).padStart(7)}  ${pct.padStart(6)}%  [${d.factors.length} factors]`);
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } finally {
    closeDb();
  }
}

main();
