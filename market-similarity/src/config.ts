import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(__dirname, "..");
export const DB_PATH =
  process.env.DB_PATH || path.join(PROJECT_ROOT, "data", "market.db");

/** α: trong so numerical indicators trong joint vector (History Rhymes: 0.5) */
export const ALPHA = 0.5;

/** W: kich thuoc window cho SeqSim (paper: 5) */
export const WINDOW_SIZE = 5;

/** Default top-K */
export const TOP_K = 5;
