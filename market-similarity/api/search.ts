import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAllRecords } from "../src/storage/memory.js";
import { vectorize, computeNormStats } from "../src/vectorize.js";
import { searchTopK, searchTopKWindows } from "../src/search.js";
import type { DailyJsonInput } from "../src/types.js";

// Cache norm stats (computed once on cold start)
let cachedStats: ReturnType<typeof computeNormStats> | null = null;

function getStats() {
  if (cachedStats) return cachedStats;
  const records = getAllRecords();
  const days: DailyJsonInput[] = records.map((r) => JSON.parse(r.json_data));
  cachedStats = computeNormStats(days);
  return cachedStats;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const body = req.body;
    if (!body) return res.status(400).json({ error: "Request body required." });

    const k = parseInt((req.query.k as string) || "5", 10);
    const records = getAllRecords();
    const stats = getStats();

    if (Array.isArray(body)) {
      const queryDays: DailyJsonInput[] = body;
      const queryVecs = queryDays.map((d) => vectorize(d, stats));
      const queryStartDate = queryDays[0].date;
      return res.status(200).json(searchTopKWindows(queryVecs, records, queryStartDate, k));
    } else {
      const query: DailyJsonInput = body;
      const queryVec = vectorize(query, stats);
      return res.status(200).json(searchTopK(queryVec, records, k));
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
