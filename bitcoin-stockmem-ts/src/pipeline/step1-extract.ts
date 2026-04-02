/**
 * Step 1: Event Extraction (LLM_ext).
 */

import { GeminiClient } from "../llm/gemini-client";
import { EXTRACT_PROMPT, fillTemplate } from "../llm/prompts";
import { parseExtractedEvents } from "../llm/response-parser";
import { formatTaxonomyForPrompt } from "../data/taxonomy";
import { encode, embeddingToBuffer } from "../embeddings/bge-m3";
import { insertRawEvents, type RawEventRow } from "../storage/database";
import type { NewsArticle } from "../data/news-fetcher";

const BATCH_SIZE = 3;

export async function extractEventsForDay(
  client: GeminiClient,
  articles: NewsArticle[],
  date: string
): Promise<RawEventRow[]> {
  if (!articles.length) return [];

  const { groups, typeList } = formatTaxonomyForPrompt();
  const allEvents: RawEventRow[] = [];

  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);

    let articlesText = "";
    for (const [idx, art] of batch.entries()) {
      const body = art.body || art.title;
      articlesText += `\n--- Article ${idx + 1} (source: ${art.source}) ---\n`;
      articlesText += `Title: ${art.title}\n`;
      if (body !== art.title) articlesText += `Content: ${body.slice(0, 2000)}\n`;
    }

    const prompt = fillTemplate(EXTRACT_PROMPT, { groups, type_list: typeList, articles: articlesText });

    try {
      const result = await client.generateJson(prompt);
      const arr = Array.isArray(result) ? result : [result];
      const events = parseExtractedEvents(arr);

      for (const ev of events) {
        allEvents.push({
          news_id: null,
          date,
          asset: batch[0].asset || "ALL",
          event_group: ev.event_group,
          event_type: ev.event_type,
          time: ev.time,
          location: ev.location,
          entities: ev.entities,
          industries: ev.industries,
          description: ev.description,
          extended_attrs: ev.extended_attrs,
        });
      }
    } catch (e: any) {
      console.warn(`Extraction failed for batch at ${i}: ${e.message}`);
    }
  }

  // Compute embeddings
  if (allEvents.length > 0) {
    const descriptions = allEvents.map((e) => e.description);
    const embeddings = await encode(descriptions);
    for (let i = 0; i < allEvents.length; i++) {
      allEvents[i].embedding = embeddingToBuffer(embeddings[i]);
    }
  }

  console.log(`Extracted ${allEvents.length} events for ${date}`);
  return allEvents;
}

export async function runExtraction(
  client: GeminiClient,
  newsByDate: Record<string, NewsArticle[]>
): Promise<Record<string, number[]>> {
  const result: Record<string, number[]> = {};
  for (const date of Object.keys(newsByDate).sort()) {
    const events = await extractEventsForDay(client, newsByDate[date], date);
    if (events.length) {
      const ids = insertRawEvents(events);
      result[date] = ids;
    } else {
      result[date] = [];
    }
  }
  return result;
}
