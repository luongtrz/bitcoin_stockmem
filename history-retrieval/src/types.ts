/**
 * Dinh nghia kieu du lieu JSON dau vao hang ngay cho Bitcoin.
 */

export interface DailyJsonInput {
  date: string;                // "2026-04-01"
  asset: string;               // "BTC"
  msi: number;                 // Market Strength Index (0-100)
  rsi: number;                 // Relative Strength Index (0-100)
  sentiment_score_avg: number; // Diem cam xuc trung binh (-1 den 1)
  text: string;                // Tom tat bai bao
  factors: string[];           // Danh sach factor anh huong
  fear_greed_index: number;    // Chi so tham lam va so hai (0-100)
  price: number;               // Gia BTC (USD)
  price_change_pct: number;    // % thay doi so voi ngay hom truoc
}

/**
 * Vector bieu dien 1 ngay giao dich theo paper StockMem:
 *   - typeVec: 62 chieu binary - moi event type = 1 dim (cong thuc 3)
 *   - groupVec: 13 chieu binary - moi event group = 1 dim (cong thuc 4)
 */
export interface DayVector {
  typeVec: number[];    // [62], binary
  groupVec: number[];   // [13], binary
}

export interface StoredRecord {
  id: number;
  date: string;
  asset: string;
  json_data: string;     // JSON.stringify cua DailyJsonInput
  type_vec: string;      // JSON.stringify cua number[62]
  group_vec: string;     // JSON.stringify cua number[13]
}

export interface SearchResult {
  rank: number;
  score: number;
  record: DailyJsonInput;
}

export interface WindowSearchResult {
  rank: number;
  score: number;
  window: DailyJsonInput[];       // W records trong window match
}
