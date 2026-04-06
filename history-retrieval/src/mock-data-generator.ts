/**
 * Tao 10 nam du lieu mock BTC.
 *
 * - Gia BTC: random walk co trend, co bull/bear cycle (3k - 200k USD)
 * - RSI, MSI, Fear & Greed: tuong quan nhung random cao
 * - Sentiment: da dang, noise lon
 * - Factors: nhieu hon, pha tron nhieu kieu
 * - Text: da dang template hon
 */

import type { DailyJsonInput } from "./types";

// ----------------------------------------------------------------
// Danh sach factors mau - MO RONG
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
  "Grayscale GBTC premium tang",
  "MicroStrategy mua them BTC",
  "El Salvador tang tru luong BTC",
  "Lightning Network adoption tang",
  "Defi TVL tren Bitcoin tang",
  "Fidelity mo dich vu custody BTC",
  "JP Morgan nhan dinh tich cuc ve BTC",
  "Hash rate phuc hoi sau ban",
  "Binance Proof of Reserve on dinh",
  "Bitcoin spot volume tang ky luc",
  "Mining difficulty dieu chinh giam",
  "Central bank mua vang ky luc - tot cho BTC",
  "Nasdaq tuong quan tich cuc voi crypto",
  "Layer 2 scaling giai phap moi",
  "Fed pivot signal - thi truong ky vong ha lai suat",
  "US Treasury yield giam - dong tien chay vao risk assets",
  "Ordinals va BRC-20 tang adoption",
  "Bitcoin ETF options duoc phe duyet",
  "Tether tang in USDT - thanh khoan do vao",
  "Coinbase bao cao doanh thu vuot ky vong",
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
  "FTX su kien sap san",
  "Terra Luna collapse anh huong",
  "Celsius Network dong bang rut tien",
  "Genesis Trading ngung hoat dong",
  "Three Arrows Capital pha san",
  "USDC depeg tam thoi",
  "Mt. Gox phan phoi BTC cho chu no",
  "SEC kien Binance va Coinbase",
  "Silvergate Bank dong cua",
  "Tether FUD - lo ngai du tru",
  "mining ban tai Kazakhstan",
  "Trung Quoc siet chat crypto lan nua",
  "Iran cam mining tam thoi",
  "US debt ceiling lo ngai",
  "Grayscale GBTC discount mo rong",
  "Leverage ratio qua cao - rui ro cascade liquidation",
  "Dormant BTC wallet bat ngo chuyen tien",
  "SEC dieu tra staking services",
  "CBDC canh tranh voi crypto",
  "Whale gui BTC len san voi so luong lon",
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
  "Consolidation phase - thi truong tich luy",
  "Funding rate trung tinh",
  "Open interest on dinh",
  "Hashrate on dinh khong doi",
  "DXY di ngang",
  "Macro data khong co gi dac biet",
  "Options expiry cuoi tuan",
  "Bitcoin Pizza Day - khong anh huong gia",
  "Conference crypto tai chau Au",
  "US Congress phien dieu tran ve crypto",
];

// ----------------------------------------------------------------
// Text templates - DA DANG HON
// ----------------------------------------------------------------

const TEXT_TEMPLATES_BULL = [
  "Thi truong co dau hieu tich cuc manh, nha dau tu lac quan.",
  "Momentum tang ro ret, cac chi so ky thuat ung ho xu huong len.",
  "Buy pressure tang dang ke, bulls nam quyen kiem soat.",
  "Cau mua vuot cau ban, dong tien chay vao thi truong manh.",
  "Breakout khoi vung khang cu, thi truong euphoric.",
  "Smart money dang tich luy, tin hieu tich cuc dai han.",
  "Thi truong risk-on, nha dau tu san sang chap nhan rui ro.",
];

const TEXT_TEMPLATES_BEAR = [
  "Thi truong chiu ap luc ban manh, tam ly than trong.",
  "Bears nam quyen, sell pressure tang cao.",
  "Panic selling xuat hien, thi truong lo ngai.",
  "Breakdown duoi vung ho tro, sentiment tieu cuc.",
  "Dong tien rut ra, thanh khoan sut giam dang ke.",
  "Capitulation phase, weak hands ban thao.",
  "Fear lan rong, chi so tham lam giam manh.",
];

