/**
 * Central configuration for Bitcoin StockMem framework.
 */

import path from "path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
export const PROJECT_ROOT = path.resolve(__dirname, "..");
export const DB_PATH =
  process.env.DB_PATH || path.join(PROJECT_ROOT, "data", "stockmem.db");
export const CACHE_DIR = path.join(PROJECT_ROOT, "cache");

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
export const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY || "";

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
export const ASSETS = ["BTC", "ETH"] as const;
export type Asset = (typeof ASSETS)[number];

export const TRADING_PAIRS: Record<Asset, string> = {
  BTC: "BTC/USDT",
  ETH: "ETH/USDT",
};

// ---------------------------------------------------------------------------
// Hyperparameters (from paper)
// ---------------------------------------------------------------------------
export const WINDOW_SIZE = 5; // w: days in event sequence window
export const ALPHA = 0.7; // type vs group weight in DailySim
export const D_MAX = 5; // max event chain trace depth
export const TOP_K_TRACK = 10; // Top-K for event tracking
export const TOP_K_RETRIEVE = 10; // Top-K for sequence retrieval
export const PRICE_THRESHOLD = 0.01; // ±1% for up/down classification

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------
export const CLUSTER_DISTANCE_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Gemini API
// ---------------------------------------------------------------------------
export const GEMINI_MODEL = "gemini-2.5-flash";
export const GEMINI_RPM = 15;
export const GEMINI_RETRY_DELAY = 4.0; // seconds
export const GEMINI_MAX_RETRIES = 3;
export const GEMINI_TEMPERATURE = 0.0;

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------
export const PYTHON_EMBED_SCRIPT = path.join(
  __dirname,
  "embeddings",
  "embed_server.py"
);
