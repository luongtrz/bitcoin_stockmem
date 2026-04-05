/**
 * Vectorize: chuyen doi DailyJsonInput thanh vector so de so sanh cosine similarity.
 *
 * Vector gom cac thanh phan:
 *   [0]  msi / 100                          (normalize 0-1)
 *   [1]  rsi / 100                          (normalize 0-1)
 *   [2]  (sentiment_score_avg + 1) / 2      (shift tu [-1,1] sang [0,1])
 *   [3]  fear_greed_index / 100             (normalize 0-1)
 *   [4]  sigmoid(price_change_pct / 10)     (normalize % change)
 *   [5]  log(price) / 15                    (log-normalize gia, 15 ~ log(e^15) ~ 3.2M)
 *   [6..61] one-hot factor vector           (56 chieu, mapping vao taxonomy)
 */

import type { DailyJsonInput } from "./types";

// ----------------------------------------------------------------
// Taxonomy factor keywords -> index mapping
// ----------------------------------------------------------------

const FACTOR_KEYWORDS: Array<{ keywords: string[]; index: number }> = [
  // Regulation & Legal (0-4)
  { keywords: ["regulatory", "regulation", "quy dinh", "quy định"], index: 0 },
  { keywords: ["enforcement", "xu phat", "xử phạt"], index: 1 },
  { keywords: ["legislation", "luat", "luật", "du luat", "dự luật"], index: 2 },
  { keywords: ["government", "chinh phu", "chính phủ", "nha nuoc", "nhà nước"], index: 3 },
  { keywords: ["sanction", "ban", "cam", "cấm", "trung phat", "trừng phạt"], index: 4 },

  // Macroeconomic (5-8)
  { keywords: ["interest rate", "lai suat", "lãi suất", "fed"], index: 5 },
  { keywords: ["inflation", "cpi", "lam phat", "lạm phát"], index: 6 },
  { keywords: ["dollar", "dxy", "usd index"], index: 7 },
  { keywords: ["qe", "qt", "quantitative", "noi long", "nới lỏng", "that chat", "thắt chặt"], index: 8 },

  // Industry Standards & Opinions (9-11)
  { keywords: ["proposal", "de xuat", "đề xuất", "protocol proposal"], index: 9 },
  { keywords: ["report", "bao cao", "báo cáo", "industry report"], index: 10 },
  { keywords: ["analyst", "influencer", "opinion", "nhan dinh", "nhận định"], index: 11 },

  // Protocol & Product (12-18)
  { keywords: ["upgrade", "nang cap", "nâng cấp", "hard fork", "soft fork"], index: 12 },
  { keywords: ["feature launch", "tinh nang", "tính năng"], index: 13 },
  { keywords: ["testnet", "mainnet"], index: 14 },
  { keywords: ["adoption", "su dung", "sử dụng", "nguoi dung", "người dùng"], index: 15 },
  { keywords: ["fee", "gas", "phi giao dich", "phí giao dịch"], index: 16 },
  { keywords: ["hash rate", "hashrate", "mining difficulty"], index: 17 },
  { keywords: ["supply", "halving", "burn", "cung", "nguon cung", "nguồn cung"], index: 18 },

  // Technology & Development (19-24)
  { keywords: ["breakthrough", "dot pha", "đột phá"], index: 19 },
  { keywords: ["milestone", "development", "phat trien", "phát triển"], index: 20 },
  { keywords: ["audit", "kiem toan", "kiểm toán", "certification"], index: 21 },
  { keywords: ["node", "validator"], index: 22 },
  { keywords: ["integration", "tich hop", "tích hợp"], index: 23 },
  { keywords: ["tooling", "developer", "sdk", "api"], index: 24 },

  // Exchange & Trading (25-32)
  { keywords: ["listing", "delisting", "niem yet", "niêm yết"], index: 25 },
  { keywords: ["funding", "goi von", "gọi vốn", "round"], index: 26 },
  { keywords: ["revenue", "doanh thu", "earnings"], index: 27 },
  { keywords: ["acquisition", "mua lai", "mua lại", "sap nhap", "sáp nhập"], index: 28 },
  { keywords: ["partnership", "hop tac", "hợp tác", "doi tac", "đối tác"], index: 29 },
  { keywords: ["custody", "luu ky", "lưu ký"], index: 30 },
  { keywords: ["liquidation", "thanh ly", "thanh lý"], index: 31 },
  { keywords: ["reserve", "proof of reserve", "du tru", "dự trữ"], index: 32 },

  // DeFi & Ecosystem (33-35)
  { keywords: ["defi", "protocol launch", "ra mat", "ra mắt"], index: 33 },
  { keywords: ["migration", "di chuyen", "di chuyển"], index: 34 },
  { keywords: ["cross-chain", "bridge", "cau noi", "cầu nối"], index: 35 },

  // Whale & On-chain (36-39)
  { keywords: ["whale", "ca voi", "cá voi", "accumulation", "tich luy", "tích lũy"], index: 36 },
  { keywords: ["distribution", "phan phoi", "phân phối"], index: 37 },
  { keywords: ["on-chain", "flow anomaly", "bat thuong", "bất thường"], index: 38 },
  { keywords: ["miner", "selling", "tho dao", "thợ đào"], index: 39 },

  // Key Figures (40-42)
  { keywords: ["executive", "appointment", "bo nhiem", "bổ nhiệm", "ceo", "cto"], index: 40 },
  { keywords: ["founder", "statement", "tuyen bo", "tuyên bố", "elon", "cz"], index: 41 },
  { keywords: ["legal action", "kien", "kiện", "truy to", "truy tố"], index: 42 },

  // Market Performance (43-48)
  { keywords: ["market cap", "von hoa", "vốn hóa"], index: 43 },
  { keywords: ["sector rotation", "luan chuyen", "luân chuyển"], index: 44 },
  { keywords: ["dominance", "btc.d", "thong tri", "thống trị"], index: 45 },
  { keywords: ["volume surge", "khoi luong", "khối lượng"], index: 46 },
  { keywords: ["etf", "etf flow"], index: 47 },
  { keywords: ["institutional", "to chuc", "tổ chức", "institution"], index: 48 },

  // TradFi Crossover (49-52)
  { keywords: ["stock correlation", "co phieu", "cổ phiếu", "sp500", "nasdaq"], index: 49 },
  { keywords: ["bond", "trai phieu", "trái phiếu"], index: 50 },
  { keywords: ["commodity", "gold", "vang", "vàng", "dau", "dầu"], index: 51 },
  { keywords: ["stablecoin", "usdt", "usdc", "dai"], index: 52 },

  // Partnership & Adoption (53-55 -- overlap voi 29, nhung co the match rieng)
  { keywords: ["payment", "thanh toan", "thanh toán"], index: 53 },
  { keywords: ["alliance", "lien minh", "liên minh"], index: 54 },

  // Risk & Warning (55-59 -- dung index con lai)
  { keywords: ["hack", "breach", "tan cong", "tấn công", "security"], index: 55 },
];