const TEXT_TEMPLATES_NEUTRAL = [
  "Thi truong on dinh, cho tin hieu ro rang hon.",
  "Range-bound trading, chua co xu huong ro.",
  "Thi truong tich luy, ky vong doi tin hieu moi.",
  "Consolidation phase, volume giao dich trung binh.",
  "Thi truong bat dinh, nha dau tu ngoi ngoai.",
];

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

  let templates: string[];
  if (changePct > 2) {
    templates = TEXT_TEMPLATES_BULL;
  } else if (changePct < -2) {
    templates = TEXT_TEMPLATES_BEAR;
  } else {
    templates = TEXT_TEMPLATES_NEUTRAL;
  }
  text += templates[Math.floor(Math.random() * templates.length)];

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
  numDays = 3650,
  asset = "BTC"
): DailyJsonInput[] {
  const results: DailyJsonInput[] = [];

  // Khoi tao gia ban dau - range lon hon
  let price = randBetween(3000, 20000);
  let trend = 0; // -1 bear, 0 neutral, 1 bull
  let trendDaysLeft = 0;
  let cyclePhase = 0; // 0-3: accumulation, markup, distribution, markdown

  for (let day = 0; day < numDays; day++) {
    // Tinh ngay
    const d = new Date(startDate);
    d.setDate(d.getDate() + day);
    const dateStr = d.toISOString().slice(0, 10);

    // Market cycle: thay doi moi ~600-900 ngay
    if (day % randInt(600, 900) === 0) {
      cyclePhase = (cyclePhase + 1) % 4;
    }

    // Trend thay doi dinh ky - thoi gian da dang hon
    if (trendDaysLeft <= 0) {
      // Bias theo cycle phase
      if (cyclePhase === 1) {
        // markup: xu huong tang nhieu hon
        trend = Math.random() < 0.7 ? 1 : randInt(-1, 0);
      } else if (cyclePhase === 3) {
        // markdown: xu huong giam nhieu hon
        trend = Math.random() < 0.7 ? -1 : randInt(0, 1);
      } else {
        trend = randInt(-1, 1);
      }
      trendDaysLeft = randInt(5, 60); // 5-60 ngay moi trend (da dang hon)
    }
    trendDaysLeft--;

    // Gia thay doi random walk + trend bias - VOLATILITY CAO HON
    const baseVolatility = randBetween(0.3, 5.5);
    // Them black swan events (~2% ngay)
    const isBlackSwan = Math.random() < 0.02;
    const volatility = isBlackSwan ? randBetween(8, 15) : baseVolatility;

    const trendBias = trend * randBetween(0.2, 2.0);
    let priceChangePct = trendBias + randBetween(-volatility, volatility);

    // Black swan co xu huong 1 phia
    if (isBlackSwan) {
      priceChangePct = Math.random() < 0.6
        ? -Math.abs(priceChangePct)  // 60% crash
        : Math.abs(priceChangePct);  // 40% pump
    }

    price = price * (1 + priceChangePct / 100);
    price = clamp(price, 1000, 250000); // range gia lon hon

    // RSI: tuong quan nhung noise lon hon
    const rsiBase = 50 + priceChangePct * randBetween(2, 5);
    const rsi = clamp(rsiBase + randBetween(-15, 15), 5, 98);

    // MSI: tuong quan voi trend nhung noise lon hon
    const msiBase = 50 + trend * randBetween(8, 22);
    const msi = clamp(msiBase + randBetween(-18, 18), 5, 98);

    // Fear & Greed: da dang hon
    const fgiBase = 50 + priceChangePct * randBetween(1, 4) + trend * randBetween(5, 15);
    const fearGreedIndex = clamp(Math.round(fgiBase + randBetween(-15, 15)), 2, 98);

    // Sentiment: noise lon hon
    const sentimentBase = priceChangePct > 0
      ? randBetween(0.1, 0.5)
      : priceChangePct < 0
        ? randBetween(-0.5, -0.1)
        : 0;
    const sentimentScoreAvg = clamp(
      sentimentBase + randBetween(-0.5, 0.5),
      -1, 1
    );

    // Factors: da dang hon, so luong thay doi nhieu hon
    let factors: string[];
    if (priceChangePct > 3) {
      // Bullish manh: 3-5 factors
      factors = pickRandom(BULLISH_FACTORS, randInt(3, 5));
    } else if (priceChangePct > 1) {
      // Nhe bullish: 2-3, co the pha 1 neutral
      factors = pickRandom(BULLISH_FACTORS, randInt(2, 3));
      if (Math.random() < 0.3) factors.push(...pickRandom(NEUTRAL_FACTORS, 1));
    } else if (priceChangePct < -3) {
      // Bearish manh: 3-5 factors
      factors = pickRandom(BEARISH_FACTORS, randInt(3, 5));
    } else if (priceChangePct < -1) {
      // Nhe bearish: 2-3, co the pha 1 neutral
      factors = pickRandom(BEARISH_FACTORS, randInt(2, 3));
      if (Math.random() < 0.3) factors.push(...pickRandom(NEUTRAL_FACTORS, 1));
    } else {
      // Neutral: pha tron nhieu loai
      const numFactors = randInt(1, 4);
      factors = [];
      for (let f = 0; f < numFactors; f++) {
        const roll = Math.random();
        if (roll < 0.4) {
          factors.push(...pickRandom(NEUTRAL_FACTORS, 1));
        } else if (roll < 0.7) {
          factors.push(...pickRandom(BULLISH_FACTORS, 1));
        } else {
          factors.push(...pickRandom(BEARISH_FACTORS, 1));
        }
      }
      // Loai bo trung lap
      factors = [...new Set(factors)];
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
