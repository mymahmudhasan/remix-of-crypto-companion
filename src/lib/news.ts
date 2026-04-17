// Client-side helpers for the news feed.
import { supabase } from "@/integrations/supabase/client";

export interface NewsItem {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: number;
  symbols: string[]; // base symbols (BTC, ETH, …)
  sentiment: "bullish" | "bearish" | "neutral";
  sentimentScore: number;
  matchedKeywords: { bull: string[]; bear: string[] };
}

const FN_BASE = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;

export async function fetchNews(opts: { symbol?: string; limit?: number } = {}): Promise<NewsItem[]> {
  const params = new URLSearchParams();
  if (opts.symbol) params.set("symbol", opts.symbol.replace(/USDT$/, "").toUpperCase());
  if (opts.limit) params.set("limit", String(opts.limit));
  const res = await fetch(`${FN_BASE}/news-fetch?${params}`, {
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`News fetch failed: ${res.status}`);
  const data = await res.json();
  return data.items as NewsItem[];
}

export interface NewsPlan {
  bias: "long" | "short" | "neutral";
  verdict: "GO" | "WAIT" | "SKIP";
  confidence: number;
  headline: string;
  thesis: string;
  catalystImpact: "high" | "medium" | "low";
  timeHorizon: "scalp" | "intraday" | "swing";
  levels: {
    entryLow: number; entryHigh: number; stop: number;
    targets: number[]; leverage?: number; riskPct: number;
  };
  invalidation: string;
  risks: string[];
}

export async function buildNewsPlan(payload: {
  symbol: string;
  mode: "spot" | "futures";
  interval: string;
  news: Pick<NewsItem, "title" | "summary" | "source" | "sentiment" | "publishedAt">;
  snapshot: {
    price: number; rsi14: number | null;
    ema20: number | null; ema50: number | null; ema200: number | null;
    atr14?: number | null; recentHigh: number; recentLow: number;
  };
}): Promise<NewsPlan> {
  const { data, error } = await supabase.functions.invoke("news-plan", { body: payload });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data.plan as NewsPlan;
}

/** Map a base symbol like "BTC" → "BTCUSDT" (Binance pair). */
export function baseToPair(base: string): string {
  return `${base.toUpperCase()}USDT`;
}

export function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
