/**
 * History Retrieval - Entry point.
 *
 * Implement paper StockMem (2512.02720) Section 3.3:
 *   DailySim = α × Jaccard(typeVec) + (1-α) × Jaccard(groupVec)
 *   SeqSim = (1/W) × Σ DailySim
 *
 * Cach dung:
 *   npx tsx src/index.ts --demo                         # Tao mock + demo
 *   npx tsx src/index.ts --generate-mock                # Tao 3650 ngay mock
 *   npx tsx src/index.ts --search '{...json...}'        # Single-day search
 *   npx tsx src/index.ts --search-window '{...json...}' # Window search + history rhymes
 */

import { getDb, closeDb, insertRecords, getAllRecords, countRecords, clearAllRecords, getPrecedingRecords } from "./database";
import { vectorize } from "./vectorize";
import { searchTopK, searchTopKWindows } from "./search";
import { generateMockData } from "./mock-data-generator";
import { getFactorType } from "./taxonomy";
import type { DailyJsonInput, DayVector, SearchResult, WindowSearchResult } from "./types";

// ----------------------------------------------------------------
// CLI
// ----------------------------------------------------------------

function parseArgs(): { mode: string; searchInput?: string } {
  const args = process.argv.slice(2);

  if (args.includes("--demo")) return { mode: "demo" };
  if (args.includes("--generate-mock")) return { mode: "generate" };

  const windowIdx = args.indexOf("--search-window");
  if (windowIdx >= 0 && args[windowIdx + 1]) {
    return { mode: "search-window", searchInput: args[windowIdx + 1] };
  }

  const searchIdx = args.indexOf("--search");
  if (searchIdx >= 0 && args[searchIdx + 1]) {
    return { mode: "search", searchInput: args[searchIdx + 1] };
  }

  return { mode: "demo" };
}

// ----------------------------------------------------------------
// Generate mock data
// ----------------------------------------------------------------

function doGenerateMock(): void {
  console.log("=== Tao 3650 ngay (10 nam) mock data ===");
  clearAllRecords();
  const mockData = generateMockData("2016-04-05", 3650, "BTC");
  console.log(`Da tao ${mockData.length} ban ghi mock`);
  const ids = insertRecords(mockData);
  console.log(`Da luu ${ids.length} ban ghi vao DB`);
  console.log(`Tong so ban ghi trong DB: ${countRecords()}`);
}

// ----------------------------------------------------------------
// Single-day search
// ----------------------------------------------------------------

function doSearch(input: DailyJsonInput): SearchResult[] {
  const queryVec = vectorize(input);
  const allRecords = getAllRecords();

  if (allRecords.length === 0) {
    console.log("DB trong! Hay chay --generate-mock truoc.");
    return [];
  }

  console.log(`Tim kiem trong ${allRecords.length} ban ghi...`);
  return searchTopK(queryVec, allRecords, 5);
}

function printResults(results: SearchResult[]): void {
  console.log("\n=== Top 5 ket qua tuong tu nhat (DailySim) ===\n");

  for (const r of results) {
    const rec = r.record;
    // Hien thi event types da duoc map
    const types = rec.factors
      .map((f) => getFactorType(f))
      .filter(Boolean);
    const uniqueTypes = [...new Set(types)];

    console.log(`--- #${r.rank} | DailySim: ${r.score} ---`);
    console.log(`  Date:         ${rec.date}`);
    console.log(`  Price:        $${rec.price.toLocaleString("en-US")} (${rec.price_change_pct >= 0 ? "+" : ""}${rec.price_change_pct}%)`);
    console.log(`  Event types:  ${uniqueTypes.join(", ")}`);
    console.log(`  Factors:      ${rec.factors.join("; ")}`);
    console.log("");
  }
}

// ----------------------------------------------------------------
// Window search + History Rhymes
// ----------------------------------------------------------------

function doWindowSearch(input: DailyJsonInput): WindowSearchResult[] {
  const allRecords = getAllRecords();

  if (allRecords.length === 0) {
    console.log("DB trong! Hay chay --generate-mock truoc.");
    return [];
  }

  const W = 5;
  const precedingRecs = getPrecedingRecords(input.date, input.asset, W - 1);

  if (precedingRecs.length < W - 1) {
    console.log(`Chi co ${precedingRecs.length} ngay truoc (can ${W - 1}). Fallback sang single-day search.`);
    const results = doSearch(input);
    printResults(results);
    return [];
  }

  // Build query window: preceding (reversed to ASC) + current
  precedingRecs.reverse();
  const queryWindow: DayVector[] = precedingRecs.map((rec) => ({
    typeVec: JSON.parse(rec.type_vec),
    groupVec: JSON.parse(rec.group_vec),
  }));
  queryWindow.push(vectorize(input));

  const queryStartDate = precedingRecs[0].date;

  console.log(`\nWindow query: ${queryStartDate} -> ${input.date} (${W} ngay)`);
  console.log(`Tim kiem trong ${allRecords.length} ban ghi...`);

  return searchTopKWindows(queryWindow, allRecords, queryStartDate, 5);
}