const NUM_FACTOR_DIMS = 56;

// ----------------------------------------------------------------
// Vectorize
// ----------------------------------------------------------------

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function matchFactorToVector(factors: string[]): number[] {
  const vec = new Array(NUM_FACTOR_DIMS).fill(0);
  for (const factor of factors) {
    const lower = factor.toLowerCase();
    for (const entry of FACTOR_KEYWORDS) {
      if (entry.keywords.some((kw) => lower.includes(kw))) {
        vec[entry.index] = 1;
        break;
      }
    }
  }
  return vec;
}

export function vectorize(input: DailyJsonInput): number[] {
  const numericPart = [
    input.msi / 100,                         // [0] MSI normalized
    input.rsi / 100,                         // [1] RSI normalized
    (input.sentiment_score_avg + 1) / 2,     // [2] sentiment [-1,1] -> [0,1]
    input.fear_greed_index / 100,            // [3] Fear & Greed normalized
    sigmoid(input.price_change_pct / 10),    // [4] price change sigmoid
    Math.log(Math.max(input.price, 1)) / 15, // [5] log-price normalized
  ];

  const factorPart = matchFactorToVector(input.factors);

  return [...numericPart, ...factorPart];
}

/**
 * Tra ve so chieu cua vector.
 * 6 (numeric) + 56 (factor one-hot) = 62
 */
export const VECTOR_DIM = 6 + NUM_FACTOR_DIMS; // 62
