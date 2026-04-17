import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ShoppingCart, Loader2, AlertCircle, Target, Shield, TrendingUp, DollarSign } from "lucide-react";
import { fetchKlines, formatPrice } from "@/lib/binance";
import { snapshot, scoreSignal } from "@/lib/indicators";
import { SCANNER_UNIVERSE } from "@/lib/scanner";
import { cn } from "@/lib/utils";

interface SpotPlan {
  action: "buy" | "hold" | "sell" | "wait";
  conviction: number; // 0-100
  entry: { low: number; high: number };
  stop: number;
  targets: number[];
  riskPct: number;
  rationale: string[];
  invalidations: string[];
}

const TOP_SYMBOLS = SCANNER_UNIVERSE.slice(0, 30);

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
  const [closes, setCloses] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    setPlan(null); setError(null);
    fetchKlines(symbol, interval, 300).then((k) => {
      if (cancelled) return;
      setCloses(k.map((x) => x.close));
    }).catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [symbol, interval]);

  const snap = useMemo(() => closes.length >= 50 ? snapshot(closes) : null, [closes]);
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
        body: JSON.stringify({ mode: "spot", symbol, interval, snapshot: snap, signal: sig, accountSize }),
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
              {TOP_SYMBOLS.map((s) => <option key={s} value={s}>{s.replace("USDT", "/USDT")}</option>)}
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
            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-elevated p-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Live Read</span>
              <div className="flex justify-between font-mono text-xs"><span>Price</span><span className="font-bold">${formatPrice(snap.price)}</span></div>
              <div className="flex justify-between font-mono text-xs"><span>RSI(14)</span><span>{snap.rsi14?.toFixed(1)}</span></div>
              <div className="flex justify-between font-mono text-xs"><span>Bias</span><span className={cn("font-bold uppercase", sig.bias === "bull" ? "text-bull" : sig.bias === "bear" ? "text-bear" : "text-muted-foreground")}>{sig.bias}</span></div>
              <div className="flex justify-between font-mono text-xs"><span>Score</span><span>{sig.score}</span></div>
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

      {/* Plan output */}
      <div className="panel min-h-0 overflow-y-auto scrollbar-thin">
        {!plan && !loading && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <ShoppingCart className="size-10 text-muted-foreground/40" />
            <h2 className="font-mono text-lg font-bold neon-text">Spot Trading Master</h2>
            <p className="max-w-md font-mono text-xs leading-relaxed text-muted-foreground">
              Pick a symbol and timeframe, then generate a structured spot plan: entry zone, stop loss, multi-target take-profit, position sizing, and the reasoning behind it.
            </p>
          </div>
        )}
        {plan && <PlanView plan={plan} symbol={symbol} positionUsd={positionUsd} />}
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

function PlanView({ plan, symbol, positionUsd }: { plan: SpotPlan; symbol: string; positionUsd: number }) {
  const actionMeta: Record<SpotPlan["action"], { cls: string; label: string }> = {
    buy: { cls: "border-bull bg-bull/10 text-bull", label: "▲ BUY" },
    sell: { cls: "border-bear bg-bear/10 text-bear", label: "▼ SELL" },
    hold: { cls: "border-muted bg-muted/20 text-muted-foreground", label: "● HOLD" },
    wait: { cls: "border-warning bg-warning/10 text-warning", label: "⏸ WAIT" },
  };
  const meta = actionMeta[plan.action];

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className={cn("rounded-lg border-2 p-4", meta.cls)}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{symbol.replace("USDT", "/USDT")} · Spot Plan</span>
            <h2 className="font-mono text-3xl font-black uppercase neon-text">{meta.label}</h2>
          </div>
          <div className="text-right">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Conviction</span>
            <div className="font-mono text-2xl font-bold">{plan.conviction}<span className="text-sm text-muted-foreground">/100</span></div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI icon={ShoppingCart} label="Entry Zone" value={`${formatPrice(plan.entry.low)} – ${formatPrice(plan.entry.high)}`} tone="bull" />
        <KPI icon={Shield} label="Stop Loss" value={`$${formatPrice(plan.stop)}`} tone="bear" />
        <KPI icon={Target} label="Targets" value={plan.targets.map((t) => `$${formatPrice(t)}`).join(" → ")} tone="primary" />
        <KPI icon={DollarSign} label="Position Size" value={`$${positionUsd.toFixed(0)} (risk ${plan.riskPct}%)`} tone="primary" />
      </div>

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
