/**
 * Step 3: Event Tracking (LLM_track).
 * Finds predecessors, builds chains, extracts ΔInfo.
 */

import { GeminiClient } from "../llm/gemini-client";
import { TRACK_PROMPT, fillTemplate } from "../llm/prompts";
import { parseTrackResult } from "../llm/response-parser";
import { WINDOW_SIZE, D_MAX, TOP_K_TRACK } from "../config";
import { bufferToEmbedding } from "../embeddings/bge-m3";
import { topKSimilar } from "../embeddings/vector-store";
import { getDb, queryMergedEventsByDateRange } from "../storage/database";

function getWindowDates(date: string, window: number): { start: string; end: string } {
  const dt = new Date(date);
  const startDt = new Date(dt);
  startDt.setDate(startDt.getDate() - window);
  const endDt = new Date(dt);
  endDt.setDate(endDt.getDate() - 1);
  return {
    start: startDt.toISOString().slice(0, 10),
    end: endDt.toISOString().slice(0, 10),
  };
}

export async function trackEventsForDay(
  client: GeminiClient,
  date: string
): Promise<void> {
  const d = getDb();
  const todayEvents = d.prepare(
    "SELECT * FROM merged_events WHERE date = ? ORDER BY id"
  ).all(date) as any[];

  if (!todayEvents.length) return;

  const { start, end } = getWindowDates(date, WINDOW_SIZE);
  const histEvents = queryMergedEventsByDateRange(start, end);
  if (!histEvents.length) {
    console.log(`${date}: no history in window, skipping tracking`);
    return;
  }

  // Build corpus
  const corpus: number[][] = [];
  const corpusIds: number[] = [];
  for (const ev of histEvents) {
    if (ev.embedding) {
      corpus.push(bufferToEmbedding(ev.embedding as Buffer));
      corpusIds.push(ev.id as number);
    }
  }

  const idToEvent = new Map<number, any>();
  for (const ev of [...histEvents, ...todayEvents]) {
    idToEvent.set(ev.id as number, ev);
  }

  for (const event of todayEvents) {
    if (!event.embedding || corpus.length === 0) continue;

    const queryEmb = bufferToEmbedding(event.embedding);
    const candidates = topKSimilar(queryEmb, corpus, corpusIds, TOP_K_TRACK);
    if (!candidates.length) continue;

    const candidatesInfo = candidates
      .map((c) => {
        const ev = idToEvent.get(c.id);
        return ev ? {
          id: ev.id,
          date: ev.date,
          event_group: ev.event_group,
          event_type: ev.event_type,
          description: ev.description,
          similarity: Math.round(c.score * 1000) / 1000,
        } : null;
      })
      .filter(Boolean);

    const prompt = fillTemplate(TRACK_PROMPT, {
      window: String(WINDOW_SIZE),
      current_id: String(event.id),
      current_date: event.date,
      current_event_json: JSON.stringify({
        event_group: event.event_group,
        event_type: event.event_type,
        description: event.description,
      }),
      candidates_json: JSON.stringify(candidatesInfo),
    });

    try {
      const result = await client.generateJson(prompt);
      const track = parseTrackResult(result);

      if (track.has_predecessor && track.predecessor_id) {
        // Calculate chain depth
        let depth = 0;
        let curId: number | null = track.predecessor_id;
        while (curId && depth < D_MAX) {
          const prev = idToEvent.get(curId);
          if (!prev || !prev.prev_event_id) break;
          curId = prev.prev_event_id;
          depth++;
        }

        d.prepare(
          "UPDATE merged_events SET prev_event_id = ?, chain_depth = ?, delta_info = ? WHERE id = ?"
        ).run(track.predecessor_id, depth, track.delta_info, event.id);
      }
    } catch (e: any) {
      console.warn(`Track failed for event ${event.id}: ${e.message}`);
    }
  }

  console.log(`${date}: tracked ${todayEvents.length} events`);
}
