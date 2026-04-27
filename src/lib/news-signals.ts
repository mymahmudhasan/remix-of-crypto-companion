// Session-only store for news-derived trade signals shown on the dashboard.
// Lives in sessionStorage so it survives navigation but not browser close.
import type { NewsItem, NewsPlan } from "./news";

export interface NewsSignal {
  id: string;
  symbol: string;       // e.g. BTCUSDT
  base: string;         // e.g. BTC
  mode: "spot" | "futures";
  interval: string;
  source: "manual" | "auto";
  createdAt: number;
  news: {
    title: string;
    source: string;
    url: string;
    publishedAt: number;
    sentiment: NewsItem["sentiment"];
  };
  plan: NewsPlan;
}

const KEY = "news-signals/v1";
const MAX = 25;
const EVT = "news-signals:changed";

function read(): NewsSignal[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as NewsSignal[];
  } catch { return []; }
}

function write(items: NewsSignal[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
    window.dispatchEvent(new CustomEvent(EVT));
  } catch { /* ignore */ }
}

export function listNewsSignals(): NewsSignal[] {
  return read().sort((a, b) => b.createdAt - a.createdAt);
}

export function addNewsSignal(sig: Omit<NewsSignal, "id" | "createdAt"> & { id?: string }): NewsSignal {
  const items = read();
  const id = sig.id ?? `${sig.symbol}:${sig.news.url}:${sig.source}`;
  // dedupe — replace if same id exists
  const filtered = items.filter((s) => s.id !== id);
  const full: NewsSignal = { ...sig, id, createdAt: Date.now() };
  write([full, ...filtered]);
  return full;
}

export function removeNewsSignal(id: string) {
  write(read().filter((s) => s.id !== id));
}

export function clearNewsSignals() { write([]); }

export function hasNewsSignal(id: string): boolean {
  return read().some((s) => s.id === id);
}

export function onNewsSignalsChanged(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function buildSignalId(symbol: string, url: string, source: "manual" | "auto") {
  return `${symbol}:${url}:${source}`;
}
