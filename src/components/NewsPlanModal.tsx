import { useState } from "react";
import { Loader2, X, AlertCircle, TrendingUp, TrendingDown, Minus, Bookmark, Check } from "lucide-react";
import { toast } from "sonner";
import { fetchKlines, formatPrice } from "@/lib/binance";
import { snapshotFromCandles } from "@/lib/indicators";
import { buildNewsPlan, type NewsItem, type NewsPlan } from "@/lib/news";
import { plansClient, SAVED_PLANS_TABLE } from "@/lib/plans-client";
import { getClientId } from "@/lib/client-id";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  news: NewsItem;
  /** Pre-selected pair to plan against. e.g. "BTCUSDT" */
  symbol: string;
  mode: "spot" | "futures";
  interval?: string;
}

export function NewsPlanModal({ open, onClose, news, symbol, mode, interval = "1h" }: Props) {
  const [plan, setPlan] = useState<NewsPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!open) return null;

  const generate = async () => {
    setLoading(true); setErr(null); setPlan(null); setSaved(false);
    try {
      const candles = await fetchKlines(symbol, interval, 220);
      if (!candles || candles.length < 50) throw new Error("Not enough chart data");
      const snap = snapshotFromCandles(candles);
      const result = await buildNewsPlan({
        symbol, mode, interval,
        news: {
          title: news.title, summary: news.summary, source: news.source,
          sentiment: news.sentiment, publishedAt: news.publishedAt,
        },
        snapshot: {
          price: snap.price,
          rsi14: snap.rsi14,
          ema20: snap.ema20, ema50: snap.ema50, ema200: snap.ema200,
          atr14: snap.atr14,
          recentHigh: snap.recentHigh, recentLow: snap.recentLow,
        },
      });
      setPlan(result);
    } catch (e: any) {
      setErr(e.message || "Plan failed");
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!plan) return;
    try {
      const status = plan.verdict === "GO" ? "open" : "cancelled";
      const { error } = await plansClient.from(SAVED_PLANS_TABLE).insert({
        client_id: getClientId(),
        mode, symbol, interval,
        side: plan.bias,
        action: plan.verdict,
        leverage: plan.levels.leverage ?? null,
        entry_low: plan.levels.entryLow,
        entry_high: plan.levels.entryHigh,
        stop: plan.levels.stop,
        targets: plan.levels.targets,
        conviction: plan.confidence,
        risk_pct: plan.levels.riskPct,
        plan: { kind: "news", news: { title: news.title, source: news.source, url: news.url, publishedAt: news.publishedAt }, ...plan } as any,
        notes: news.title,
        status,
      } as any);
      if (error) throw error;
      setSaved(true);
      toast.success("News plan saved", { description: `${symbol} · ${plan.bias.toUpperCase()} → Journal` });
    } catch (e: any) {
      toast.error("Save failed", { description: e.message });
    }
  };

  const verdictTone = plan?.verdict === "GO" ? "bull" : plan?.verdict === "WAIT" ? "warning" : "bear";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur" onClick={onClose}>
      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-surface shadow-2xl scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-surface/95 p-4 backdrop-blur">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-wider text-primary">News Plan · {symbol} · {mode}</div>
            <h2 className="mt-1 line-clamp-2 text-sm font-semibold text-foreground">{news.title}</h2>
            <div className="mt-1 font-mono text-[10px] text-muted-foreground">{news.source}</div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {!plan && !loading && !err && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Combine this headline with the live chart of <span className="font-mono text-foreground">{symbol}</span> ({interval}) to generate a directional bias, entry zone, stop, and targets.
              </p>
              <button
                onClick={generate}
                className="w-full rounded-md border border-primary bg-primary/10 px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider text-primary hover:bg-primary/20"
              >
                ⚡ Generate AI Plan
              </button>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span className="font-mono text-xs uppercase">Analyzing news + chart…</span>
            </div>
          )}

          {err && (
            <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="mt-px size-4 shrink-0" />
              <div className="flex-1">{err}</div>
              <button onClick={generate} className="rounded border border-destructive/40 px-2 py-1 font-mono text-[10px] uppercase hover:bg-destructive/10">Retry</button>
            </div>
          )}

          {plan && (
            <>
              <div className={cn(
                "rounded-md border-2 p-3",
                verdictTone === "bull" && "border-bull/50 bg-bull/10",
                verdictTone === "warning" && "border-warning/50 bg-warning/10",
                verdictTone === "bear" && "border-bear/50 bg-bear/10",
              )}>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "rounded px-2 py-0.5 font-mono text-xs font-bold",
                    verdictTone === "bull" && "bg-bull text-background",
                    verdictTone === "warning" && "bg-warning text-background",
                    verdictTone === "bear" && "bg-bear text-background",
                  )}>{plan.verdict}</span>
                  <span className="font-mono text-[11px] uppercase text-muted-foreground">
                    {plan.bias} · {plan.timeHorizon} · impact {plan.catalystImpact} · {plan.confidence}% conf
                  </span>
                  {plan.bias === "long" && <TrendingUp className="ml-auto size-4 text-bull" />}
                  {plan.bias === "short" && <TrendingDown className="ml-auto size-4 text-bear" />}
                  {plan.bias === "neutral" && <Minus className="ml-auto size-4 text-muted-foreground" />}
                </div>
                <h3 className="mt-2 text-sm font-semibold text-foreground">{plan.headline}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{plan.thesis}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                <Cell label="Entry" value={`${formatPrice(plan.levels.entryLow)} – ${formatPrice(plan.levels.entryHigh)}`} />
                <Cell label="Stop" value={formatPrice(plan.levels.stop)} tone="bear" />
                {plan.levels.targets.map((t, i) => (
                  <Cell key={i} label={`TP${i + 1}`} value={formatPrice(t)} tone="bull" />
                ))}
                <Cell label="Risk" value={`${plan.levels.riskPct}%`} />
                {plan.levels.leverage && <Cell label="Leverage" value={`${plan.levels.leverage}x`} />}
              </div>

              <div>
                <div className="font-mono text-[10px] uppercase text-muted-foreground">Invalidation</div>
                <p className="mt-1 text-xs text-foreground">{plan.invalidation}</p>
              </div>

              <div>
                <div className="font-mono text-[10px] uppercase text-muted-foreground">Risks</div>
                <ul className="mt-1 space-y-1 text-xs text-foreground">
                  {plan.risks.map((r, i) => <li key={i} className="flex gap-1.5"><span className="text-warning">⚠</span>{r}</li>)}
                </ul>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={save}
                  disabled={saved}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider",
                    saved
                      ? "border-bull bg-bull/10 text-bull"
                      : "border-primary bg-primary/10 text-primary hover:bg-primary/20"
                  )}
                >
                  {saved ? <><Check className="size-3.5" /> Saved to Journal</> : <><Bookmark className="size-3.5" /> Save to Journal</>}
                </button>
                <button
                  onClick={generate}
                  className="rounded-md border border-border px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground hover:border-primary hover:text-primary"
                >
                  Re-run
                </button>
              </div>

              <p className="font-mono text-[9px] uppercase text-muted-foreground">⚠ Educational only — not financial advice.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="rounded border border-border bg-card/60 px-2 py-1.5">
      <div className="text-[9px] uppercase text-muted-foreground">{label}</div>
      <div className={cn(
        "mt-0.5 text-foreground",
        tone === "bull" && "text-bull",
        tone === "bear" && "text-bear",
      )}>{value}</div>
    </div>
  );
}
