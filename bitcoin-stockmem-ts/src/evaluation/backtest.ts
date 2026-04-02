/**
 * Rolling-window backtesting with online learning.
 */

import { ASSETS, type Asset } from "../config";
import { GeminiClient } from "../llm/gemini-client";
import { evaluate } from "./metrics";
import { insertRawNews, insertRawEvents, getDb } from "../storage/database";
import { computeAndStoreDailyVectors } from "../memory/event-memory";
import { extractEventsForDay } from "../pipeline/step1-extract";
import { mergeEventsForDay } from "../pipeline/step2-merge";
import { trackEventsForDay } from "../pipeline/step3-track";
import { generateReflection } from "../pipeline/step4-reason";
import { predict } from "../pipeline/step6-predict";
import type { NewsArticle } from "../data/news-fetcher";
import type { LabelledRow } from "../data/label-generator";

export async function buildEventMemory(
  client: GeminiClient,
  newsByDate: Record<string, NewsArticle[]>,
  dates: string[]
): Promise<void> {
  for (const date of dates.sort()) {
    const articles = newsByDate[date] ?? [];

    if (articles.length) {
      insertRawNews(articles.map((a) => ({
        date: a.date, source: a.source, title: a.title,
        body: a.body, url: a.url, asset: a.asset,
      })));
    }

    const events = await extractEventsForDay(client, articles, date);
    if (events.length) insertRawEvents(events);

    await mergeEventsForDay(client, date);
    await trackEventsForDay(client, date);

    for (const asset of ASSETS) {
      computeAndStoreDailyVectors(date, asset);
    }
    console.log(`Event memory built for ${date}`);
  }
}

export async function buildReflectionMemory(
  client: GeminiClient,
  labels: Record<string, LabelledRow[]>
): Promise<void> {
  for (const [asset, rows] of Object.entries(labels)) {
    for (const row of rows) {
      if (row.label === "flat") continue;
      await generateReflection(
        client, row.date, asset, row.label, row.next_return ?? undefined, "train"
      );
    }
    console.log(`Reflections built for ${asset} training data`);
  }
}

export async function runBacktest(
  client: GeminiClient,
  testNewsByDate: Record<string, NewsArticle[]>,
  testLabels: Record<string, LabelledRow[]>,
  testDates: string[]
): Promise<Record<string, ReturnType<typeof evaluate> & { predictions: [string, string][] }>> {
  const results: Record<string, any> = {};
  const predLog: Record<string, [string, string][]> = {};
  for (const a of ASSETS) predLog[a] = [];

  for (const date of testDates) {
    const articles = testNewsByDate[date] ?? [];
    if (articles.length) {
      insertRawNews(articles.map((a) => ({
        date: a.date, source: a.source, title: a.title,
        body: a.body, url: a.url, asset: a.asset,
      })));
    }

    const events = await extractEventsForDay(client, articles, date);
    if (events.length) insertRawEvents(events);
    await mergeEventsForDay(client, date);
    await trackEventsForDay(client, date);
    for (const asset of ASSETS) computeAndStoreDailyVectors(date, asset);

    for (const asset of ASSETS) {
      const rows = testLabels[asset] ?? [];
      const dayRow = rows.find((r) => r.date === date);
      if (!dayRow || dayRow.label === "flat") continue;

      const pred = await predict(client, date, asset);
      if (!pred) continue;

      predLog[asset].push([pred.predictedDirection, dayRow.label]);

      // Update actual
      const d = getDb();
      d.prepare("UPDATE predictions SET actual_direction = ? WHERE id = ?")
        .run(dayRow.label, pred.id);

      // Online learning
      await generateReflection(
        client, date, asset, dayRow.label, dayRow.next_return ?? undefined, "online"
      );

      console.log(`Test ${date}/${asset}: predicted=${pred.predictedDirection}, actual=${dayRow.label}`);
    }
  }

  for (const asset of ASSETS) {
    const pairs = predLog[asset];
    if (pairs.length) {
      const preds = pairs.map(([p]) => p);
      const actuals = pairs.map(([, a]) => a);
      results[asset] = { ...evaluate(preds, actuals), predictions: pairs };
      console.log(`${asset}: ACC=${results[asset].accuracy}, MCC=${results[asset].mcc}`);
    }
  }
  return results;
}
