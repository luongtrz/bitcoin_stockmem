/**
 * Step 6: Final Prediction (LLM_predict).
 */

import { GeminiClient } from "../llm/gemini-client";
import { PREDICT_PROMPT, fillTemplate } from "../llm/prompts";
import { parsePredictResult } from "../llm/response-parser";
import { WINDOW_SIZE } from "../config";
import { buildEventSeries, formatSeriesForPrompt } from "../memory/event-memory";
import { formatReflectionsForPrompt } from "../memory/reflection-memory";
import { retrieveReferences } from "./step5-retrieve";
import { insertPrediction } from "../storage/database";

export async function predict(
  client: GeminiClient,
  date: string,
  asset: string
): Promise<{
  id: number;
  date: string;
  asset: string;
  predictedDirection: string;
  reason: string;
  refIds: number[];
} | null> {
  const { dates, eventsPerDay } = buildEventSeries(date, WINDOW_SIZE, asset);
  const information = formatSeriesForPrompt(dates, eventsPerDay, true);

  if (!information.trim()) {
    console.warn(`No events for prediction on ${date}/${asset}`);
    return null;
  }

  // Retrieve
  const { reflections, refIds } = await retrieveReferences(client, date, asset);
  const histReflection = formatReflectionsForPrompt(reflections);

  // Predict
  const prompt = fillTemplate(PREDICT_PROMPT, {
    asset,
    information,
    hist_reflection: histReflection,
  });

  try {
    const result = await client.generateJson(prompt);
    const parsed = parsePredictResult(result);

    let direction = parsed["Price movement"].toLowerCase().trim();
    if (!["up", "down"].includes(direction)) {
      direction = direction.includes("up") ? "up" : "down";
    }

    const predId = insertPrediction({
      date,
      asset,
      predicted_direction: direction,
      reason: parsed["Reason for price movement"],
      reference_reflection_ids: refIds,
    });

    console.log(`Prediction ${predId}: ${date}/${asset} -> ${direction}`);
    return {
      id: predId,
      date,
      asset,
      predictedDirection: direction,
      reason: parsed["Reason for price movement"],
      refIds,
    };
  } catch (e: any) {
    console.warn(`Prediction failed for ${date}/${asset}: ${e.message}`);
    return null;
  }
}
