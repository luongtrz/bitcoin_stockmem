/**
 * Step 2: Event Merging (LLM_merge).
 * Vector clustering + LLM refinement per event group per day.
 */

import { GeminiClient } from "../llm/gemini-client";
import { MERGE_PROMPT, fillTemplate } from "../llm/prompts";
import { parseMergedEvents } from "../llm/response-parser";
import { CLUSTER_DISTANCE_THRESHOLD } from "../config";
import { encode, embeddingToBuffer, bufferToEmbedding } from "../embeddings/bge-m3";
import { cosineSimilarity } from "../embeddings/vector-store";
import { getDb, insertMergedEvents, type MergedEventRow } from "../storage/database";

/**
 * Simple agglomerative clustering by cosine distance.
 */
function clusterEvents(events: Array<{ id: number; embedding: Buffer | null; [k: string]: any }>): number[][] {
  if (events.length <= 1) return events.length ? [[0]] : [];

  const embeddings = events.map((ev) =>
    ev.embedding ? bufferToEmbedding(ev.embedding) : new Array(1024).fill(0)
  );

  // Build distance matrix
  const n = embeddings.length;
  const assigned = new Array(n).fill(-1);
  let clusterId = 0;

  for (let i = 0; i < n; i++) {
    if (assigned[i] !== -1) continue;
    assigned[i] = clusterId;
    for (let j = i + 1; j < n; j++) {
      if (assigned[j] !== -1) continue;
      const sim = cosineSimilarity(embeddings[i], embeddings[j]);
      if (1 - sim < CLUSTER_DISTANCE_THRESHOLD) {
        assigned[j] = clusterId;
      }
    }
    clusterId++;
  }

  const clusters: number[][] = [];
  for (let c = 0; c < clusterId; c++) {
    const members = assigned
      .map((a, i) => (a === c ? i : -1))
      .filter((x) => x >= 0);
    if (members.length > 0) clusters.push(members);
  }
  return clusters;
}

export async function mergeEventsForDay(
  client: GeminiClient,
  date: string
): Promise<MergedEventRow[]> {
  const d = getDb();
  const rawEvents = d.prepare(
    "SELECT * FROM raw_events WHERE date = ? ORDER BY id"
  ).all(date) as any[];

  if (!rawEvents.length) return [];

  // Group by event_group
  const byGroup = new Map<string, any[]>();
  for (const ev of rawEvents) {
    const group = ev.event_group;
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)!.push(ev);
  }

  const allMerged: MergedEventRow[] = [];

  for (const [group, groupEvents] of byGroup) {
    const clusters = clusterEvents(groupEvents);

    for (const clusterIndices of clusters) {
      const cluster = clusterIndices.map((i) => groupEvents[i]);

      if (cluster.length === 1) {
        const ev = cluster[0];
        allMerged.push({
          date,
          asset: ev.asset ?? "ALL",
          event_group: ev.event_group,
          event_type: ev.event_type,
          time: ev.time,
          location: ev.location,
          entities: ev.entities,
          industries: ev.industries,
          description: ev.description,
          source_raw_event_ids: [ev.id],
        });
      } else {
        // Call LLM to merge
        const clusterJson = JSON.stringify(
          cluster.map((ev: any) => ({
            id: ev.id,
            event_group: ev.event_group,
            event_type: ev.event_type,
            description: ev.description,
            entities: typeof ev.entities === "string" ? JSON.parse(ev.entities) : ev.entities,
          }))
        );

        const prompt = fillTemplate(MERGE_PROMPT, { date, cluster_events_json: clusterJson });

        try {
          const result = await client.generateJson(prompt);
          const arr = Array.isArray(result) ? result : [result];
          const merged = parseMergedEvents(arr);

          for (const m of merged) {
            allMerged.push({
              date,
              asset: cluster[0].asset ?? "ALL",
              event_group: m.event_group,
              event_type: m.event_type,
              time: m.time,
              location: m.location,
              entities: m.entities,
              industries: m.industries,
              description: m.description,
              source_raw_event_ids: m.source_event_ids,
            });
          }
        } catch (e: any) {
          console.warn(`Merge failed for ${group} on ${date}: ${e.message}`);
          const ev = cluster[0];
          allMerged.push({
            date,
            asset: ev.asset ?? "ALL",
            event_group: ev.event_group,
            event_type: ev.event_type,
            description: ev.description,
            source_raw_event_ids: cluster.map((e: any) => e.id),
          });
        }
      }
    }
  }

  // Compute embeddings
  if (allMerged.length > 0) {
    const descriptions = allMerged.map((e) => e.description);
    const embeddings = await encode(descriptions);
    for (let i = 0; i < allMerged.length; i++) {
      allMerged[i].embedding = embeddingToBuffer(embeddings[i]);
    }
    insertMergedEvents(allMerged);
    console.log(`${date}: merged ${rawEvents.length} raw -> ${allMerged.length} events`);
  }

  return allMerged;
}
