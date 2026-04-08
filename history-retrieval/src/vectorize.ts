/**
 * Vectorize theo paper StockMem (Section 3.3, cong thuc 3-4):
 *
 * Chuyen doi DailyJsonInput thanh DayVector gom:
 *   - typeVec (62 dim binary): V_t[m] = 1 neu event type m xuat hien
 *   - groupVec (13 dim binary): G_t[g] = 1 neu group g co event
 *
 * Factors duoc map sang event types thong qua taxonomy.
 * Nhieu factors khac nhau co the consolidate vao cung 1 type.
 */

import type { DailyJsonInput, DayVector } from "./types";
import { buildTypeVector, buildGroupVector } from "./taxonomy";

export function vectorize(input: DailyJsonInput): DayVector {
  const typeVec = buildTypeVector(input.factors);
  const groupVec = buildGroupVector(input.factors);
  return { typeVec, groupVec };
}
