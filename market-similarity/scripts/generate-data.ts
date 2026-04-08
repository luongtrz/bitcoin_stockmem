/**
 * Generate 5 years of mock BTC data using regime-based generator
 * from history-retrieval (StockMem reference).
 *
 * Output: data/YYYY.json per year
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { DailyJsonInput } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

// ----------------------------------------------------------------
// Re-use regime-based generator from history-retrieval
// (Copy logic directly to avoid cross-project import)
// ----------------------------------------------------------------

interface Regime {
  name: string;
  primaryFactors: string[];
  secondaryFactors: string[];
  priceBias: number;
  volatility: [number, number];
  duration: [number, number];
  numFactors: [number, number];
}

// Background factors: appear in any regime (macro, on-chain, market structure)
// Giong thuc te: moi ngay luon co tin macro, on-chain data, exchange flows
const BACKGROUND_FACTORS = [
  "Analyst opinions divided", "Neutral industry report", "Normal on-chain flow",
  "Market cap stable", "No notable macro data", "DXY sideways",
  "Routine developer milestone", "Minor sector rotation", "Open interest stable",
  "Industry report compilation", "Hashrate unchanged", "Neutral funding rate",
  "Protocol proposal under review", "New testnet under testing",
  "Weekend options expiry", "Crypto conference in Europe", "US Congress crypto hearing",
  "Consolidation phase - accumulation", "Market sideways waiting for signal",
  "Bitcoin Pizza Day - no price impact",
];

const REGIMES: Record<string, Regime> = {
  MACRO_TIGHTENING: {
    name: "Macro Tightening",
    primaryFactors: [
      "Fed raises interest rate", "CPI higher than expected",
      "Dollar index surging", "Bond yield rising - risk for crypto",
      "Volume declining - liquidity drying up", "US debt ceiling concerns",
      "Stablecoin outflows from exchanges", "Significant ETF outflows",
      "Strong whale selling", "Large market liquidations",
      "BTC dominance declining", "Extreme greed index - correction risk",
    ],
    secondaryFactors: [
      "Regulatory risk from EU", "Systemic risk concerns",
      "Miner selling pressure increasing", "Whale sends large BTC to exchange",
      "Leverage ratio too high - cascade liquidation risk",
      "Tether FUD - reserve concerns", "Exchange insolvency concerns",
      "Dormant BTC wallet suddenly moves funds",
      "SEC investigates staking services", "CBDC competing with crypto",
      "Nasdaq positively correlated with crypto", "Gold positively correlated with BTC",
      "Mt. Gox distributing BTC to creditors",
    ],
    priceBias: -0.6, volatility: [1.5, 4.5], duration: [14, 45], numFactors: [4, 8],
  },
  CRYPTO_CONTAGION: {
    name: "Crypto Contagion",
    primaryFactors: [
      "FTX exchange collapse event", "Terra Luna collapse impact",
      "Celsius Network freezes withdrawals", "Genesis Trading halts operations",
      "Three Arrows Capital bankruptcy", "Exchange insolvency concerns",
      "Large market liquidations", "Systemic risk concerns",
      "Strong whale selling", "Whale sends large BTC to exchange",
      "Leverage ratio too high - cascade liquidation risk",
      "Major exchange hack", "Major project rug pull",
    ],
    secondaryFactors: [
      "Significant ETF outflows", "USDC temporary depeg",
      "Silvergate Bank closes", "Stablecoin outflows from exchanges",
      "SEC investigates staking services", "Volume declining - liquidity drying up",
      "Fed raises interest rate", "Regulatory risk from EU",
      "CPI higher than expected", "Miner selling pressure increasing",
      "Dormant BTC wallet suddenly moves funds", "Legal action against founder",
      "Tether FUD - reserve concerns", "Dollar index surging",
      "BTC dominance declining", "Bond yield rising - risk for crypto",
    ],
    priceBias: -0.8, volatility: [3, 12], duration: [7, 30], numFactors: [5, 8],
  },
  INSTITUTIONAL_BULL: {
    name: "Institutional Bull Run",
    primaryFactors: [
      "Record ETF inflows", "Institutional adoption increasing",
      "Strong whale accumulation", "BlackRock increases BTC holdings",
      "MicroStrategy buys more BTC", "Significant volume surge",
      "Stablecoin inflows to exchanges rising", "Grayscale GBTC premium rising",
      "Bitcoin spot volume hits record", "BTC dominance rising",
      "Positive on-chain metrics", "Coinbase revenue beats expectations",
    ],
    secondaryFactors: [
      "SEC reviewing new ETF approval", "Bitcoin ETF options approved",
      "Partnership with major bank", "Major corporation accepts BTC payments",
      "JP Morgan positive outlook on BTC", "Fidelity opens BTC custody service",
      "New payment integration", "El Salvador increases BTC reserves",
      "Lightning Network adoption growing", "Developer activity surging",
      "DeFi TVL on Bitcoin rising", "Successful protocol upgrade",
      "New Layer 2 scaling solution", "Tether minting USDT - liquidity flowing in",
      "Fed holds interest rate steady", "CPI lower than expected",
      "DXY dollar index declining", "Gold positively correlated with BTC",
      "Nasdaq positively correlated with crypto",
    ],
    priceBias: 0.7, volatility: [1, 5], duration: [21, 60], numFactors: [4, 8],
  },
  FED_PIVOT: {
    name: "Fed Pivot / Rate Cut",
    primaryFactors: [
      "Fed holds interest rate steady", "Fed pivot signal - market expects rate cut",
      "CPI lower than expected", "DXY dollar index declining",
      "US Treasury yield falling - capital flows to risk assets",
      "Gold positively correlated with BTC", "Nasdaq positively correlated with crypto",
      "Stablecoin inflows to exchanges rising",
    ],
    secondaryFactors: [
      "Record ETF inflows", "Institutional adoption increasing",
      "Strong whale accumulation", "BlackRock increases BTC holdings",
      "Significant volume surge", "BTC dominance rising",
      "Positive on-chain metrics", "Bitcoin spot volume hits record",
      "Coinbase revenue beats expectations", "Binance Proof of Reserve stable",
      "Developer activity surging", "New Layer 2 scaling solution",
      "Partnership with major bank", "Lightning Network adoption growing",
      "Central bank record gold buying - bullish for BTC",
    ],
    priceBias: 0.5, volatility: [1, 4], duration: [14, 45], numFactors: [4, 7],
  },
  MINING_STRESS: {
    name: "Mining Sector Stress",
    primaryFactors: [
      "Mining difficulty adjustment decreasing", "Hash rate recovering after sell-off",
      "Miner selling pressure increasing", "Mining ban in Kazakhstan",
      "Iran temporary mining ban", "China tightens crypto regulations again",
      "Hash rate hits new all-time high", "Supply decreasing due to halving effect",
    ],
    secondaryFactors: [
      "Strong whale selling", "Large market liquidations",
      "Dormant BTC wallet suddenly moves funds", "Volume declining - liquidity drying up",
      "Systemic risk concerns", "Regulatory concerns from China",
      "Exchange insolvency concerns", "Significant ETF outflows",
      "BTC dominance declining", "Stablecoin outflows from exchanges",
      "Bond yield rising - risk for crypto", "CPI higher than expected",
      "Whale sends large BTC to exchange", "Leverage ratio too high - cascade liquidation risk",
    ],
    priceBias: -0.4, volatility: [2, 6], duration: [10, 30], numFactors: [4, 7],
  },
  REGULATORY_CRACKDOWN: {
    name: "Regulatory Crackdown",
    primaryFactors: [
      "SEC rejects new ETF", "SEC sues Binance and Coinbase",
      "SEC investigates staking services", "Regulatory risk from EU",
      "Regulatory concerns from China", "CBDC competing with crypto",
      "US Congress crypto hearing", "Legal action against founder",
      "Tether FUD - reserve concerns",
    ],
    secondaryFactors: [
      "Significant ETF outflows", "Exchange insolvency concerns",
      "Volume declining - liquidity drying up", "Strong whale selling",
      "Stablecoin outflows from exchanges", "Fed raises interest rate",
      "Large market liquidations", "CPI higher than expected",
      "Grayscale GBTC discount widening", "BTC dominance declining",
      "Dollar index surging", "Major project rug pull",
      "Systemic risk concerns", "Miner selling pressure increasing",
      "Whale sends large BTC to exchange", "Major exchange hack",
      "Extreme greed index - correction risk",
    ],
    priceBias: -0.5, volatility: [1.5, 5], duration: [14, 60], numFactors: [4, 7],
  },
  SUPPLY_SHOCK: {
    name: "Supply Shock / Halving",
    primaryFactors: [
      "Supply decreasing due to halving effect", "Hash rate hits new all-time high",
      "Strong whale accumulation", "BTC dominance rising",
      "Significant volume surge", "Bitcoin spot volume hits record",
      "Mining difficulty adjustment decreasing",
    ],
    secondaryFactors: [
      "Positive on-chain metrics", "Institutional adoption increasing",
      "Record ETF inflows", "Lightning Network adoption growing",
      "Ordinals and BRC-20 adoption growing", "Developer activity surging",
      "Stablecoin inflows to exchanges rising", "New Layer 2 scaling solution",
      "DeFi TVL on Bitcoin rising", "Successful protocol upgrade",
      "Grayscale GBTC premium rising", "BlackRock increases BTC holdings",
      "MicroStrategy buys more BTC", "Coinbase revenue beats expectations",
      "Tether minting USDT - liquidity flowing in",
      "Central bank record gold buying - bullish for BTC",
    ],
    priceBias: 0.6, volatility: [1.5, 5], duration: [30, 90], numFactors: [4, 8],
  },
  NEUTRAL_CONSOLIDATION: {
    name: "Consolidation",
    primaryFactors: [
      "Market sideways waiting for signal", "Consolidation phase - accumulation",
      "Market cap stable", "Neutral funding rate", "Open interest stable",
      "Hashrate unchanged", "DXY sideways", "No notable macro data",
      "Normal on-chain flow", "Minor sector rotation",
    ],
    secondaryFactors: [
      "Analyst opinions divided", "Neutral industry report",
      "Protocol proposal under review", "Routine developer milestone",
      "New testnet under testing", "Industry report compilation",
      "Weekend options expiry", "Crypto conference in Europe",
      "Bitcoin Pizza Day - no price impact", "US Congress crypto hearing",
      "Binance Proof of Reserve stable", "Gold positively correlated with BTC",
    ],
    priceBias: 0, volatility: [0.3, 2], duration: [7, 30], numFactors: [3, 6],
  },
};

const REGIME_TRANSITIONS: Record<string, Record<string, number>> = {
  MACRO_TIGHTENING:      { MACRO_TIGHTENING: 0.35, CRYPTO_CONTAGION: 0.20, NEUTRAL_CONSOLIDATION: 0.20, REGULATORY_CRACKDOWN: 0.15, FED_PIVOT: 0.10 },
  CRYPTO_CONTAGION:      { NEUTRAL_CONSOLIDATION: 0.30, REGULATORY_CRACKDOWN: 0.25, CRYPTO_CONTAGION: 0.20, MACRO_TIGHTENING: 0.15, FED_PIVOT: 0.10 },
  INSTITUTIONAL_BULL:    { INSTITUTIONAL_BULL: 0.35, SUPPLY_SHOCK: 0.20, NEUTRAL_CONSOLIDATION: 0.20, MACRO_TIGHTENING: 0.15, REGULATORY_CRACKDOWN: 0.10 },
  FED_PIVOT:             { INSTITUTIONAL_BULL: 0.35, NEUTRAL_CONSOLIDATION: 0.25, FED_PIVOT: 0.20, SUPPLY_SHOCK: 0.15, MACRO_TIGHTENING: 0.05 },
  MINING_STRESS:         { NEUTRAL_CONSOLIDATION: 0.30, CRYPTO_CONTAGION: 0.20, REGULATORY_CRACKDOWN: 0.20, SUPPLY_SHOCK: 0.15, MACRO_TIGHTENING: 0.15 },
  REGULATORY_CRACKDOWN:  { NEUTRAL_CONSOLIDATION: 0.30, CRYPTO_CONTAGION: 0.20, MACRO_TIGHTENING: 0.20, REGULATORY_CRACKDOWN: 0.15, FED_PIVOT: 0.15 },
  SUPPLY_SHOCK:          { INSTITUTIONAL_BULL: 0.35, SUPPLY_SHOCK: 0.25, NEUTRAL_CONSOLIDATION: 0.20, MACRO_TIGHTENING: 0.10, MINING_STRESS: 0.10 },
  NEUTRAL_CONSOLIDATION: { INSTITUTIONAL_BULL: 0.20, MACRO_TIGHTENING: 0.15, FED_PIVOT: 0.15, SUPPLY_SHOCK: 0.15, REGULATORY_CRACKDOWN: 0.10, MINING_STRESS: 0.10, CRYPTO_CONTAGION: 0.05, NEUTRAL_CONSOLIDATION: 0.10 },
};

const TEXT_TEMPLATES: Record<string, string[]> = {
  bull: [
    "Market showing strong positive signs, investors optimistic.",
    "Clear upward momentum, technical indicators support bullish trend.",
    "Buy pressure increasing significantly, bulls in control.",
    "Smart money accumulating, positive long-term signal.",
    "Risk-on market, investors willing to take risks.",
  ],
  bear: [
    "Market under heavy selling pressure, cautious sentiment.",
    "Bears in control, sell pressure elevated.",
    "Panic selling emerging, market fearful.",
    "Capital outflows, liquidity declining significantly.",
    "Fear spreading, greed index dropping sharply.",
  ],
  neutral: [
    "Market stable, waiting for clearer signals.",
    "Range-bound trading, no clear trend yet.",
    "Consolidation phase, average trading volume.",
    "Uncertain market, investors on sidelines.",
  ],
};

function randBetween(min: number, max: number): number { return min + Math.random() * (max - min); }
function randInt(min: number, max: number): number { return Math.floor(randBetween(min, max + 1)); }
function clamp(val: number, min: number, max: number): number { return Math.max(min, Math.min(max, val)); }
function pickRandom<T>(arr: T[], count: number): T[] { return [...arr].sort(() => Math.random() - 0.5).slice(0, Math.min(count, arr.length)); }
function weightedChoice(transitions: Record<string, number>): string {
  const roll = Math.random(); let cum = 0;
  for (const [s, p] of Object.entries(transitions)) { cum += p; if (roll <= cum) return s; }
  return Object.keys(transitions)[0];
}

function pickFromRegime(regime: Regime): string[] {
  const numFactors = randInt(regime.numFactors[0], regime.numFactors[1]);

  // Primary: 40-60% of factors (core regime signal)
  const numPrimary = randInt(2, Math.ceil(numFactors * 0.6));
  // Secondary: 20-30% (related events)
  const numSecondary = randInt(1, Math.max(1, Math.ceil(numFactors * 0.3)));
  // Background: the rest (macro/on-chain — always present in real markets)
  const numBackground = Math.max(1, numFactors - numPrimary - numSecondary);

  const factors = [
    ...pickRandom(regime.primaryFactors, numPrimary),
    ...pickRandom(regime.secondaryFactors, numSecondary),
    ...pickRandom(BACKGROUND_FACTORS, numBackground),
  ];
  return [...new Set(factors)];
}

function generateData(startDate: string, numDays: number): DailyJsonInput[] {
  const results: DailyJsonInput[] = [];
  let price = randBetween(3000, 20000);
  let currentRegime = "NEUTRAL_CONSOLIDATION";
  let regimeDaysLeft = 0;

  // Factor persistence: each factor has a remaining duration
  let activeFactors: Array<{ factor: string; daysLeft: number }> = [];

  for (let day = 0; day < numDays; day++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + day);
    const dateStr = d.toISOString().slice(0, 10);

    if (regimeDaysLeft <= 0) {
      currentRegime = weightedChoice(REGIME_TRANSITIONS[currentRegime]);
      regimeDaysLeft = randInt(REGIMES[currentRegime].duration[0], REGIMES[currentRegime].duration[1]);
      // On regime change: clear some old factors (not all — some persist across regimes)
      activeFactors = activeFactors.filter(() => Math.random() < 0.3);
    }
    regimeDaysLeft--;

    const regime = REGIMES[currentRegime];
    const vol = randBetween(regime.volatility[0], regime.volatility[1]);
    const bias = regime.priceBias * randBetween(0.5, 2.0);
    const isBlackSwan = Math.random() < 0.02 && regime.priceBias < 0;
    let priceChangePct = bias + randBetween(-vol, vol);
    if (isBlackSwan) priceChangePct = -Math.abs(priceChangePct) * randBetween(1.5, 3);

    price = clamp(price * (1 + priceChangePct / 100), 1000, 250000);

    // Tick down active factors, remove expired
    activeFactors = activeFactors
      .map((f) => ({ ...f, daysLeft: f.daysLeft - 1 }))
      .filter((f) => f.daysLeft > 0);

    // Add new factors from regime (with persistence 2-7 days)
    const targetTotal = randInt(regime.numFactors[0], regime.numFactors[1]);
    const currentNames = new Set(activeFactors.map((f) => f.factor));
    const needed = Math.max(0, targetTotal - currentNames.size);

    if (needed > 0) {
      const newPick = pickFromRegime(regime).filter((f) => !currentNames.has(f));
      for (const f of newPick.slice(0, needed)) {
        activeFactors.push({ factor: f, daysLeft: randInt(2, 7) });
      }
    }

    const factors = [...new Set(activeFactors.map((f) => f.factor))];

    const rsi = clamp(50 + priceChangePct * randBetween(2, 4) + regime.priceBias * 10 + randBetween(-10, 10), 5, 98);
    const msi = clamp(50 + regime.priceBias * randBetween(10, 25) + randBetween(-12, 12), 5, 98);
    const fearGreedIndex = clamp(Math.round(50 + regime.priceBias * 20 + priceChangePct * 2 + randBetween(-10, 10)), 2, 98);
    const sentimentScoreAvg = clamp(regime.priceBias * 0.3 + priceChangePct * 0.05 + randBetween(-0.3, 0.3), -1, 1);

    const priceStr = price.toLocaleString("en-US", { maximumFractionDigits: 0 });
    const dir = priceChangePct > 0 ? "up" : priceChangePct < 0 ? "down" : "flat";
    let text = `${dateStr}: BTC ${dir} ${Math.abs(priceChangePct).toFixed(2)}%, price $${priceStr}. `;
    text += `Key factors: ${factors.slice(0, 3).join("; ")}. `;
    const tplKey = priceChangePct > 1.5 ? "bull" : priceChangePct < -1.5 ? "bear" : "neutral";
    text += TEXT_TEMPLATES[tplKey][Math.floor(Math.random() * TEXT_TEMPLATES[tplKey].length)];

    results.push({
      date: dateStr, asset: "BTC",
      msi: Math.round(msi * 100) / 100,
      rsi: Math.round(rsi * 100) / 100,
      sentiment_score_avg: Math.round(sentimentScoreAvg * 1000) / 1000,
      text, factors, fear_greed_index: fearGreedIndex,
      price: Math.round(price * 100) / 100,
      price_change_pct: Math.round(priceChangePct * 100) / 100,
    });
  }
  return results;
}

// ----------------------------------------------------------------
// Main: generate 5 years (2021-2025), output per year
// ----------------------------------------------------------------

function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const allDays = generateData("2021-01-01", 365 * 5 + 1); // ~5 years

  const byYear = new Map<number, DailyJsonInput[]>();
  for (const day of allDays) {
    const year = parseInt(day.date.slice(0, 4));
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(day);
  }

  for (const [year, days] of byYear) {
    const outPath = path.join(DATA_DIR, `${year}.json`);
    fs.writeFileSync(outPath, JSON.stringify(days, null, 2));
    console.log(`${year}: ${days.length} days, price ${Math.min(...days.map(d => d.price)).toFixed(0)}–${Math.max(...days.map(d => d.price)).toFixed(0)}`);
  }
  console.log(`\nTotal: ${allDays.length} days`);
}

main();
