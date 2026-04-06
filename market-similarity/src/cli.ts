import "dotenv/config";
import fs from "fs";
import { getDb, closeDb, getAllMarketDays } from "./storage/database.js";
import { shutdown } from "./embeddings/embed.js";
import { indexMarketDay, indexBatch, findSimilarDays } from "./store.js";
import { reindexAll } from "./vectorizer.js";

function printUsage(): void {
  console.log(`
Usage: npx tsx src/cli.ts <command> [options]

Commands:
  index   --file <path.json> | --json '<json>'   Index market day(s)
  search  --json '<json>' [--k <number>]          Find top-K similar days
  reindex                                          Recompute all vectors
  list                                             List all indexed days
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  // Initialize DB
  getDb();

  try {
    switch (command) {
      case "index": {
        const opts = parseArgs(args.slice(1));

        if (opts.file) {
          const raw = fs.readFileSync(opts.file, "utf-8");
          const data = JSON.parse(raw);
          const items = Array.isArray(data) ? data : [data];
          console.log(`Indexing ${items.length} market day(s)...`);
          const ids = await indexBatch(items);
          console.log(`Indexed ${ids.length} record(s)`);
        } else if (opts.json) {
          const data = JSON.parse(opts.json);
          const id = await indexMarketDay(data);
          console.log(`Indexed market day with id=${id}`);
        } else {
          console.error("Error: --file or --json required");
          process.exit(1);
        }
        break;
      }

      case "search": {
        const opts = parseArgs(args.slice(1));
        if (!opts.json) {
          console.error("Error: --json required");
          process.exit(1);
        }
        const query = JSON.parse(opts.json);
        const k = opts.k ? parseInt(opts.k, 10) : 5;
        const results = await findSimilarDays(query, k);

        if (results.length === 0) {
          console.log("No indexed days found. Index some data first.");
        } else {
          console.log(JSON.stringify(results, null, 2));
        }
        break;
      }

      case "reindex": {
        console.log("Reindexing all vectors...");
        const count = await reindexAll();
        console.log(`Reindexed ${count} record(s)`);
        break;
      }

      case "list": {
        const rows = getAllMarketDays();
        if (rows.length === 0) {
          console.log("No market days indexed yet.");
        } else {
          console.log(`Total: ${rows.length} market day(s)\n`);
          console.log("Date           Price      ARM    SRM    %Chg    Factors");
          console.log("─".repeat(70));
          for (const row of rows) {
            const factors: number[] =
              typeof row.factor_array === "string"
                ? JSON.parse(row.factor_array)
                : row.factor_array;
            console.log(
              `${row.date}  ${String(row.price).padStart(10)}  ${row.arm.toFixed(2).padStart(5)}  ${row.srm.toFixed(2).padStart(5)}  ${(row.pct_change >= 0 ? "+" : "") + row.pct_change.toFixed(2).padStart(5)}%  [${factors.map((f) => f.toFixed(2)).join(", ")}]`
            );
          }
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } finally {
    shutdown();
    closeDb();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  shutdown();
  closeDb();
  process.exit(1);
});