function printWindowResults(results: WindowSearchResult[]): void {
  console.log("\n=== Top 5 chuoi tuong tu nhat (SeqSim) ===\n");

  for (const r of results) {
    const first = r.window[0];
    const last = r.window[r.window.length - 1];
    console.log(`--- #${r.rank} | SeqSim: ${r.score} ---`);
    console.log(`  Period:   ${first.date} -> ${last.date}`);

    for (const day of r.window) {
      const change = day.price_change_pct >= 0 ? `+${day.price_change_pct}%` : `${day.price_change_pct}%`;
      const types = day.factors.map((f) => getFactorType(f)).filter(Boolean);
      const uniqueTypes = [...new Set(types)];
      console.log(`    ${day.date}: ${change.padEnd(8)} [${uniqueTypes.join(", ")}]`);
    }
    console.log("");
  }
}

// ----------------------------------------------------------------
// Demo
// ----------------------------------------------------------------

function doDemo(): void {
  doGenerateMock();

  const sampleInput: DailyJsonInput = {
    date: "2026-04-05",
    asset: "BTC",
    msi: 72.5,
    rsi: 65.3,
    sentiment_score_avg: 0.72,
    text: "SEC reviewing new Bitcoin spot ETF. Strong whale accumulation this week. CPI lower than expected creating positive sentiment.",
    factors: [
      "SEC reviewing new ETF approval",
      "Strong whale accumulation",
      "CPI lower than expected",
      "Record ETF inflows",
    ],
    fear_greed_index: 68,
    price: 84500,
    price_change_pct: 2.5,
  };

  console.log("\n=== JSON dau vao ===");
  console.log(JSON.stringify(sampleInput, null, 2));

  // Hien thi event types duoc map
  console.log("\n=== Factor -> Event Type mapping ===");
  for (const f of sampleInput.factors) {
    console.log(`  "${f}" -> ${getFactorType(f)}`);
  }

  // Single-day search
  const results = doSearch(sampleInput);
  printResults(results);

  // Window search + History Rhymes
  console.log("\n" + "=".repeat(60));
  console.log("=== Window Search + History Rhymes ===");

  const allRecs = getAllRecords();
  if (allRecs.length >= 10) {
    const testRec = JSON.parse(allRecs[allRecs.length - 5].json_data) as DailyJsonInput;
    console.log(`\nQuery date: ${testRec.date}`);
    console.log(`Factors: ${testRec.factors.join("; ")}`);

    const windowResults = doWindowSearch(testRec);
    if (windowResults.length > 0) {
      printWindowResults(windowResults);
    }
  }
}

// ----------------------------------------------------------------
// Main
// ----------------------------------------------------------------

function main(): void {
  getDb();
  const { mode, searchInput } = parseArgs();

  try {
    switch (mode) {
      case "generate":
        doGenerateMock();
        break;

      case "search": {
        if (!searchInput) {
          console.log("Thieu JSON input. Dung: --search '{...}'");
          break;
        }
        try {
          const input: DailyJsonInput = JSON.parse(searchInput);
          const results = doSearch(input);
          printResults(results);
          console.log("=== Output JSON ===");
          console.log(JSON.stringify(results, null, 2));
        } catch (e: any) {
          console.error("JSON khong hop le:", e.message);
        }
        break;
      }

      case "search-window": {
        if (!searchInput) {
          console.log("Thieu JSON input. Dung: --search-window '{...}'");
          break;
        }
        try {
          const input: DailyJsonInput = JSON.parse(searchInput);
          const results = doWindowSearch(input);
          if (results.length > 0) {
            printWindowResults(results);
            console.log("=== Output JSON ===");
            console.log(JSON.stringify(results, null, 2));
          }
        } catch (e: any) {
          console.error("JSON khong hop le:", e.message);
        }
        break;
      }

      case "demo":
      default:
        doDemo();
        break;
    }
  } finally {
    closeDb();
  }
}

main();
