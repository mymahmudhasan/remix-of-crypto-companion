import { useCallback, useEffect, useState } from "react";
import {
  MessageSquare, TrendingUp, TrendingDown, Minus, Flame, Loader2,
  RefreshCw, Sparkles, Users, AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface SamplePost {
  stance: "bullish" | "bearish" | "neutral";
  text: string;
  author_handle: string;
}

export interface SocialSentimentData {
  total_posts: number;
  bullish_posts: number;
  bearish_posts: number;
  neutral_posts: number;
  bullish_pct: number;
  bearish_pct: number;
  neutral_pct: number;
  top_themes: string[];
  sample_posts: SamplePost[];
  ai_trending: {
    rank: number | null;
    trend_direction: "rising" | "falling" | "stable";
    momentum_score: number;
  };
  verdict: "crowd_bullish" | "crowd_bearish" | "mixed" | "low_signal";
  alignment_with_setup: "aligned" | "contrarian" | "neutral";
  one_liner: string;
}

interface Props {
  symbol: string;
  side?: "long" | "short" | "neutral";
  entry?: { low: number; high: number };
  stop?: number;
  targets?: number[];
  /** Compact = inline mode used in trade-plan cards (no sample posts/themes) */
  compact?: boolean;
  /** auto-fetch on mount (default false to keep AI cost low) */
  autoFetch?: boolean;
}

const verdictMeta = {
  crowd_bullish: { label: "Crowd Bullish", cls: "text-bull border-bull/40 bg-bull/10" },
  crowd_bearish: { label: "Crowd Bearish", cls: "text-bear border-bear/40 bg-bear/10" },
  mixed: { label: "Mixed", cls: "text-warning border-warning/40 bg-warning/10" },
  low_signal: { label: "Low Signal", cls: "text-muted-foreground border-border bg-surface-elevated" },
};

const alignMeta = {
  aligned: { label: "Aligned w/ setup", cls: "text-bull" },
  contrarian: { label: "Contrarian to setup", cls: "text-bear" },
  neutral: { label: "Neutral vs setup", cls: "text-muted-foreground" },
};

const stanceMeta = {
  bullish: { Icon: TrendingUp, cls: "text-bull border-bull/40" },
  bearish: { Icon: TrendingDown, cls: "text-bear border-bear/40" },
  neutral: { Icon: Minus, cls: "text-muted-foreground border-border" },
};

/** Binance Square post sentiment + AI trending widget (Lovable-AI simulated). */
export function SocialSentiment({
  symbol, side = "neutral", entry, stop, targets,
  compact = false, autoFetch = false,
}: Props) {
  const [data, setData] = useState<SocialSentimentData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: resp, error: fnErr } = await supabase.functions.invoke("social-sentiment", {
        body: { symbol, side, entry, stop, targets },
      });
      if (fnErr) throw new Error(fnErr.message || "Failed to fetch sentiment");
      if (resp?.error) throw new Error(resp.error);
      if (!resp?.sentiment) throw new Error("Empty sentiment response");
      setData(resp.sentiment as SocialSentimentData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [symbol, side, entry, stop, targets]);

  useEffect(() => {
    if (autoFetch && !data && !loading) run();
    // intentionally only refetch when autoFetch toggles or symbol changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, symbol]);

  // ============= COMPACT (inline in plan cards) =============
  if (compact) {
    return (
      <div className="panel p-2.5">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <MessageSquare className="size-3.5 text-primary" />
          <h4 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">
            Binance Square Sentiment
          </h4>
          <span className="rounded border border-border bg-surface-elevated px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            AI estimated · 24h
          </span>
          <div className="ml-auto">
            {!data && !loading && (
              <button
                onClick={run}
                className="flex items-center gap-1 rounded border border-primary/50 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-primary hover:bg-primary/20"
              >
                <Sparkles className="size-3" /> Check Crowd
              </button>
            )}
            {data && (
              <button
                onClick={run}
                disabled={loading}
                className="flex items-center gap-1 rounded border border-border bg-surface-elevated px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground hover:text-primary disabled:opacity-50"
              >
                <RefreshCw className={cn("size-2.5", loading && "animate-spin")} />
              </button>
            )}
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-1.5 py-1 font-mono text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin text-primary" /> Polling Binance Square…
          </div>
        )}
        {error && (
          <div className="rounded border border-bear/40 bg-bear/10 p-1.5 font-mono text-[10px] text-bear">
            {error}
          </div>
        )}
        {!data && !loading && !error && (
          <p className="font-mono text-[10.5px] text-muted-foreground">
            See how the Binance community is leaning before you take this entry.
          </p>
        )}
        {data && <SentimentCore data={data} side={side} compact />}
      </div>
    );
  }

  // ============= FULL (Pro Analysis tab) =============
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="size-3.5 text-primary" />
        <span className="font-mono text-[11px] uppercase tracking-wider text-primary">
          Binance Square + AI Trending
        </span>
        <span className="rounded border border-border bg-surface-elevated px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          AI estimated · 24h
        </span>
        <div className="ml-auto">
          {!data && !loading && (
            <button
              onClick={run}
              className="flex items-center gap-1.5 rounded border border-primary/50 bg-primary/10 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-primary hover:bg-primary/20"
            >
              <Sparkles className="size-3" /> Run Sentiment Poll
            </button>
          )}
          {data && (
            <button
              onClick={run}
              disabled={loading}
              className="flex items-center gap-1 rounded border border-border bg-surface-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-primary disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3", loading && "animate-spin")} /> Refresh
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-3 font-mono text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" />
          Polling Binance Square posts + AI trending…
        </div>
      )}
      {error && (
        <div className="rounded border border-bear/40 bg-bear/10 p-2 font-mono text-[11px] text-bear">
          {error}
          <button onClick={run} className="ml-2 underline hover:text-foreground">retry</button>
        </div>
      )}
      {!data && !loading && !error && (
        <p className="font-mono text-[11px] text-muted-foreground">
          Click <span className="text-primary">Run Sentiment Poll</span> to estimate how the
          Binance community is positioned and where this coin ranks on Binance AI Trending.
        </p>
      )}
      {data && <SentimentCore data={data} side={side} />}
    </div>
  );
}

