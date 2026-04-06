import { z } from "zod";

export const MarketDaySchema = z.object({
  date: z.string(),
  price: z.number(),
  arm: z.number(),
  srm: z.number(),
  factor_array: z.array(z.number()),
  pct_change: z.number(),
  text_summary: z.string(),
});

export type MarketDayInput = z.infer<typeof MarketDaySchema>;

export interface MarketDayRecord extends MarketDayInput {
  id: number;
  hybrid_vector: Buffer | null;
  num_dims: number;
  created_at: string;
}
