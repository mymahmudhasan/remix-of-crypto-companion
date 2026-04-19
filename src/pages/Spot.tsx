import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ShoppingCart, Loader2, AlertCircle, Target, Shield, TrendingUp, DollarSign, Activity } from "lucide-react";
import { fetchKlines, formatPrice } from "@/lib/binance";
import { snapshotFromCandles, scoreSignal, type IndicatorSnapshot, type ScoredSignal } from "@/lib/indicators";
import { SCANNER_UNIVERSE } from "@/lib/scanner";
import { PlanDetails, type PlanCommon } from "@/components/PlanDetails";
import { CandleChart } from "@/components/CandleChart";
import { LiquidityHeatmap } from "@/components/LiquidityHeatmap";
import { SavePlanButton } from "@/components/SavePlanButton";
import { cn } from "@/lib/utils";
import { WinChanceBadge } from "@/components/WinChanceBadge";

interface SpotPlan extends PlanCommon {
  action: "buy" | "hold" | "sell" | "wait";
}

const TOP_SYMBOLS = SCANNER_UNIVERSE.slice(0, 30);
const MTF_INTERVALS = ["1h", "4h", "1d"];

interface TFSnap {
  interval: string;
  snapshot: IndicatorSnapshot;
  signal: ScoredSignal;
}