/** Shared core: bull/bear bar + trending + (optional) themes/posts. */
function SentimentCore({
  data, side, compact = false,
}: { data: SocialSentimentData; side: "long" | "short" | "neutral"; compact?: boolean }) {
  const verdict = verdictMeta[data.verdict];
  const align = alignMeta[data.alignment_with_setup];
  const tr = data.ai_trending;
  const TrendIcon =
    tr.trend_direction === "rising" ? TrendingUp
    : tr.trend_direction === "falling" ? TrendingDown : Minus;
  const trendCls =
    tr.trend_direction === "rising" ? "text-bull"
    : tr.trend_direction === "falling" ? "text-bear" : "text-muted-foreground";

  return (
    <div className="space-y-2">
      {/* Verdict + alignment */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded border px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider", verdict.cls)}>
          {verdict.label}
        </span>
        {side !== "neutral" && (
          <span className={cn("font-mono text-[10px] font-bold uppercase tracking-wider", align.cls)}>
            {data.alignment_with_setup === "contrarian" && <AlertTriangle className="mr-1 inline size-3" />}
            {align.label}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {data.total_posts.toLocaleString()} posts / 24h
        </span>
      </div>

      {/* Bull vs Bear bar */}
      <div>
        <div className="mb-1 flex items-center justify-between font-mono text-[10px] tabular-nums">
          <span className="text-bull">🟢 {data.bullish_posts} ({Math.round(data.bullish_pct)}%)</span>
          {data.neutral_pct > 0 && (
            <span className="text-muted-foreground">⚪ {data.neutral_posts} ({Math.round(data.neutral_pct)}%)</span>
          )}
          <span className="text-bear">🔴 {data.bearish_posts} ({Math.round(data.bearish_pct)}%)</span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full border border-border bg-surface-elevated">
          <div
            className="bg-bull transition-all"
            style={{ width: `${data.bullish_pct}%` }}
            title={`Bullish ${data.bullish_pct}%`}
          />
          <div
            className="bg-muted-foreground/40 transition-all"
            style={{ width: `${data.neutral_pct}%` }}
            title={`Neutral ${data.neutral_pct}%`}
          />
          <div
            className="bg-bear transition-all"
            style={{ width: `${data.bearish_pct}%` }}
            title={`Bearish ${data.bearish_pct}%`}
          />
        </div>
      </div>

      {/* AI trending strip */}
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-border bg-surface-elevated p-2">
          <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            <Flame className="mr-0.5 inline size-3 text-warning" />
            AI Trending Rank
          </div>
          <div className="mt-0.5 font-mono text-base font-bold tabular-nums">
            {tr.rank ? `#${tr.rank}` : <span className="text-muted-foreground text-sm">Not ranked</span>}
          </div>
        </div>
        <div className="rounded-md border border-border bg-surface-elevated p-2">
          <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            Trend Direction
          </div>
          <div className={cn("mt-0.5 flex items-center gap-1 font-mono text-sm font-bold uppercase", trendCls)}>
            <TrendIcon className="size-3.5" /> {tr.trend_direction}
          </div>
        </div>
        <div className="rounded-md border border-border bg-surface-elevated p-2">
          <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            Momentum
          </div>
          <div className="mt-0.5 font-mono text-base font-bold tabular-nums text-primary">
            {tr.momentum_score}<span className="text-xs text-muted-foreground">/100</span>
          </div>
        </div>
      </div>

      {/* One-liner */}
      <p className="rounded border-l-2 border-primary/50 bg-surface-elevated/60 px-2 py-1 font-mono text-[11px] leading-snug text-foreground/90">
        {data.one_liner}
      </p>

      {/* Themes + sample posts (full mode only) */}
      {!compact && (
        <>
          {data.top_themes?.length > 0 && (
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-primary">
                Top Themes
              </div>
              <div className="flex flex-wrap gap-1">
                {data.top_themes.map((t, i) => (
                  <span
                    key={i}
                    className="rounded border border-border bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-foreground/80"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.sample_posts?.length > 0 && (
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-primary">
                Sample Posts
              </div>
              <div className="space-y-1.5">
                {data.sample_posts.map((p, i) => {
                  const m = stanceMeta[p.stance];
                  const Icon = m.Icon;
                  return (
                    <div
                      key={i}
                      className={cn(
                        "rounded border-l-2 bg-surface-elevated/50 px-2 py-1.5",
                        m.cls
                      )}
                    >
                      <div className="mb-0.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider opacity-80">
                        <Icon className="size-3" />
                        <span className="font-bold">{p.stance}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">@{p.author_handle}</span>
                      </div>
                      <p className="font-mono text-[11px] leading-snug text-foreground/85">
                        {p.text}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
