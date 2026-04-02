/**
 * Fetch daily OHLCV data for BTC and ETH from Binance via ccxt.
 */

import ccxt from "ccxt";
import { TRADING_PAIRS, type Asset } from "../config";

export interface PriceRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  return_pct: number | null;
}

export async function fetchDailyOhlcv(
  asset: Asset = "BTC",
  startDate: string = "2025-01-01",
  endDate?: string
): Promise<PriceRow[]> {
  const exchange = new ccxt.binance({ enableRateLimit: true });
  const symbol = TRADING_PAIRS[asset];

  let since = exchange.parse8601(`${startDate}T00:00:00Z`)!;
  const endDt = endDate ? new Date(endDate) : new Date();
  const endTs = endDt.getTime();

  const allCandles: number[][] = [];
  while (since < endTs) {
    const candles = await exchange.fetchOHLCV(symbol, "1d", since, 500);
    if (!candles.length) break;
    for (const c of candles) {
      allCandles.push(c.map((v) => v ?? 0));
    }
    since = (candles[candles.length - 1][0] ?? 0) + 86_400_000;
    if (candles.length < 500) break;
  }

  const endStr = endDate || endDt.toISOString().slice(0, 10);
  const rows: PriceRow[] = [];
  const seen = new Set<string>();

  for (const c of allCandles) {
    const date = new Date(c[0]).toISOString().slice(0, 10);
    if (date > endStr || seen.has(date)) continue;
    seen.add(date);
    rows.push({
      date,
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
      return_pct: null,
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));

  // Compute daily returns
  for (let i = 1; i < rows.length; i++) {
    rows[i].return_pct = (rows[i].close - rows[i - 1].close) / rows[i - 1].close;
  }

  console.log(`Fetched ${rows.length} daily candles for ${asset}`);
  return rows;
}
