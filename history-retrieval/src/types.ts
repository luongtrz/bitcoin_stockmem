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

export interface StoredRecord {
  id: number;
  date: string;
  asset: string;
  json_data: string;   // JSON.stringify cua DailyJsonInput
  vector: string;      // JSON.stringify cua number[]
}

export interface SearchResult {
  rank: number;
  score: number;       // Cosine similarity score
  record: DailyJsonInput;
}
