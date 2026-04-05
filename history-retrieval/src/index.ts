/**
 * History Retrieval - Entry point.
 *
 * Cach dung:
 *   npx tsx src/index.ts --generate-mock        # Tao 365 ngay mock data
 *   npx tsx src/index.ts --search '{...json...}' # Tim Top 5 tuong tu
 *   npx tsx src/index.ts --demo                  # Tao mock + chay demo search
 */

import { getDb, closeDb, insertRecords, getAllRecords, countRecords, clearAllRecords } from "./database";
import { vectorize } from "./vectorize";
import { searchTopK } from "./search";
import { generateMockData } from "./mock-data-generator";
import type { DailyJsonInput, SearchResult } from "./types";

// ----------------------------------------------------------------
// CLI
// ----------------------------------------------------------------

function parseArgs(): { mode: string; searchInput?: string } {
  const args = process.argv.slice(2);

  if (args.includes("--demo")) return { mode: "demo" };
  if (args.includes("--generate-mock")) return { mode: "generate" };

  const searchIdx = args.indexOf("--search");
  if (searchIdx >= 0 && args[searchIdx + 1]) {
    return { mode: "search", searchInput: args[searchIdx + 1] };
  }

  return { mode: "demo" }; // mac dinh chay demo
}

// ----------------------------------------------------------------
// Generate mock data
// ----------------------------------------------------------------

function doGenerateMock(): void {
  console.log("=== Tao 365 ngay mock data ===");

  clearAllRecords();

  const startDate = "2025-04-05"; // 1 nam truoc
  const mockData = generateMockData(startDate, 365, "BTC");

  console.log(`Da tao ${mockData.length} ban ghi mock`);

  const ids = insertRecords(mockData);
  console.log(`Da luu ${ids.length} ban ghi vao DB`);
  console.log(`Tong so ban ghi trong DB: ${countRecords()}`);
}

// ----------------------------------------------------------------
// Search
// ----------------------------------------------------------------

function doSearch(input: DailyJsonInput): SearchResult[] {
  const queryVec = vectorize(input);
  const allRecords = getAllRecords();

  if (allRecords.length === 0) {
    console.log("DB trong! Hay chay --generate-mock truoc.");
    return [];
  }

  console.log(`Tim kiem trong ${allRecords.length} ban ghi...`);
  const results = searchTopK(queryVec, allRecords, 5);
  return results;
}

function printResults(results: SearchResult[]): void {
  console.log("\n=== Top 5 ket qua tuong tu nhat ===\n");

  for (const r of results) {
    const rec = r.record;
    console.log(`--- #${r.rank} | Score: ${r.score} ---`);
    console.log(`  Date:             ${rec.date}`);
    console.log(`  Price:            $${rec.price.toLocaleString("en-US")}`);
    console.log(`  Price Change:     ${rec.price_change_pct}%`);
    console.log(`  RSI:              ${rec.rsi}`);
    console.log(`  MSI:              ${rec.msi}`);
    console.log(`  Fear & Greed:     ${rec.fear_greed_index}`);
    console.log(`  Sentiment:        ${rec.sentiment_score_avg}`);
    console.log(`  Factors:          ${rec.factors.join("; ")}`);
    console.log(`  Text:             ${rec.text.slice(0, 120)}...`);
    console.log("");
  }
}

// ----------------------------------------------------------------
// Demo
// ----------------------------------------------------------------

function doDemo(): void {
  // Buoc 1: Tao mock data
  doGenerateMock();

  // Buoc 2: Tao 1 JSON dau vao de search
  const sampleInput: DailyJsonInput = {
    date: "2026-04-05",
    asset: "BTC",
    msi: 72.5,
    rsi: 65.3,
    sentiment_score_avg: 0.72,
    text: "SEC dang xem xet phe duyet them Bitcoin ETF spot. Whale tich luy manh trong tuan qua. Chi so CPI thap hon ky vong tao tam ly tich cuc.",
    factors: [
      "SEC xem xet phe duyet ETF moi",
      "Whale tich luy manh",
      "Chi so CPI thap hon ky vong",
      "ETF inflow ky luc",
    ],
    fear_greed_index: 68,
    price: 84500,
    price_change_pct: 2.5,
  };

  console.log("\n=== JSON dau vao ===");
  console.log(JSON.stringify(sampleInput, null, 2));

  // Buoc 3: Tim kiem
  const results = doSearch(sampleInput);
  printResults(results);

  // Buoc 4: Xuat ket qua JSON
  console.log("=== Output JSON ===");
  console.log(JSON.stringify(results, null, 2));
}

// ----------------------------------------------------------------
// Main
// ----------------------------------------------------------------

function main(): void {
  getDb(); // Khoi tao DB

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
