/**
 * Generate 10 years of mock BTC data with REGIME-BASED event clustering.
 *
 * Thay vi pick factors random, dung market regimes giong thi truong that:
 *   - Moi regime co tap factors rieng (primary + secondary)
 *   - Regime keo dai 2-8 tuan (persistence)
 *   - Events cascade: trigger -> immediate -> follow-up
 *   - Regime transitions co xac suat chuyen doi tu nhien
 */

import type { DailyJsonInput } from "./types";

// ----------------------------------------------------------------
// Market Regimes - 8 trang thai thi truong
// ----------------------------------------------------------------

interface Regime {
  name: string;
  primaryFactors: string[];   // xuat hien thuong xuyen (70-90%)
  secondaryFactors: string[]; // xuat hien it hon (20-40%)
  priceBias: number;          // xu huong gia (-1 to 1)
  volatility: [number, number]; // [min, max] %
  duration: [number, number];   // [min, max] ngay
  numFactors: [number, number]; // [min, max] so factors/ngay
}

const REGIMES: Record<string, Regime> = {
  MACRO_TIGHTENING: {
    name: "Macro Tightening",
    primaryFactors: [
      "Fed raises interest rate",
      "CPI higher than expected",
      "Dollar index surging",
      "Bond yield rising - risk for crypto",
      "Volume declining - liquidity drying up",
      "US debt ceiling concerns",
    ],
    secondaryFactors: [
      "Significant ETF outflows",
      "Stablecoin outflows from exchanges",
      "BTC dominance declining",
      "Extreme greed index - correction risk",
      "Regulatory risk from EU",
      "Analyst opinions divided",
      "Strong whale selling",
      "Large market liquidations",
      "Systemic risk concerns",
    ],
    priceBias: -0.6,
    volatility: [1.5, 4.5],
    duration: [14, 45],
    numFactors: [2, 4],
  },

  CRYPTO_CONTAGION: {
    name: "Crypto Contagion",
    primaryFactors: [
      "FTX exchange collapse event",
      "Terra Luna collapse impact",
      "Celsius Network freezes withdrawals",
      "Genesis Trading halts operations",
      "Three Arrows Capital bankruptcy",
      "Exchange insolvency concerns",
      "Large market liquidations",
      "Systemic risk concerns",
      "Strong whale selling",
      "Whale sends large BTC to exchange",
    ],
    secondaryFactors: [
      "Significant ETF outflows",
      "USDC temporary depeg",
      "Silvergate Bank closes",
      "Leverage ratio too high - cascade liquidation risk",
      "Dormant BTC wallet suddenly moves funds",
      "Stablecoin outflows from exchanges",
      "SEC investigates staking services",
      "Volume declining - liquidity drying up",
      "Fed raises interest rate",
      "Regulatory risk from EU",
      "CPI higher than expected",
      "Miner selling pressure increasing",
    ],
    priceBias: -0.8,
    volatility: [3, 12],
    duration: [7, 30],
    numFactors: [3, 5],
  },

  INSTITUTIONAL_BULL: {
    name: "Institutional Bull Run",
    primaryFactors: [
      "Record ETF inflows",
      "Institutional adoption increasing",
      "Strong whale accumulation",
      "BlackRock increases BTC holdings",
      "MicroStrategy buys more BTC",
      "Significant volume surge",
      "Stablecoin inflows to exchanges rising",
      "Grayscale GBTC premium rising",
    ],
    secondaryFactors: [
      "SEC reviewing new ETF approval",
      "Partnership with major bank",
      "Major corporation accepts BTC payments",
      "JP Morgan positive outlook on BTC",
      "Fidelity opens BTC custody service",
      "Bitcoin spot volume hits record",
      "BTC dominance rising",
      "New payment integration",
      "Positive on-chain metrics",
      "Coinbase revenue beats expectations",
    ],
    priceBias: 0.7,
    volatility: [1, 5],
    duration: [21, 60],
    numFactors: [3, 5],
  },

  FED_PIVOT: {
    name: "Fed Pivot / Rate Cut",
    primaryFactors: [
      "Fed holds interest rate steady",
      "Fed pivot signal - market expects rate cut",
      "CPI lower than expected",
      "DXY dollar index declining",
      "US Treasury yield falling - capital flows to risk assets",
    ],
    secondaryFactors: [
      "Record ETF inflows",
      "Institutional adoption increasing",
      "Strong whale accumulation",
      "Gold positively correlated with BTC",
      "Nasdaq positively correlated with crypto",
      "Stablecoin inflows to exchanges rising",
      "Significant volume surge",
      "BTC dominance rising",
      "BlackRock increases BTC holdings",
      "Positive on-chain metrics",
    ],
    priceBias: 0.5,
    volatility: [1, 4],
    duration: [14, 45],
    numFactors: [2, 4],
  },

  MINING_STRESS: {
    name: "Mining Sector Stress",
    primaryFactors: [
      "Mining difficulty adjustment decreasing",
      "Hash rate recovering after sell-off",
      "Miner selling pressure increasing",
      "Mining ban in Kazakhstan",
      "Iran temporary mining ban",
      "China tightens crypto regulations again",
    ],
    secondaryFactors: [
      "Strong whale selling",
      "Large market liquidations",
      "Dormant BTC wallet suddenly moves funds",
      "Volume declining - liquidity drying up",
      "On-chain Flow Anomaly",
      "Systemic risk concerns",
    ],
    priceBias: -0.4,
    volatility: [2, 6],
    duration: [10, 30],
    numFactors: [2, 4],
  },

  REGULATORY_CRACKDOWN: {
    name: "Regulatory Crackdown",
    primaryFactors: [
      "SEC rejects new ETF",
      "SEC sues Binance and Coinbase",
      "SEC investigates staking services",
      "Regulatory risk from EU",
      "Regulatory concerns from China",
      "CBDC competing with crypto",
      "US Congress crypto hearing",
    ],
    secondaryFactors: [
      "Significant ETF outflows",
      "Exchange insolvency concerns",
      "Legal action against founder",
      "Tether FUD - reserve concerns",
      "Volume declining - liquidity drying up",
      "Strong whale selling",
      "Stablecoin outflows from exchanges",
      "Fed raises interest rate",
      "Large market liquidations",
      "CPI higher than expected",
    ],
    priceBias: -0.5,
    volatility: [1.5, 5],
    duration: [14, 60],
    numFactors: [2, 4],
  },

  SUPPLY_SHOCK: {
    name: "Supply Shock / Halving",
    primaryFactors: [
      "Supply decreasing due to halving effect",
      "Hash rate hits new all-time high",
      "Strong whale accumulation",
      "BTC dominance rising",
      "Significant volume surge",
    ],
    secondaryFactors: [
      "Positive on-chain metrics",
      "Institutional adoption increasing",
      "Record ETF inflows",
      "Lightning Network adoption growing",
      "Ordinals and BRC-20 adoption growing",
      "Bitcoin spot volume hits record",
      "Mining difficulty adjustment decreasing",
      "Developer activity surging",
    ],
    priceBias: 0.6,
    volatility: [1.5, 5],
    duration: [30, 90],
    numFactors: [2, 4],
  },

  NEUTRAL_CONSOLIDATION: {
    name: "Consolidation",
    primaryFactors: [
      "Market sideways waiting for signal",
      "Consolidation phase - accumulation",
      "Market cap stable",
      "Neutral funding rate",
      "Open interest stable",
      "Hashrate unchanged",
      "DXY sideways",
      "No notable macro data",
    ],
    secondaryFactors: [
      "Analyst opinions divided",
      "Neutral industry report",
      "Protocol proposal under review",
      "Routine developer milestone",
      "Minor sector rotation",
      "Normal on-chain flow",
      "New testnet under testing",
      "Industry report compilation",
      "Weekend options expiry",
      "Crypto conference in Europe",
    ],
    priceBias: 0,
    volatility: [0.3, 2],
    duration: [7, 30],
    numFactors: [1, 3],
  },
};

