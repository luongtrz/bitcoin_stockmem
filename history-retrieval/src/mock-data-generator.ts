/**
 * Tao 365 ngay du lieu mock BTC.
 *
 * - Gia BTC: random walk co trend (60k - 100k USD)
 * - RSI, MSI, Fear & Greed: tuong quan voi gia va gia thay doi
 * - Sentiment: co bias theo huong gia
 * - Factors: ngau nhien tu danh sach co san
 * - Text: tu dong sinh tu template
 */

import type { DailyJsonInput } from "./types";

// ----------------------------------------------------------------
// Danh sach factors mau
// ----------------------------------------------------------------

const BULLISH_FACTORS = [
  "SEC xem xet phe duyet ETF moi",
  "Whale tich luy manh",
  "Chi so CPI thap hon ky vong",
  "Fed giu lai suat on dinh",
  "BlackRock tang luong BTC nam giu",
  "Doanh nghiep lon chap nhan thanh toan BTC",
  "Hash rate dat dinh moi",
  "Institutional adoption tang",
  "ETF inflow ky luc",
  "Gold tuong quan tich cuc voi BTC",
  "Stablecoin flow vao san tang",
  "Partnership voi ngan hang lon",
  "Protocol upgrade thanh cong",
  "Volume surge dang ke",
  "Developer activity tang manh",
  "On-chain metrics tich cuc",
  "Supply giam do halving effect",
  "DXY dollar index giam",
  "BTC dominance tang",
  "Payment integration moi",
];

const BEARISH_FACTORS = [
  "SEC tu choi ETF moi",
  "Whale ban ra manh",
  "CPI cao hon ky vong",
  "Fed tang lai suat",
  "Quan ngai quy dinh moi tu Trung Quoc",
  "Hack san giao dich lon",
  "Miner selling ap luc tang",
  "Liquidation lon tren thi truong",
  "ETF outflow dang ke",
  "Stablecoin outflow tu san",
  "Regulatory risk tu EU",
  "Exchange insolvency lo ngai",
  "Chi so tham lam qua cao - rui ro dieu chinh",
  "Dollar index tang manh",
  "Bond yield tang - rui ro cho crypto",
  "Volume giam - thanh khoan can",
  "BTC dominance giam",
  "Systemic risk lo ngai",
  "Rug pull du an lon",
  "Legal action chong lai founder",
];

const NEUTRAL_FACTORS = [
  "Thi truong di ngang cho tin hieu",
  "Analyst nhan dinh phan chia",
  "Bao cao nganh trung tinh",
  "Protocol proposal dang xem xet",
  "Developer milestone thong thuong",
  "Sector rotation nhe",
  "Market cap on dinh",
  "On-chain flow binh thuong",
  "Testnet moi dang thu nghiem",
  "Industry report tong hop",
];

// ----------------------------------------------------------------
// Text templates
// ----------------------------------------------------------------

function generateText(
  date: string,
  price: number,
  changePct: number,
  factors: string[]
): string {
  const direction = changePct > 0 ? "tang" : changePct < 0 ? "giam" : "di ngang";
  const absChange = Math.abs(changePct).toFixed(2);
  const priceStr = price.toLocaleString("en-US", { maximumFractionDigits: 0 });

  let text = `Ngay ${date}: BTC ${direction} ${absChange}%, gia hien tai $${priceStr}. `;

  if (factors.length > 0) {
    text += `Cac yeu to chinh: ${factors.slice(0, 3).join("; ")}. `;
  }

  if (changePct > 3) {
    text += "Thi truong co dau hieu tich cuc manh, nha dau tu lac quan.";
  } else if (changePct > 0) {
    text += "Thi truong nhe nhang tich cuc.";
  } else if (changePct < -3) {
    text += "Thi truong chiu ap luc ban manh, tam ly than trong.";
  } else if (changePct < 0) {
    text += "Thi truong nhe nhang tieu cuc.";
  } else {
    text += "Thi truong on dinh, cho tin hieu ro rang hon.";
  }

  return text;
}

// ----------------------------------------------------------------
// Random helpers
// ----------------------------------------------------------------

function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(randBetween(min, max + 1));
}

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ----------------------------------------------------------------
// Generator chinh
// ----------------------------------------------------------------

export function generateMockData(
  startDate: string,
  numDays = 1825,
  asset = "BTC"
): DailyJsonInput[] {
  const results: DailyJsonInput[] = [];

  // Khoi tao gia ban dau
  let price = randBetween(65000, 80000);
  let trend = 0; // -1 bear, 0 neutral, 1 bull
  let trendDaysLeft = 0;

  for (let day = 0; day < numDays; day++) {
    // Tinh ngay
    const d = new Date(startDate);
    d.setDate(d.getDate() + day);
    const dateStr = d.toISOString().slice(0, 10);

    // Trend thay doi dinh ky
    if (trendDaysLeft <= 0) {
      trend = randInt(-1, 1);
      trendDaysLeft = randInt(10, 40); // 10-40 ngay moi trend
    }
    trendDaysLeft--;

    // Gia thay doi random walk + trend bias
    const volatility = randBetween(0.5, 4.0);
    const trendBias = trend * randBetween(0.3, 1.5);
    const priceChangePct = trendBias + randBetween(-volatility, volatility);
    price = price * (1 + priceChangePct / 100);
    price = clamp(price, 30000, 150000);

    // RSI: tuong quan voi price change
    const rsiBase = 50 + priceChangePct * 3;
    const rsi = clamp(rsiBase + randBetween(-10, 10), 10, 95);

    // MSI: tuong quan voi trend
    const msiBase = 50 + trend * 15;
    const msi = clamp(msiBase + randBetween(-10, 10), 10, 95);

    // Fear & Greed: tuong quan voi sentiment thi truong
    const fgiBase = 50 + priceChangePct * 2 + trend * 10;
    const fearGreedIndex = clamp(Math.round(fgiBase + randBetween(-8, 8)), 5, 95);

    // Sentiment: tuong quan voi huong gia
    const sentimentBase = priceChangePct > 0 ? 0.3 : priceChangePct < 0 ? -0.3 : 0;
    const sentimentScoreAvg = clamp(
      sentimentBase + randBetween(-0.4, 0.4),
      -1, 1
    );

    // Factors: chon theo huong thi truong
    let factors: string[];
    if (priceChangePct > 1.5) {
      factors = pickRandom(BULLISH_FACTORS, randInt(2, 4));
    } else if (priceChangePct < -1.5) {
      factors = pickRandom(BEARISH_FACTORS, randInt(2, 4));
    } else {
      const mixed = [...pickRandom(NEUTRAL_FACTORS, 1)];
      if (Math.random() > 0.5) {
        mixed.push(...pickRandom(BULLISH_FACTORS, 1));
      } else {
        mixed.push(...pickRandom(BEARISH_FACTORS, 1));
      }
      factors = mixed;
    }

    // Text tom tat
    const text = generateText(dateStr, price, priceChangePct, factors);

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
