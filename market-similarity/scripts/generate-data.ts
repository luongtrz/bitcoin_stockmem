/**
 * Generate simulated Bitcoin market data for 12 months (Jan–Dec 2025).
 * Output: data/January.json, data/February.json, ...
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// --- Random helpers ---

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- News summary templates ---

const BULLISH_SUMMARIES = [
  "Bitcoin rallied as institutional investors increased exposure. ETF inflows hit ${vol} million, signaling strong demand.",
  "Markets surged on positive regulatory developments in ${region}. Whale accumulation detected on-chain with large transfers to cold wallets.",
  "Strong buying pressure pushed BTC higher. ${entity} announced major crypto adoption, boosting market confidence.",
  "Bitcoin climbed amid dovish central bank signals. Trading volumes rose ${vol}% as momentum traders joined the rally.",
  "Bullish breakout confirmed as BTC cleared key resistance at ${level}K. Funding rates turned positive across major exchanges.",
  "Crypto markets advanced on news of ${entity} integrating Bitcoin payments. On-chain metrics showed healthy accumulation patterns.",
  "Bitcoin gained as macro conditions improved. DXY weakened and treasury yields fell, supporting risk assets.",
  "Markets pushed higher following ${entity}'s $${vol}M Bitcoin purchase. Short sellers liquidated as price broke resistance.",
  "BTC surged on reports of sovereign wealth fund crypto allocation. ETF volumes hit new daily record of $${vol}M.",
  "Positive sentiment drove Bitcoin higher as ${region} approved new crypto-friendly legislation. Mining hashrate reached all-time high.",
];

const BEARISH_SUMMARIES = [
  "Bitcoin dropped amid regulatory crackdown concerns in ${region}. Exchange outflows spiked as investors moved to stablecoins.",
  "Markets fell sharply as ${entity} dumped ${vol}K BTC on exchanges. Fear and greed index dropped to extreme fear territory.",
  "Sharp sell-off triggered by unexpected ${macro} data. Risk-off sentiment spread across all crypto assets.",
  "Bitcoin declined on profit-taking after recent rally. Whale wallets distributed ${vol}K BTC over the past 24 hours.",
  "Crypto markets slumped following ${entity} regulatory investigation. Trading volumes surged ${vol}% on panic selling.",
  "BTC broke key support at ${level}K, triggering cascading liquidations. Over $${vol}M in long positions wiped out.",
  "Market crashed as ${region} announced stricter crypto regulations. Stablecoin reserves on exchanges hit record highs.",
  "Bitcoin fell as stronger dollar and rising yields pressured risk assets. ${macro} concerns weighed on sentiment.",
  "Bearish reversal as whales moved ${vol}K BTC to exchanges. Funding rates turned deeply negative across platforms.",
  "Selling pressure intensified after ${entity} reported security breach. Market cap lost $${vol}B in 24 hours.",
];

const NEUTRAL_SUMMARIES = [
  "Bitcoin traded sideways as markets awaited ${macro} decision. Volume declined ${vol}% from weekly average.",
  "Consolidation continued with BTC range-bound between ${level}K and ${level2}K. Open interest remained flat.",
  "Mixed signals as on-chain data showed accumulation but exchange volumes dropped. ${region} regulatory clarity still pending.",
  "Quiet session for Bitcoin with minimal volatility. Traders positioned ahead of upcoming ${macro} announcement.",
  "Markets held steady as macro conditions provided no clear direction. Funding rates normalized near zero.",
];

const ENTITIES = [
  "BlackRock", "MicroStrategy", "Tesla", "Goldman Sachs", "JPMorgan",
  "Fidelity", "Grayscale", "Coinbase", "Binance", "Galaxy Digital",
  "ARK Invest", "VanEck", "Deutsche Bank", "Morgan Stanley", "Citadel",
];

const REGIONS = [
  "the US", "EU", "China", "Japan", "South Korea",
  "Hong Kong", "Singapore", "UAE", "UK", "India",
];

const MACROS = [
  "CPI inflation", "employment", "Fed rate", "GDP growth",
  "PMI", "retail sales", "housing", "wage growth",
];

function fillTemplate(template: string, price: number): string {
  return template
    .replace(/\$\{entity\}/g, pick(ENTITIES))
    .replace(/\$\{region\}/g, pick(REGIONS))
    .replace(/\$\{macro\}/g, pick(MACROS))
    .replace(/\$\{vol\}/g, String(randInt(100, 900)))
    .replace(/\$\{level\}/g, String(Math.round(price / 1000)))
    .replace(/\$\{level2\}/g, String(Math.round(price / 1000) + randInt(1, 3)));
}

function generateSummary(pctChange: number, price: number): string {
  if (pctChange > 1.0) return fillTemplate(pick(BULLISH_SUMMARIES), price);
  if (pctChange < -1.0) return fillTemplate(pick(BEARISH_SUMMARIES), price);
  return fillTemplate(pick(NEUTRAL_SUMMARIES), price);
}

// --- Factor generation ---
// 5 factors: momentum, volatility, volume_ratio, sentiment, correlation
function generateFactors(pctChange: number, arm: number): number[] {
  const momentum = pctChange * 0.3 + rand(-0.3, 0.3);
  const volatility = Math.abs(pctChange) * 0.2 + rand(0.1, 0.5);
  const volumeRatio = arm > 1 ? rand(-0.5, 0.2) : rand(0.0, 0.7);
  const sentiment = pctChange > 0 ? rand(0.1, 0.8) : rand(-0.8, -0.1);
  const correlation = rand(-0.5, 0.5);
  return [
    Math.round(momentum * 100) / 100,
    Math.round(volatility * 100) / 100,
    Math.round(volumeRatio * 100) / 100,
    Math.round(sentiment * 100) / 100,
    Math.round(correlation * 100) / 100,
  ];
}

// --- Main generation ---

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// Yearly starting prices and monthly biases to simulate multi-year BTC history
const YEARLY_PROFILES: Record<number, { startPrice: number; bias: number[] }> = {
  2021: {
    startPrice: 29000,
    bias: [1.5, 2.0, 1.5, 1.0, -2.0, -1.5, -1.0, 0.5, -0.5, 1.5, 1.0, -1.0],
  },
  2022: {
    startPrice: 47000,
    bias: [-0.5, -1.0, 0.5, -1.0, -2.5, -2.0, 0.5, -0.5, -1.0, 0.5, -2.0, -1.0],
  },
  2023: {
    startPrice: 16500,
    bias: [2.0, 0.5, 1.0, 0.5, -0.5, 1.5, 0.5, -0.5, -0.3, 1.5, 1.0, 1.5],
  },
  2024: {
    startPrice: 42000,
    bias: [1.0, 2.0, 2.5, -0.5, 0.5, -0.5, 1.0, -1.0, 0.5, 1.0, 2.5, -0.5],
  },
  2025: {
    startPrice: 42000,
    bias: [0.3, 0.5, 1.0, 1.5, 2.0, 1.0, -0.5, -1.0, 0.5, 1.5, 2.0, -0.5],
  },
};

function generate(): void {
  const years = [2021, 2022, 2023, 2024, 2025];

  for (const year of years) {
    const profile = YEARLY_PROFILES[year];
    let price = profile.startPrice + rand(-2000, 2000);

    for (let m = 0; m < 12; m++) {
      const days = daysInMonth(year, m);
      const records: any[] = [];
      const bias = profile.bias[m];

      for (let d = 1; d <= days; d++) {
        const dateStr = `${year}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

        const dailyVol = rand(0.5, 4.0);
        const pctChange = Math.round((bias * 0.1 + rand(-dailyVol, dailyVol)) * 100) / 100;

        price = Math.round(price * (1 + pctChange / 100));
        price = Math.max(price, 10000);

        const arm = pctChange < -1
          ? Math.round(rand(1.1, 1.8) * 100) / 100
          : pctChange > 1
            ? Math.round(rand(0.5, 0.95) * 100) / 100
            : Math.round(rand(0.85, 1.15) * 100) / 100;

        const srm = pctChange < -2
          ? Math.round(rand(0.8, 1.0) * 100) / 100
          : pctChange > 2
            ? Math.round(rand(0.3, 0.55) * 100) / 100
            : Math.round(rand(0.5, 0.8) * 100) / 100;

        records.push({
          date: dateStr,
          price,
          arm,
          srm,
          factor_array: generateFactors(pctChange, arm),
          pct_change: pctChange,
          text_summary: generateSummary(pctChange, price),
        });
      }

      const monthName = MONTHS[m];
      const outPath = path.join(DATA_DIR, `${year}-${monthName}.json`);
      fs.writeFileSync(outPath, JSON.stringify(records, null, 2));
      console.log(`${year} ${monthName}: ${records.length} days, price ${Math.min(...records.map(r => r.price))}–${Math.max(...records.map(r => r.price))}`);
    }
  }
}

generate();
