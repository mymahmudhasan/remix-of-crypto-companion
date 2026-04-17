// Scanner helpers: derive metrics from Binance 24hr ticker payloads
import type { Ticker24h } from "@/lib/binance";

export interface ScannerRow {
  symbol: string;
  base: string;
  quote: string;
  last: number;
  high: number;
  low: number;
  open: number;
  changePct: number;
  quoteVolume: number;
  // Distance from 24h low as % of 24h range. 0 = at low, 100 = at high.
  nearLowPct: number;
  // Spread between high and low as % of low.
  spreadPct: number;
  // 1=narrow (<3%), 2=mid (3-7%), 3=wide (>7%)
  spreadCategory: "tight" | "normal" | "wide";
}

export function tickerToRow(t: Ticker24h, quote = "USDT"): ScannerRow | null {
  const last = parseFloat(t.lastPrice);
  const high = parseFloat(t.highPrice);
  const low = parseFloat(t.lowPrice);
  if (!isFinite(last) || !isFinite(high) || !isFinite(low) || low <= 0) return null;
  const range = high - low || 1e-9;
  const nearLowPct = ((last - low) / range) * 100;
  const spreadPct = ((high - low) / low) * 100;
  const open = last / (1 + parseFloat(t.priceChangePercent) / 100);
  return {
    symbol: t.symbol,
    base: t.symbol.replace(quote, ""),
    quote,
    last,
    high,
    low,
    open,
    changePct: parseFloat(t.priceChangePercent),
    quoteVolume: parseFloat(t.quoteVolume),
    nearLowPct,
    spreadPct,
    spreadCategory: spreadPct < 3 ? "tight" : spreadPct < 7 ? "normal" : "wide",
  };
}

export type SortKey = "changePct" | "quoteVolume" | "spreadPct" | "nearLowPct" | "last";
export type SortDir = "asc" | "desc";

export function sortRows(rows: ScannerRow[], key: SortKey, dir: SortDir): ScannerRow[] {
  const out = [...rows];
  out.sort((a, b) => (dir === "asc" ? a[key] - b[key] : b[key] - a[key]));
  return out;
}

// All USDT spot pairs to scan (top liquid)
export const SCANNER_UNIVERSE = [
  "BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","TONUSDT",
  "TRXUSDT","DOTUSDT","MATICUSDT","NEARUSDT","APTUSDT","ARBUSDT","OPUSDT","SUIUSDT","INJUSDT","FILUSDT",
  "ATOMUSDT","LTCUSDT","BCHUSDT","ETCUSDT","UNIUSDT","AAVEUSDT","MKRUSDT","RUNEUSDT","SANDUSDT","AXSUSDT",
  "GALAUSDT","CHZUSDT","FLOWUSDT","EGLDUSDT","XTZUSDT","ICPUSDT","ALGOUSDT","FTMUSDT","HBARUSDT","VETUSDT",
  "RNDRUSDT","FETUSDT","TIAUSDT","SEIUSDT","STRKUSDT","JUPUSDT","WLDUSDT","ENAUSDT","PYTHUSDT","JTOUSDT",
  "DYMUSDT","BONKUSDT","PEPEUSDT","SHIBUSDT","FLOKIUSDT","WIFUSDT","ORDIUSDT","1000SATSUSDT","NOTUSDT","ENSUSDT",
  "LDOUSDT","CRVUSDT","COMPUSDT","SNXUSDT","DYDXUSDT","GMXUSDT","PENDLEUSDT","BLURUSDT","IMXUSDT","STXUSDT",
  "MINAUSDT","ROSEUSDT","KAVAUSDT","ZRXUSDT","BATUSDT","1INCHUSDT","SUSHIUSDT","YFIUSDT","RPLUSDT","MANTAUSDT",
];