export default function Spot() {
  const [params] = useSearchParams();
  const initialSymbol = (params.get("symbol") || "BTCUSDT").toUpperCase();
  const [symbol, setSymbol] = useState(initialSymbol);

  useEffect(() => {
    const s = params.get("symbol");
    if (s) setSymbol(s.toUpperCase());
  }, [params]);

  const [interval, setInterval] = useState("4h");
  const [accountSize, setAccountSize] = useState(10_000);
  const [plan, setPlan] = useState<SpotPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snap, setSnap] = useState<IndicatorSnapshot | null>(null);
  const [mtfSnaps, setMtfSnaps] = useState<TFSnap[]>([]);

  // Load primary timeframe + MTF in parallel
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
    setLoading(true);
    setError(null);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trade-plan`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          mode: "spot", symbol, interval,
          snapshot: snap, signal: sig,
          multiTf: mtfSnaps,
          accountSize,
        }),
      });
      if (!resp.ok) {
        if (resp.status === 429) throw new Error("Rate limit hit. Wait a moment.");
        if (resp.status === 402) throw new Error("AI credits exhausted. Add credits in workspace settings.");
        throw new Error(`Plan request failed (${resp.status})`);
      }
      const data = await resp.json();
      setPlan(data.plan as SpotPlan);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const positionUsd = plan ? (accountSize * plan.riskPct) / 100 / Math.abs((plan.entry.low - plan.stop) / plan.entry.low) : 0;
  const planSide: "long" | "short" | "neutral" =
    plan?.action === "buy" ? "long" : plan?.action === "sell" ? "short" : "neutral";

  return (
    <div className="grid h-full gap-2 overflow-hidden p-2 lg:grid-cols-[280px_1fr]">
      {/* Sidebar: configure */}
      <div className="panel flex min-h-0 flex-col overflow-y-auto scrollbar-thin">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <ShoppingCart className="size-3.5 text-primary" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">Spot Plan Builder</h3>
        </div>
        <div className="flex flex-col gap-3 p-3">
          <Field label="Symbol">
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="select-style">
              {Array.from(new Set([symbol, ...TOP_SYMBOLS])).map((s) => <option key={s} value={s}>{s.replace("USDT", "/USDT")}</option>)}
            </select>
          </Field>
          <Field label="Timeframe">
            <div className="flex overflow-hidden rounded-md border border-border bg-surface-elevated">
              {["1h", "4h", "1d"].map((i) => (
                <button key={i} onClick={() => setInterval(i)} className={cn("flex-1 py-1 font-mono text-[11px] font-semibold", interval === i ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-hover")}>{i}</button>
              ))}
            </div>
          </Field>
          <Field label="Account Size (USD)">
            <input type="number" value={accountSize} onChange={(e) => setAccountSize(Number(e.target.value) || 0)} className="select-style" />
          </Field>

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
            className="flex items-center justify-center gap-2 rounded-md border border-primary bg-primary py-2 font-mono text-xs font-bold uppercase tracking-wider text-primary-foreground transition-all hover:bg-primary-glow disabled:opacity-50"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <TrendingUp className="size-3.5" />}
            {loading ? "Building plan…" : "Generate AI Plan"}
          </button>
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 font-mono text-[11px] text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
            </div>
          )}
        </div>
      </div>

      {/* Right column: chart preview + plan output */}
      <RightColumn
        symbol={symbol}
        interval={interval}
        plan={plan}
        loading={loading}
        snap={snap}
        positionUsd={positionUsd}
        planSide={planSide}
      />
    </div>
  );
}

function RightColumn({
  symbol, interval, plan, loading, snap, positionUsd, planSide,
}: {
  symbol: string; interval: string; plan: SpotPlan | null; loading: boolean;
  snap: IndicatorSnapshot | null; positionUsd: number; planSide: "long" | "short" | "neutral";
}) {
  const chartWrapRef = useRef<HTMLDivElement>(null);
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="grid h-[260px] shrink-0 gap-2 lg:grid-cols-[1fr_320px]">
        <div ref={chartWrapRef} className="panel overflow-hidden p-2">
          <CandleChart symbol={symbol} interval={interval} />
        </div>
        <div className="hidden min-h-0 lg:block">
          <LiquidityHeatmap symbol={symbol} market="spot" />
        </div>
      </div>
      <div className="panel min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {!plan && !loading && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <ShoppingCart className="size-10 text-muted-foreground/40" />
            <h2 className="font-mono text-lg font-bold neon-text">Spot Trading Master</h2>
            <p className="max-w-md font-mono text-xs leading-relaxed text-muted-foreground">
              Pick a symbol and timeframe, then generate an in-depth spot plan with indicator breakdown, multi-timeframe confluence, bull/bear scenarios, and risk:reward per target.
            </p>
          </div>
        )}
        {plan && snap && (
          <PlanView
            plan={plan}
            symbol={symbol}
            interval={interval}
            positionUsd={positionUsd}
            currentPrice={snap.price}
            side={planSide}
            getChartEl={() => chartWrapRef.current}
          />
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
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

function PlanView({ plan, symbol, interval, positionUsd, currentPrice, side, getChartEl }: {
  plan: SpotPlan; symbol: string; interval: string; positionUsd: number; currentPrice: number; side: "long" | "short" | "neutral";
  getChartEl: () => HTMLElement | null;
}) {
  const actionMeta: Record<SpotPlan["action"], { cls: string; label: string }> = {
    buy: { cls: "border-bull bg-bull/10 text-bull", label: "▲ BUY" },
    sell: { cls: "border-bear bg-bear/10 text-bear", label: "▼ SELL" },
    hold: { cls: "border-muted bg-muted/20 text-muted-foreground", label: "● HOLD" },
    wait: { cls: "border-warning bg-warning/10 text-warning", label: "⏸ WAIT" },
  };
  const meta = actionMeta[plan.action];

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className={cn("rounded-lg border-2 p-4", meta.cls)}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{symbol.replace("USDT", "/USDT")} · Spot Plan</span>
            <h2 className="font-mono text-3xl font-black uppercase neon-text">{meta.label}</h2>
          </div>
          <div className="text-right">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Conviction</span>
            <div className="font-mono text-2xl font-bold">{plan.conviction}<span className="text-sm text-muted-foreground">/100</span></div>
            {side !== "neutral" && plan.targets?.[0] != null && (() => {
              const entryMid = (plan.entry.low + plan.entry.high) / 2;
              const risk = Math.abs(entryMid - plan.stop);
              const reward = Math.abs(plan.targets[0] - entryMid);
              const rr = risk > 0 ? reward / risk : 0;
              return (
                <div className="mt-1 flex justify-end">
                  <WinChanceBadge conviction={plan.conviction} risk_reward={rr} size="md" />
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI icon={ShoppingCart} label="Entry Zone" value={`${formatPrice(plan.entry.low)} – ${formatPrice(plan.entry.high)}`} tone="bull" />
        <KPI icon={Shield} label="Stop Loss" value={`$${formatPrice(plan.stop)}`} tone="bear" />
        <KPI icon={Target} label="Targets" value={plan.targets.map((t) => `$${formatPrice(t)}`).join(" → ")} tone="primary" />
        <KPI icon={DollarSign} label="Position Size" value={`$${positionUsd.toFixed(0)} (risk ${plan.riskPct}%)`} tone="primary" />
      </div>

      <SavePlanButton
        mode="spot"
        symbol={symbol}
        interval={interval}
        side={side}
        action={plan.action}
        entryPrice={currentPrice}
        plan={plan}
        getChartEl={getChartEl}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel p-3">
          <h3 className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-bull">Why this setup</h3>
          <ul className="space-y-1.5">
            {plan.rationale.map((r, i) => (
              <li key={i} className="flex items-start gap-2 font-mono text-xs">
                <span className="mt-1 size-1 shrink-0 rounded-full bg-bull" />
                <span className="text-foreground/80">{r}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel p-3">
          <h3 className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-bear">Invalidation</h3>
          <ul className="space-y-1.5">
            {plan.invalidations.map((r, i) => (
              <li key={i} className="flex items-start gap-2 font-mono text-xs">
                <span className="mt-1 size-1 shrink-0 rounded-full bg-bear" />
                <span className="text-foreground/80">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <PlanDetails plan={plan} side={side} currentPrice={currentPrice} symbol={symbol} mode="spot" />

      <p className="font-mono text-[10px] text-muted-foreground">
        ⚠ AI-generated educational analysis. Always size positions you can afford to lose. Not financial advice.
      </p>
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
