// Binance public REST + WebSocket helpers (no API key required)

export interface Ticker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
}

export interface Kline {
  time: number; // seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Multiple Binance hosts — try in order. `api.binance.com` is geo-blocked in some
// regions (US, etc.) which surfaces in the browser as `TypeError: Failed to fetch`
// (no CORS headers on the network error). The data-api.binance.vision mirror is
// public-data only and works from most networks.
const REST_HOSTS = [
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
  "https://data-api.binance.vision",
];

let _preferredHostIdx = 0;

async function restFetch(path: string): Promise<Response> {
  let lastErr: unknown = null;
  // Start from the host that worked last time, then try the rest.
  const order = [
    ..._preferredHostIdx > 0 ? [_preferredHostIdx] : [],
    ...REST_HOSTS.map((_, i) => i).filter((i) => i !== _preferredHostIdx),
  ];
  for (const idx of order) {
    const host = REST_HOSTS[idx];
    try {
      const res = await fetch(`${host}${path}`);
      if (res.ok) {
        _preferredHostIdx = idx;
        return res;
      }
      // 4xx (e.g. 451 region block) → try next host
      lastErr = new Error(`${host} → ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All Binance hosts unreachable");
}

export async function fetch24h(symbols?: string[]): Promise<Ticker24h[]> {
  const path = symbols && symbols.length
    ? `/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`
    : `/api/v3/ticker/24hr`;
  const res = await restFetch(path);
  return res.json();
}

export interface ExchangeSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  isSpotTradingAllowed: boolean;
}

let _exchangeInfoCache: ExchangeSymbol[] | null = null;
export async function fetchExchangeInfo(): Promise<ExchangeSymbol[]> {
  if (_exchangeInfoCache) return _exchangeInfoCache;
  const res = await restFetch(`/api/v3/exchangeInfo`);
  const data = await res.json();
  _exchangeInfoCache = (data.symbols as ExchangeSymbol[]).filter(
    (s) => s.status === "TRADING" && s.isSpotTradingAllowed
  );
  return _exchangeInfoCache;
}

/** Fetch all currently TRADING USDT spot pairs from Binance. */
export async function fetchAllUsdtSymbols(): Promise<string[]> {
  const info = await fetchExchangeInfo();
  return info.filter((s) => s.quoteAsset === "USDT").map((s) => s.symbol);
}

export async function fetchKlines(symbol: string, interval: string, limit = 200): Promise<Kline[]> {
  const res = await restFetch(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  const raw: any[][] = await res.json();
  return raw.map((k) => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

export type MiniTickerMsg = {
  e: "24hrMiniTicker";
  s: string;
  c: string; // close
  o: string; // open
  h: string;
  l: string;
  v: string;
  q: string; // quote volume
};

export function subscribeMiniTickers(symbols: string[], onMsg: (m: MiniTickerMsg) => void): () => void {
  const streams = symbols.map((s) => `${s.toLowerCase()}@miniTicker`).join("/");
  const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data?.data) onMsg(data.data as MiniTickerMsg);
    } catch {}
  };
  ws.onerror = () => {};
  return () => {
    try { ws.close(); } catch {}
  };
}

export function subscribeKline(symbol: string, interval: string, onMsg: (k: Kline) => void): () => void {
  const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`);
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      const k = data?.k;
      if (!k) return;
      onMsg({
        time: Math.floor(k.t / 1000),
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
      });
    } catch {}
  };
  return () => { try { ws.close(); } catch {} };
}

export function formatPrice(n: number): string {
  if (!isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

export function formatCompact(n: number): string {
  if (!isFinite(n)) return "—";
  return Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(n);
}
