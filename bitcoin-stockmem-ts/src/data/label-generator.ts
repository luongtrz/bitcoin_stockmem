/**
 * Generate up/down/flat labels from daily price returns.
 */

import { PRICE_THRESHOLD } from "../config";
import type { PriceRow } from "./price-fetcher";

export interface LabelledRow extends PriceRow {
  next_return: number | null;
  label: "up" | "down" | "flat";
}

export function generateLabels(
  rows: PriceRow[],
  threshold = PRICE_THRESHOLD
): LabelledRow[] {
  return rows.map((row, i) => {
    const nextReturn = i < rows.length - 1 ? rows[i + 1].return_pct : null;
    let label: "up" | "down" | "flat" = "flat";
    if (nextReturn !== null && nextReturn !== undefined) {
      if (nextReturn > threshold) label = "up";
      else if (nextReturn < -threshold) label = "down";
    }
    return { ...row, next_return: nextReturn, label };
  });
}

export function filterTradableDays(rows: LabelledRow[]): LabelledRow[] {
  return rows.filter((r) => r.label !== "flat");
}