// ----------------------------------------------------------------
// Regime transition probabilities
// Ma tran chuyen doi giua cac regime (giong Markov chain)
// ----------------------------------------------------------------

const REGIME_TRANSITIONS: Record<string, Record<string, number>> = {
  MACRO_TIGHTENING: {
    MACRO_TIGHTENING: 0.35,
    CRYPTO_CONTAGION: 0.20,
    NEUTRAL_CONSOLIDATION: 0.20,
    REGULATORY_CRACKDOWN: 0.15,
    FED_PIVOT: 0.10,
  },
  CRYPTO_CONTAGION: {
    NEUTRAL_CONSOLIDATION: 0.30,
    REGULATORY_CRACKDOWN: 0.25,
    CRYPTO_CONTAGION: 0.20,
    MACRO_TIGHTENING: 0.15,
    FED_PIVOT: 0.10,
  },
  INSTITUTIONAL_BULL: {
    INSTITUTIONAL_BULL: 0.35,
    SUPPLY_SHOCK: 0.20,
    NEUTRAL_CONSOLIDATION: 0.20,
    MACRO_TIGHTENING: 0.15,
    REGULATORY_CRACKDOWN: 0.10,
  },
  FED_PIVOT: {
    INSTITUTIONAL_BULL: 0.35,
    NEUTRAL_CONSOLIDATION: 0.25,
    FED_PIVOT: 0.20,
    SUPPLY_SHOCK: 0.15,
    MACRO_TIGHTENING: 0.05,
  },
  MINING_STRESS: {
    NEUTRAL_CONSOLIDATION: 0.30,
    CRYPTO_CONTAGION: 0.20,
    REGULATORY_CRACKDOWN: 0.20,
    SUPPLY_SHOCK: 0.15,
    MACRO_TIGHTENING: 0.15,
  },
  REGULATORY_CRACKDOWN: {
    NEUTRAL_CONSOLIDATION: 0.30,
    CRYPTO_CONTAGION: 0.20,
    MACRO_TIGHTENING: 0.20,
    REGULATORY_CRACKDOWN: 0.15,
    FED_PIVOT: 0.15,
  },
  SUPPLY_SHOCK: {
    INSTITUTIONAL_BULL: 0.35,
    SUPPLY_SHOCK: 0.25,
    NEUTRAL_CONSOLIDATION: 0.20,
    MACRO_TIGHTENING: 0.10,
    MINING_STRESS: 0.10,
  },
  NEUTRAL_CONSOLIDATION: {
    INSTITUTIONAL_BULL: 0.20,
    MACRO_TIGHTENING: 0.15,
    FED_PIVOT: 0.15,
    SUPPLY_SHOCK: 0.15,
    REGULATORY_CRACKDOWN: 0.10,
    MINING_STRESS: 0.10,
    CRYPTO_CONTAGION: 0.05,
    NEUTRAL_CONSOLIDATION: 0.10,
  },
};

