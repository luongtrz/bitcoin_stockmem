/**
 * Kieu du lieu ket hop StockMem + History Rhymes:
 * - Binary event vectors tu StockMem (Section 3.3)
 * - Numerical concat voi α=0.5 tu History Rhymes (Khanna, 2024)
 */

export interface DailyJsonInput {
  date: string;
  asset: string;
  msi: number;
  rsi: number;
  sentiment_score_avg: number;
  text: string;
  factors: string[];
  fear_greed_index: number;
  price: number;
  price_change_pct: number;
}

/** Joint vector: [typeVec_62; groupVec_13; α × numeric_5] → L2-normalized */
export type JointVector = number[];

export interface StoredRecord {
  id: number;
  date: string;
  asset: string;
  json_data: string;
  joint_vec: string; // JSON.stringify of JointVector
}

export interface SearchResult {
  rank: number;
  score: number;
  record: DailyJsonInput;
}

export interface WindowSearchResult {
  rank: number;
  score: number;
  daily_scores: number[];
  window: DailyJsonInput[];
}
