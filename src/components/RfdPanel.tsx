import { useEffect, useState } from "react";
import { fetchKlines, formatPrice } from "@/lib/binance";
import { rfd, ema } from "@/lib/indicators";
import { Activity, TrendingUp, TrendingDown, Minus, Loader2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

type Timeframe = "15m" | "1h" | "4h" | "1d";
const TIMEFRAMES: Timeframe[] = ["15m", "1h", "4h", "1d"];

interface Props {
  symbol: string;
}

type Verdict = "buy" | "strong_buy" | "sell" | "strong_sell" | "neutral";

interface RfdAnalysis {
  value: number;
  prev: number | null;
  delta: number | null;
  histogram: number[]; // last 30 RFD readings for sparkline
  crossUp: boolean;
  crossDown: boolean;
  divergence: "bull" | "bear" | null;
  rfdEma: number | null; // smoothed RFD (signal line, like MACD signal)
  histVsSignal: number | null; // RFD - rfdEma (the histogram)
  verdict: Verdict;
  verdictReasons: string[];
  price: number;
}

function classify(
  value: number,
  delta: number | null,
  crossUp: boolean,
  crossDown: boolean,
  divergence: "bull" | "bear" | null,
  histVsSignal: number | null
): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];
  let bullPts = 0;
  let bearPts = 0;

  // Magnitude
  if (value >= 60) { bullPts += 3; reasons.push(`RFD ${value.toFixed(0)} → explosive bull force`); }
  else if (value >= 25) { bullPts += 2; reasons.push(`RFD ${value.toFixed(0)} → bull force expanding`); }
  else if (value <= -60) { bearPts += 3; reasons.push(`RFD ${value.toFixed(0)} → explosive bear force`); }
  else if (value <= -25) { bearPts += 2; reasons.push(`RFD ${value.toFixed(0)} → bear force expanding`); }
  else { reasons.push(`RFD ${value.toFixed(0)} → force in neutral zone`); }

  // Crosses
  if (crossUp) { bullPts += 2; reasons.push("Crossed above zero (force regime flip ↑)"); }
  if (crossDown) { bearPts += 2; reasons.push("Crossed below zero (force regime flip ↓)"); }

  // Histogram vs signal line (MACD-style)
  if (histVsSignal !== null) {
    if (histVsSignal > 8) { bullPts += 1; reasons.push("RFD above signal line (momentum building)"); }
    else if (histVsSignal < -8) { bearPts += 1; reasons.push("RFD below signal line (momentum fading)"); }
  }

  // Acceleration (delta)
  if (delta !== null) {
    if (delta > 10 && value > 0) { bullPts += 1; reasons.push(`Δ +${delta.toFixed(1)} accelerating up`); }
    else if (delta < -10 && value < 0) { bearPts += 1; reasons.push(`Δ ${delta.toFixed(1)} accelerating down`); }
    else if (delta < -10 && value > 0) { bearPts += 1; reasons.push(`Δ ${delta.toFixed(1)} bull force decelerating`); }
    else if (delta > 10 && value < 0) { bullPts += 1; reasons.push(`Δ +${delta.toFixed(1)} bear force decelerating`); }
  }

  // Divergence is the strongest leading-edge signal
  if (divergence === "bear") { bearPts += 3; reasons.push("Bearish divergence (price up, RFD weaker)"); }
  if (divergence === "bull") { bullPts += 3; reasons.push("Bullish divergence (price down, RFD stronger)"); }

  const net = bullPts - bearPts;
  let verdict: Verdict = "neutral";
  if (net >= 5) verdict = "strong_buy";
  else if (net >= 2) verdict = "buy";
  else if (net <= -5) verdict = "strong_sell";
  else if (net <= -2) verdict = "sell";

  return { verdict, reasons };
}

