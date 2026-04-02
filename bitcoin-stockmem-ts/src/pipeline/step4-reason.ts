/**
 * Step 4: Reflection Generation (LLM_reason).
 */

import { GeminiClient } from "../llm/gemini-client";
import { REASON_PROMPT, fillTemplate } from "../llm/prompts";
import { parseReasonResult } from "../llm/response-parser";
import { WINDOW_SIZE } from "../config";
import { buildEventSeries, formatSeriesForPrompt } from "../memory/event-memory";
import { storeReflection } from "../memory/reflection-memory";

export async function generateReflection(
  client: GeminiClient,
  date: string,
  asset: string,
  priceDirection: string,
  priceChangePct?: number,
  source = "train"
): Promise<number | null> {
  const { dates, eventsPerDay } = buildEventSeries(date, WINDOW_SIZE, asset);
  const information = formatSeriesForPrompt(dates, eventsPerDay, true);

  if (!information.trim()) {
    console.warn(`No events for reflection on ${date}/${asset}`);
    return null;
  }

  const prompt = fillTemplate(REASON_PROMPT, {
    asset,
    information,
    price_change: priceDirection,
  });

  try {
    const result = await client.generateJson(prompt);
    const parsed = parseReasonResult(result);

    const refId = storeReflection({
      date,
      asset,
      windowStart: dates[0],
      windowEnd: dates[dates.length - 1],
      priceDirection,
      reason: parsed["Reason for price movement"],
      keyEvents: parsed["Events causing the impact"],
      priceChangePct,
      source,
    });

    console.log(`Reflection ${refId} stored for ${date}/${asset} (${source})`);
    return refId;
  } catch (e: any) {
    console.warn(`Reflection failed for ${date}/${asset}: ${e.message}`);
    return null;
  }
}
