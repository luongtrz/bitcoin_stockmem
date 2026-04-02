/**
 * Zod schemas for validating LLM JSON responses.
 */

import { z } from "zod";

// Step 1: Event extraction
export const ExtractedEventSchema = z.object({
  event_group: z.string(),
  event_type: z.string(),
  time: z.string().default("unknown"),
  location: z.string().default("global"),
  entities: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([]),
  description: z.string(),
  extended_attrs: z.record(z.unknown()).optional().default({}),
});
export type ExtractedEvent = z.infer<typeof ExtractedEventSchema>;

// Step 2: Event merging
export const MergedEventSchema = z.object({
  event_group: z.string(),
  event_type: z.string(),
  time: z.string().default("unknown"),
  location: z.string().default("global"),
  entities: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([]),
  description: z.string(),
  source_event_ids: z.array(z.number()).default([]),
});
export type MergedEvent = z.infer<typeof MergedEventSchema>;

// Step 3: Event tracking
export const TrackResultSchema = z.object({
  has_predecessor: z.boolean(),
  predecessor_id: z.number().nullable().default(null),
  delta_info: z.string().nullable().default(null),
});
export type TrackResult = z.infer<typeof TrackResultSchema>;

// Step 4: Reflection
export const ReasonResultSchema = z.object({
  "Reason for price movement": z.string(),
  "Events causing the impact": z.string(),
});
export type ReasonResult = z.infer<typeof ReasonResultSchema>;

// Step 5: Retrieval filter
export const RetrieveResultSchema = z.object({
  selected_indices: z.array(z.number()),
});
export type RetrieveResult = z.infer<typeof RetrieveResultSchema>;

// Step 6: Prediction
export const PredictResultSchema = z.object({
  "Reason for price movement": z.string(),
  "Price movement": z.string(),
});
export type PredictResult = z.infer<typeof PredictResultSchema>;

// ---------------------------------------------------------------------------
// Safe parsers (return null on failure instead of throwing)
// ---------------------------------------------------------------------------

export function parseExtractedEvents(data: unknown[]): ExtractedEvent[] {
  return data
    .map((item) => {
      try { return ExtractedEventSchema.parse(item); } catch { return null; }
    })
    .filter((x): x is ExtractedEvent => x !== null);
}

export function parseMergedEvents(data: unknown[]): MergedEvent[] {
  return data
    .map((item) => {
      try { return MergedEventSchema.parse(item); } catch { return null; }
    })
    .filter((x): x is MergedEvent => x !== null);
}

export function parseTrackResult(data: unknown): TrackResult {
  return TrackResultSchema.parse(data);
}

export function parseReasonResult(data: unknown): ReasonResult {
  return ReasonResultSchema.parse(data);
}

export function parseRetrieveResult(data: unknown): RetrieveResult {
  return RetrieveResultSchema.parse(data);
}

export function parsePredictResult(data: unknown): PredictResult {
  return PredictResultSchema.parse(data);
}
