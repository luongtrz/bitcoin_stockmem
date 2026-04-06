import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(__dirname, "..");
export const DB_PATH =
  process.env.DB_PATH || path.join(PROJECT_ROOT, "data", "market.db");

// Hybrid vector weights
export const W_NUM = 1.0;
export const W_TEXT = 1.0;

// Default top-K for similarity search
export const TOP_K = 5;