async function loadAnalysis(symbol: string, tf: Timeframe): Promise<RfdAnalysis | null> {
  try {
    const klines = await fetchKlines(symbol, tf, 200);
    if (klines.length < 50) return null;
    const closes = klines.map((k) => k.close);
    const vols = klines.map((k) => k.volume);

    // Build full RFD time series (replicating the indicator's per-bar formula)
    const fast = 5, slow = 13;
    const force: number[] = new Array(closes.length).fill(0);
    for (let i = 1; i < closes.length; i++) force[i] = (closes[i] - closes[i - 1]) * vols[i];
    const series: number[] = [];
    for (let i = slow; i < closes.length; i++) {
      const fastWin = force.slice(i - fast + 1, i + 1);
      const slowWin = force.slice(i - slow + 1, i + 1);
      const meanFast = fastWin.reduce((s, v) => s + v, 0) / fast;
      const meanSlow = slowWin.reduce((s, v) => s + v, 0) / slow;
      const absMean = slowWin.reduce((s, v) => s + Math.abs(v), 0) / slow;
      const variance = slowWin.reduce((s, v) => s + (Math.abs(v) - absMean) ** 2, 0) / slow;
      const sigma = Math.sqrt(variance);
      const denom = sigma + absMean * 0.5;
      const raw = denom > 0 ? (meanFast - meanSlow) / denom : 0;
      series.push(Math.max(-100, Math.min(100, raw * 35)));
    }
    if (!series.length) return null;

    // Signal line = EMA(9) of RFD — gives us a MACD-style histogram
    const sigEma = ema(series, 9);
    const lastSig = sigEma[sigEma.length - 1] ?? null;
    const lastVal = series[series.length - 1];
    const histVsSignal = lastSig !== null ? lastVal - lastSig : null;

    // Use the canonical rfd() for cross / divergence detection
    const rfdData = rfd(closes, vols, 5, 13);

    const { verdict, reasons } = classify(
      lastVal,
      rfdData.delta,
      rfdData.crossUp,
      rfdData.crossDown,
      rfdData.divergence,
      histVsSignal
    );

    return {
      value: lastVal,
      prev: rfdData.prev,
      delta: rfdData.delta,
      histogram: series.slice(-30),
      crossUp: rfdData.crossUp,
      crossDown: rfdData.crossDown,
      divergence: rfdData.divergence,
      rfdEma: lastSig,
      histVsSignal,
      verdict,
      verdictReasons: reasons,
      price: closes[closes.length - 1],
    };
  } catch {
    return null;
  }
}

const VERDICT_STYLES: Record<Verdict, { label: string; cls: string; icon: typeof TrendingUp; pulse: boolean }> = {
  strong_buy:  { label: "STRONG BUY",  cls: "border-bull/70 bg-bull/20 text-bull shadow-[0_0_10px_hsl(var(--bull)/0.4)]", icon: TrendingUp,   pulse: true },
  buy:         { label: "BUY",         cls: "border-bull/50 bg-bull/15 text-bull",                                        icon: TrendingUp,   pulse: false },
  neutral:     { label: "NEUTRAL",     cls: "border-border bg-surface-elevated text-muted-foreground",                    icon: Minus,        pulse: false },
  sell:        { label: "SELL",        cls: "border-bear/50 bg-bear/15 text-bear",                                        icon: TrendingDown, pulse: false },
  strong_sell: { label: "STRONG SELL", cls: "border-bear/70 bg-bear/20 text-bear shadow-[0_0_10px_hsl(var(--bear)/0.4)]", icon: TrendingDown, pulse: true },
};

