import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Rocket, Loader2, AlertCircle, Target, Shield, Zap, Skull, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { fetchKlines, formatPrice } from "@/lib/binance";
import { snapshotFromCandles, scoreSignal, type IndicatorSnapshot, type ScoredSignal } from "@/lib/indicators";
import { SCANNER_UNIVERSE } from "@/lib/scanner";
import { PlanDetails, type PlanCommon } from "@/components/PlanDetails";
import { cn } from "@/lib/utils";

interface FuturesPlan extends PlanCommon {
  side: "long" | "short" | "neutral";
  leverage: number;
  fundingNote: string;
}

const TOP_SYMBOLS = SCANNER_UNIVERSE.slice(0, 30);
const LEVERAGES = [3, 5, 10, 20, 50];
const MTF_INTERVALS = ["15m", "1h", "4h", "1d"];

interface TFSnap {
  interval: string;
  snapshot: IndicatorSnapshot;
  signal: ScoredSignal;
}

export default function Futures() {
  const [params] = useSearchParams();
  const initialSymbol = (params.get("symbol") || "BTCUSDT").toUpperCase();
  const [symbol, setSymbol] = useState(initialSymbol);

  useEffect(() => {
    const s = params.get("symbol");
    if (s) setSymbol(s.toUpperCase());
  }, [params]);

  const [interval, setInterval] = useState("1h");
  const [accountSize, setAccountSize] = useState(10_000);
  const [maxLev, setMaxLev] = useState(10);
  const [plan, setPlan] = useState<FuturesPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snap, setSnap] = useState<IndicatorSnapshot | null>(null);
  const [mtfSnaps, setMtfSnaps] = useState<TFSnap[]>([]);

  useEffect(() => {
    let cancelled = false;
    setPlan(null); setError(null); setSnap(null); setMtfSnaps([]);

    const load = async () => {
      try {
        const primaryP = fetchKlines(symbol, interval, 300);
        const extras = MTF_INTERVALS.filter((i) => i !== interval).slice(0, 3);
        const extraPs = extras.map((iv) => fetchKlines(symbol, iv, 250));
        const [primaryK, ...extraKs] = await Promise.all([primaryP, ...extraPs]);
        if (cancelled) return;
        const ps = snapshotFromCandles(primaryK);
        setSnap(ps);
        const tf = extraKs.map((k, i) => {
          const s = snapshotFromCandles(k);
          return { interval: extras[i], snapshot: s, signal: scoreSignal(s) };
        });
        setMtfSnaps(tf);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [symbol, interval]);

  const sig = useMemo(() => snap ? scoreSignal(snap) : null, [snap]);

  const generatePlan = async () => {
    if (!snap || !sig) return;
    setLoading(true); setError(null);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trade-plan`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          mode: "futures", symbol, interval,
          snapshot: snap, signal: sig,
          multiTf: mtfSnaps,
          accountSize, maxLev,
        }),
      });
      if (!resp.ok) {
        if (resp.status === 429) throw new Error("Rate limit hit.");
        if (resp.status === 402) throw new Error("AI credits exhausted.");
        throw new Error(`Plan request failed (${resp.status})`);
      }
      const data = await resp.json();
      setPlan(data.plan as FuturesPlan);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const liqPct = plan ? (100 / plan.leverage) * 0.85 : 0;
  const stopDistPct = plan ? Math.abs((plan.entry.low - plan.stop) / plan.entry.low) * 100 : 0;
  const positionUsd = plan ? (accountSize * plan.riskPct) / 100 / (stopDistPct / 100) : 0;
  const notional = positionUsd;
  const margin = plan ? notional / plan.leverage : 0;

  return (
    <div className="grid h-full gap-2 overflow-hidden p-2 lg:grid-cols-[300px_1fr]">
      <div className="panel flex min-h-0 flex-col overflow-y-auto scrollbar-thin">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Rocket className="size-3.5 text-primary" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">Futures Master</h3>
        </div>
        <div className="flex flex-col gap-3 p-3">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Symbol</span>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="select-style">
              {Array.from(new Set([symbol, ...TOP_SYMBOLS])).map((s) => <option key={s} value={s}>{s.replace("USDT", "-PERP")}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Timeframe</span>
            <div className="flex overflow-hidden rounded-md border border-border bg-surface-elevated">
              {["15m", "1h", "4h", "1d"].map((i) => (
                <button key={i} onClick={() => setInterval(i)} className={cn("flex-1 py-1 font-mono text-[11px] font-semibold", interval === i ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-hover")}>{i}</button>
              ))}
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Account Size (USD)</span>
            <input type="number" value={accountSize} onChange={(e) => setAccountSize(Number(e.target.value) || 0)} className="select-style" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Max Leverage</span>
            <div className="flex overflow-hidden rounded-md border border-border bg-surface-elevated">
              {LEVERAGES.map((l) => (
                <button key={l} onClick={() => setMaxLev(l)} className={cn("flex-1 py-1 font-mono text-[11px] font-semibold", maxLev === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-hover")}>{l}×</button>
              ))}
            </div>
          </label>

          {snap && sig && (
            <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-elevated p-2 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Live Read</span>
                <Activity className="size-3 text-primary" />
              </div>
              <Row k="Price" v={`$${formatPrice(snap.price)}`} bold />
              <Row k="RSI(14)" v={snap.rsi14?.toFixed(1) ?? "—"} />
              <Row k="Stoch %K/%D" v={snap.stochK !== null && snap.stochD !== null ? `${snap.stochK.toFixed(0)}/${snap.stochD.toFixed(0)}` : "—"} />
              <Row k="ATR%" v={snap.atrPct !== null ? `${snap.atrPct.toFixed(2)}%` : "—"} />
              <Row k="BB %B" v={snap.bbPercentB !== null ? snap.bbPercentB.toFixed(2) : "—"} />
              <Row k="Vol vs avg" v={snap.volRatio !== null ? `${snap.volRatio.toFixed(2)}×` : "—"} />
              <Row k="Bias" v={sig.bias.toUpperCase()} cls={sig.bias === "bull" ? "text-bull" : sig.bias === "bear" ? "text-bear" : "text-muted-foreground"} bold />
              <Row k="Score" v={String(sig.score)} />
            </div>
          )}

          {mtfSnaps.length > 0 && (
            <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-elevated p-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">MTF Bias</span>
              <div className="flex gap-1">
                {mtfSnaps.map((tf) => (
                  <div
                    key={tf.interval}
                    className={cn(
                      "flex-1 rounded border px-1 py-1 text-center font-mono",
                      tf.signal.bias === "bull" ? "border-bull/40 bg-bull/10 text-bull"
                      : tf.signal.bias === "bear" ? "border-bear/40 bg-bear/10 text-bear"
                      : "border-border text-muted-foreground"
                    )}
                  >
                    <div className="text-[10px] font-bold">{tf.interval}</div>
                    <div className="text-[9px] uppercase">{tf.signal.bias}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={generatePlan}
            disabled={loading || !snap}
            className="flex items-center justify-center gap-2 rounded-md border border-primary bg-primary py-2 font-mono text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary-glow disabled:opacity-50"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
            {loading ? "Building plan…" : "Generate Futures Plan"}
          </button>
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 font-mono text-[11px] text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
            </div>
          )}
        </div>
      </div>

      <div className="panel min-h-0 overflow-y-auto scrollbar-thin">
        {!plan && !loading && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <Rocket className="size-10 text-muted-foreground/40" />
            <h2 className="font-mono text-lg font-bold neon-text">Futures Trading Master</h2>
            <p className="max-w-md font-mono text-xs leading-relaxed text-muted-foreground">
              Long/short bias with leverage discipline, liquidation distance, multi-timeframe confluence, indicator breakdown, and bull/bear scenarios — all derived from live indicators and AI reasoning.
            </p>
          </div>
        )}
        {plan && snap && (
          <div className="flex flex-col gap-3 p-3">
            <div className={cn("rounded-lg border-2 p-4", plan.side === "long" ? "border-bull bg-bull/10" : plan.side === "short" ? "border-bear bg-bear/10" : "border-muted bg-muted/20")}>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{symbol.replace("USDT", "-PERP")} · {interval}</span>
                  <h2 className={cn("flex items-center gap-2 font-mono text-3xl font-black uppercase neon-text", plan.side === "long" ? "text-bull" : plan.side === "short" ? "text-bear" : "text-muted-foreground")}>
                    {plan.side === "long" ? <><TrendingUp className="size-7" /> LONG {plan.leverage}×</> : plan.side === "short" ? <><TrendingDown className="size-7" /> SHORT {plan.leverage}×</> : "NEUTRAL"}
                  </h2>
                </div>
                <div className="text-right">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Conviction</span>
                  <div className="font-mono text-2xl font-bold">{plan.conviction}<span className="text-sm text-muted-foreground">/100</span></div>
                </div>
              </div>
            </div>

            {plan.side !== "neutral" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <KPI icon={Rocket} label="Entry Zone" value={`${formatPrice(plan.entry.low)} – ${formatPrice(plan.entry.high)}`} tone="primary" />
                  <KPI icon={Shield} label="Stop Loss" value={`$${formatPrice(plan.stop)} (${stopDistPct.toFixed(2)}%)`} tone="bear" />
                  <KPI icon={Target} label="Targets" value={plan.targets.map((t) => `$${formatPrice(t)}`).join(" → ")} tone="bull" />
                  <KPI icon={Skull} label="Est. Liquidation" value={`~${liqPct.toFixed(1)}% adverse move`} tone="bear" />
                </div>

                <div className="panel p-3">
                  <h3 className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">Position Math</h3>
                  <div className="grid gap-2 font-mono text-xs sm:grid-cols-3">
                    <div className="flex justify-between"><span className="text-muted-foreground">Notional</span><span className="font-bold">${notional.toFixed(0)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Margin</span><span className="font-bold">${margin.toFixed(0)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Risk</span><span className="font-bold text-bear">{plan.riskPct}% (${(accountSize * plan.riskPct / 100).toFixed(0)})</span></div>
                  </div>
                </div>
              </>
            )}

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="panel p-3">
                <h3 className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-bull">Setup</h3>
                <ul className="space-y-1.5">{plan.rationale.map((r, i) => <li key={i} className="flex items-start gap-2 font-mono text-xs"><span className="mt-1 size-1 shrink-0 rounded-full bg-bull" /><span className="text-foreground/80">{r}</span></li>)}</ul>
              </div>
              <div className="panel p-3">
                <h3 className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-bear">Risks</h3>
                <ul className="space-y-1.5">{plan.invalidations.map((r, i) => <li key={i} className="flex items-start gap-2 font-mono text-xs"><span className="mt-1 size-1 shrink-0 rounded-full bg-bear" /><span className="text-foreground/80">{r}</span></li>)}</ul>
              </div>
            </div>

            {plan.fundingNote && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-warning">⚠ Funding / Positioning</span>
                <p className="mt-0.5 font-mono text-xs text-foreground/80">{plan.fundingNote}</p>
              </div>
            )}

            <PlanDetails plan={plan} side={plan.side} currentPrice={snap.price} />

            <p className="font-mono text-[10px] text-muted-foreground">
              ⚠ Leverage trading can wipe out your account in minutes. Liquidation estimate is approximate (excludes funding & fees). Educational only — not financial advice.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, cls, bold }: { k: string; v: string; cls?: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn(cls, bold && "font-bold tabular-nums")}>{v}</span>
    </div>
  );
}

function KPI({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: "bull" | "bear" | "primary" }) {
  const cls = tone === "bull" ? "border-bull/30 text-bull" : tone === "bear" ? "border-bear/30 text-bear" : "border-primary/30 text-primary";
  return (
    <div className={cn("rounded-md border bg-surface-elevated p-3", cls)}>
      <div className="flex items-center gap-2">
        <Icon className="size-3.5" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1 font-mono text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}
