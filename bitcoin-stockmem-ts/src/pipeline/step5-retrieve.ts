/**
 * Step 5: Historical Sequence Retrieval.
 * Coarse (Jaccard) + Fine (LLM) two-stage retrieval.
 */

import { GeminiClient } from "../llm/gemini-client";
import { RETRIEVE_PROMPT, fillTemplate } from "../llm/prompts";
import { parseRetrieveResult } from "../llm/response-parser";
import { WINDOW_SIZE, TOP_K_RETRIEVE } from "../config";
import { getDb } from "../storage/database";
import {
  buildEventSeries, formatSeriesForPrompt, computeAndStoreDailyVectors,
} from "../memory/event-memory";
import { getReflectionByWindow, formatReflectionsForPrompt } from "../memory/reflection-memory";
import { findTopKSequences } from "../memory/similarity";

function getAllAvailableDates(beforeDate: string, asset: string): string[] {
  const d = getDb();
  const rows = d.prepare(
    `SELECT DISTINCT date FROM merged_events
     WHERE date < ? AND (asset = ? OR asset = 'ALL') ORDER BY date`
  ).all(beforeDate, asset) as any[];
  return rows.map((r: any) => r.date);
}

export async function retrieveReferences(
  client: GeminiClient,
  date: string,
  asset: string
): Promise<{ reflections: Record<string, any>[]; refIds: number[] }> {
  // Ensure daily vectors exist
  const endDt = new Date(date);
  const currentDates: string[] = [];
  for (let i = WINDOW_SIZE; i >= 0; i--) {
    const d = new Date(endDt);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    computeAndStoreDailyVectors(ds, asset);
    currentDates.push(ds);
  }

  const allHistDates = getAllAvailableDates(currentDates[0], asset);
  for (const d of allHistDates) computeAndStoreDailyVectors(d, asset);

  if (allHistDates.length < WINDOW_SIZE) {
    console.log(`Not enough history for retrieval on ${date}/${asset}`);
    return { reflections: [], refIds: [] };
  }

  // Stage 1: Coarse
  const topSeqs = findTopKSequences(currentDates, allHistDates, asset, TOP_K_RETRIEVE);
  if (!topSeqs.length) return { reflections: [], refIds: [] };

  // Build candidates text
  const { dates: curDates, eventsPerDay: curEvents } = buildEventSeries(date, WINDOW_SIZE, asset);
  const currentText = formatSeriesForPrompt(curDates, curEvents);

  const candidateTexts: string[] = [];
  const candidateReflections: (Record<string, any> | null)[] = [];

  for (const [i, seq] of topSeqs.entries()) {
    let ref = getReflectionByWindow(seq.dates[seq.dates.length - 1], asset);
    if (!ref) {
      const other = asset === "BTC" ? "ETH" : "BTC";
      ref = getReflectionByWindow(seq.dates[seq.dates.length - 1], other);
    }
    candidateReflections.push(ref);

    const { dates: hDates, eventsPerDay: hEvents } = buildEventSeries(
      seq.dates[seq.dates.length - 1], WINDOW_SIZE, asset
    );
    const hText = formatSeriesForPrompt(hDates, hEvents);

    let entry = `\n--- Candidate ${i} (similarity: ${seq.score.toFixed(3)}) ---\n`;
    entry += `Period: ${seq.dates[0]} to ${seq.dates[seq.dates.length - 1]}\n`;
    entry += hText;
    if (ref) {
      entry += `\nOutcome: price went ${ref.price_direction}`;
      entry += `\nAnalysis: ${String(ref.reason).slice(0, 300)}`;
    }
    candidateTexts.push(entry);
  }

  // Stage 2: Fine (LLM)
  const prompt = fillTemplate(RETRIEVE_PROMPT, {
    window: String(WINDOW_SIZE),
    asset,
    current_series_text: currentText,
    candidates_with_reflections: candidateTexts.join("\n"),
  });

  let selectedIndices: number[];
  try {
    const result = await client.generateJson(prompt);
    selectedIndices = parseRetrieveResult(result).selected_indices;
  } catch {
    selectedIndices = Array.from({ length: Math.min(3, topSeqs.length) }, (_, i) => i);
  }

  const reflections: Record<string, any>[] = [];
  const refIds: number[] = [];
  for (const idx of selectedIndices) {
    const ref = candidateReflections[idx];
    if (ref) {
      reflections.push(ref);
      refIds.push(ref.id);
    }
  }

  console.log(`${date}/${asset}: retrieved ${reflections.length} refs from ${topSeqs.length} candidates`);
  return { reflections, refIds };
}