export function RfdPanel({ symbol }: Props) {
  const [tf, setTf] = useState<Timeframe>("1h");
  const [data, setData] = useState<RfdAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    loadAnalysis(symbol, tf).then((d) => {
      if (cancelled) return;
      setData(d);
      setLoading(false);
    });
    const id = setInterval(() => {
      loadAnalysis(symbol, tf).then((d) => { if (!cancelled && d) setData(d); });
    }, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol, tf]);

  const verdict = data ? VERDICT_STYLES[data.verdict] : VERDICT_STYLES.neutral;
  const VerdictIcon = verdict.icon;

  // Histogram normalization for sparkline display
  const histMax = data ? Math.max(100, ...data.histogram.map((v) => Math.abs(v))) : 100;

  return (
    <div className="panel flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Activity className="size-3.5 text-accent" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            RFD Analysis
          </h3>
          <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-accent">
            Force
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {symbol.replace("USDT", "/USDT")}
          </span>
          {loading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex overflow-hidden rounded-md border border-border bg-surface-elevated">
          {TIMEFRAMES.map((t) => (
            <button
              key={t}
              onClick={() => setTf(t)}
              className={cn(
                "px-2 py-0.5 font-mono text-[10px] font-semibold uppercase transition-colors",
                tf === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3 scrollbar-thin">
        {!data && !loading && (
          <div className="flex h-full items-center justify-center">
            <span className="font-mono text-xs text-muted-foreground">No data</span>
          </div>
        )}
        {!data && loading && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {data && (
          <>
            {/* Verdict card — like MACD bias card but for RFD */}
            <div className={cn("rounded-md border p-3", verdict.cls, verdict.pulse && "animate-pulse")}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <VerdictIcon className="size-5" />
                  <div className="flex flex-col">
                    <span className="font-mono text-[9px] font-bold uppercase tracking-wider opacity-80">
                      RFD Signal
                    </span>
                    <span className="font-mono text-lg font-bold uppercase tracking-wide">
                      {verdict.label}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[9px] uppercase tracking-wider opacity-70">RFD</div>
                  <div className="font-mono text-2xl font-bold tabular-nums">
                    {data.value >= 0 ? "+" : ""}{data.value.toFixed(0)}
                  </div>
                </div>
              </div>
            </div>

            {/* MACD-style breakdown: RFD line / Signal / Histogram */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Breakdown
                </span>
                <div className="flex items-center gap-1.5">
                  {data.crossUp && (
                    <span className="rounded bg-bull/15 px-1 py-px font-mono text-[8px] font-bold uppercase text-bull">
                      Cross ↑
                    </span>
                  )}
                  {data.crossDown && (
                    <span className="rounded bg-bear/15 px-1 py-px font-mono text-[8px] font-bold uppercase text-bear">
                      Cross ↓
                    </span>
                  )}
                  {data.divergence === "bear" && (
                    <span className="rounded bg-bear/15 px-1 py-px font-mono text-[8px] font-bold uppercase text-bear">
                      Bear Div
                    </span>
                  )}
                  {data.divergence === "bull" && (
                    <span className="rounded bg-bull/15 px-1 py-px font-mono text-[8px] font-bold uppercase text-bull">
                      Bull Div
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
                <div className="rounded border border-border bg-surface-elevated p-2">
                  <div className="text-[9px] uppercase text-muted-foreground">RFD Line</div>
                  <div className={cn("mt-0.5 text-sm font-bold tabular-nums", data.value >= 0 ? "text-bull" : "text-bear")}>
                    {data.value >= 0 ? "+" : ""}{data.value.toFixed(1)}
                  </div>
                </div>
                <div className="rounded border border-border bg-surface-elevated p-2">
                  <div className="text-[9px] uppercase text-muted-foreground">Signal (EMA9)</div>
                  <div className={cn("mt-0.5 text-sm font-bold tabular-nums", (data.rfdEma ?? 0) >= 0 ? "text-bull" : "text-bear")}>
                    {data.rfdEma !== null ? `${data.rfdEma >= 0 ? "+" : ""}${data.rfdEma.toFixed(1)}` : "—"}
                  </div>
                </div>
                <div className="rounded border border-border bg-surface-elevated p-2">
                  <div className="text-[9px] uppercase text-muted-foreground">Histogram</div>
                  <div className={cn("mt-0.5 text-sm font-bold tabular-nums", (data.histVsSignal ?? 0) >= 0 ? "text-bull" : "text-bear")}>
                    {data.histVsSignal !== null ? `${data.histVsSignal >= 0 ? "+" : ""}${data.histVsSignal.toFixed(1)}` : "—"}
                  </div>
                </div>
              </div>
            </div>

            {/* Histogram sparkline — last 30 bars */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Last 30 bars
                </span>
                {data.delta !== null && (
                  <span className={cn(
                    "font-mono text-[10px] tabular-nums",
                    data.delta > 0 ? "text-bull" : data.delta < 0 ? "text-bear" : "text-muted-foreground"
                  )}>
                    Δ {data.delta > 0 ? "+" : ""}{data.delta.toFixed(1)}
                  </span>
                )}
              </div>
              <div className="relative flex h-16 items-center gap-px rounded border border-border bg-surface-elevated/50 px-1">
                <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
                {data.histogram.map((v, i) => {
                  const heightPct = (Math.abs(v) / histMax) * 50;
                  const isPos = v >= 0;
                  return (
                    <div
                      key={i}
                      className="relative flex h-full flex-1 items-center"
                      title={`Bar ${i - data.histogram.length + 1}: RFD ${v.toFixed(1)}`}
                    >
                      <div
                        className={cn(
                          "absolute inset-x-0 rounded-sm",
                          isPos ? "bg-bull/70" : "bg-bear/70",
                          i === data.histogram.length - 1 && "ring-1 ring-foreground/40"
                        )}
                        style={{
                          height: `${heightPct}%`,
                          [isPos ? "bottom" : "top"]: "50%",
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground">
                <span>−100 sell force</span>
                <span>0</span>
                <span>+100 buy force</span>
              </div>
            </div>

            {/* Reasons */}
            <div className="border-t border-border pt-2">
              <div className="mb-1 flex items-center gap-1">
                <Zap className="size-3 text-accent" />
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Why this signal
                </span>
              </div>
              <ul className="space-y-1">
                {data.verdictReasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 font-mono text-[11px]">
                    <span className="mt-1 size-1 shrink-0 rounded-full bg-accent" />
                    <span className="text-foreground/80">{r}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-border pt-2 font-mono text-[10px] text-muted-foreground">
              Price <span className="text-foreground">{formatPrice(data.price)}</span> · auto-refresh 30s · educational, not financial advice
            </div>
          </>
        )}
      </div>
    </div>
  );
}