// ----------------------------------------------------------------
// Text templates
// ----------------------------------------------------------------

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

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(randBetween(min, max + 1));
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, arr.length));
}

function weightedChoice(transitions: Record<string, number>): string {
  const roll = Math.random();
  let cumulative = 0;
  for (const [state, prob] of Object.entries(transitions)) {
    cumulative += prob;
    if (roll <= cumulative) return state;
  }
  return Object.keys(transitions)[0];
}

function pickFromRegime(regime: Regime): string[] {
  const numFactors = randInt(regime.numFactors[0], regime.numFactors[1]);

  // Luon co it nhat 1 primary, phan con lai mix primary + secondary
  // Giong that: 1-2 su kien chinh + 1-3 su kien lien quan/cascade
  const numPrimary = randInt(1, Math.ceil(numFactors * 0.6));
  const numSecondary = numFactors - numPrimary;

  const factors = [
    ...pickRandom(regime.primaryFactors, numPrimary),
    ...pickRandom(regime.secondaryFactors, numSecondary),
  ];

  return [...new Set(factors)];
}

// ----------------------------------------------------------------
// Main generator
// ----------------------------------------------------------------

export function generateMockData(
  startDate: string,
  numDays = 3650,
  asset = "BTC"
): DailyJsonInput[] {
  const results: DailyJsonInput[] = [];

  let price = randBetween(3000, 20000);
  let currentRegime = "NEUTRAL_CONSOLIDATION";
  let regimeDaysLeft = 0;

  for (let day = 0; day < numDays; day++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + day);
    const dateStr = d.toISOString().slice(0, 10);

    // Regime transition khi het thoi gian
    if (regimeDaysLeft <= 0) {
      const transitions = REGIME_TRANSITIONS[currentRegime];
      currentRegime = weightedChoice(transitions);
      const regime = REGIMES[currentRegime];
      regimeDaysLeft = randInt(regime.duration[0], regime.duration[1]);
    }
    regimeDaysLeft--;

    const regime = REGIMES[currentRegime];

    // Price change theo regime bias + noise
    const vol = randBetween(regime.volatility[0], regime.volatility[1]);
    const bias = regime.priceBias * randBetween(0.5, 2.0);

    // 2% black swan trong regime bearish
    const isBlackSwan = Math.random() < 0.02 && regime.priceBias < 0;
    let priceChangePct = bias + randBetween(-vol, vol);
    if (isBlackSwan) {
      priceChangePct = -Math.abs(priceChangePct) * randBetween(1.5, 3);
    }

    price = price * (1 + priceChangePct / 100);
    price = clamp(price, 1000, 250000);

    // Factors tu regime (clustered, khong random)
    const factors = pickFromRegime(regime);

    // Indicators tuong quan voi regime va price change
    const rsiBase = 50 + priceChangePct * randBetween(2, 4) + regime.priceBias * 10;
    const rsi = clamp(rsiBase + randBetween(-10, 10), 5, 98);

    const msiBase = 50 + regime.priceBias * randBetween(10, 25);
    const msi = clamp(msiBase + randBetween(-12, 12), 5, 98);

    const fgiBase = 50 + regime.priceBias * 20 + priceChangePct * 2;
    const fearGreedIndex = clamp(Math.round(fgiBase + randBetween(-10, 10)), 2, 98);

    const sentimentBase = regime.priceBias * 0.3 + priceChangePct * 0.05;
    const sentimentScoreAvg = clamp(sentimentBase + randBetween(-0.3, 0.3), -1, 1);

    // Text
    const priceStr = price.toLocaleString("en-US", { maximumFractionDigits: 0 });
    const dir = priceChangePct > 0 ? "up" : priceChangePct < 0 ? "down" : "flat";
    const absChange = Math.abs(priceChangePct).toFixed(2);
    let text = `${dateStr}: BTC ${dir} ${absChange}%, price $${priceStr}. `;
    text += `Key factors: ${factors.slice(0, 3).join("; ")}. `;

    const tplKey = priceChangePct > 1.5 ? "bull" : priceChangePct < -1.5 ? "bear" : "neutral";
    const templates = TEXT_TEMPLATES[tplKey];
    text += templates[Math.floor(Math.random() * templates.length)];

    results.push({
      date: dateStr,
      asset,
      msi: Math.round(msi * 100) / 100,
      rsi: Math.round(rsi * 100) / 100,
      sentiment_score_avg: Math.round(sentimentScoreAvg * 1000) / 1000,
      text,
      factors,
      fear_greed_index: fearGreedIndex,
      price: Math.round(price * 100) / 100,
      price_change_pct: Math.round(priceChangePct * 100) / 100,
    });
  }

  return results;
}
