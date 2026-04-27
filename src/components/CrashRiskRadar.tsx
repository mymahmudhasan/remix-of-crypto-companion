import { Fragment, useEffect, useState, useCallback } from "react";
import { fetchKlines, fetch24h, formatPrice, formatCompact } from "@/lib/binance";
import { rsi, ema, rfd } from "@/lib/indicators";
import { AlertTriangle, Loader2, RefreshCw, Skull, TrendingDown, TrendingUp, ChevronDown, Target, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

interface CrashTradeSetup {
  side: "short" | "long";
  entry: number;
  entryLow: number;
  entryHigh: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskPct: number;
  rr1: number;
  rr2: number;
  rr3: number;
  atr: number;
  rationale: string;
}

function buildCrashSetup(
  price: number,
  atrAbs: number,
  tier: "extreme" | "high" | "elevated",
  distFromHighPct: number,
  rsiVal: number,
): CrashTradeSetup {
  const a = atrAbs > 0 ? atrAbs : price * 0.01;
  // Already broken down hard + oversold → capitulation long (mean-reversion bounce)
  const capitulation = distFromHighPct < -18 && rsiVal < 35;
  const side: "short" | "long" = capitulation ? "long" : "short";

  let entry: number, stop: number, tp1: number, tp2: number, tp3: number, rationale: string;

  if (side === "short") {
    // Fade strength — entry slightly above current on a retest, stop above swing/ATR buffer.
    // Tier scales aggression: extreme → tighter stop, larger targets.
    const stopMult = tier === "extreme" ? 1.4 : tier === "high" ? 1.7 : 2.0;
    const tp1Mult = tier === "extreme" ? 1.5 : 1.2;
    const tp2Mult = tier === "extreme" ? 3.0 : 2.4;
    const tp3Mult = tier === "extreme" ? 5.0 : 4.0;
    entry = price + a * 0.2;
    stop = price + a * stopMult;
    tp1 = entry - a * tp1Mult;
    tp2 = entry - a * tp2Mult;
    tp3 = entry - a * tp3Mult;
    rationale =
      tier === "extreme"
        ? "Distribution fade — ride the crash; trail stop aggressively below LH"
        : "Short into bounce/retest — bearish structure + sell volume dominance";
  } else {
    // Capitulation bounce long — entry above current confirmation, tight stop below low.
    entry = price + a * 0.15;
    stop = price - a * 1.2;
    tp1 = entry + a * 1.2;
    tp2 = entry + a * 2.4;
    tp3 = entry + a * 3.8;
    rationale = "Capitulation bounce — already off highs + oversold RSI = mean-reversion long";
  }

  const entryLow = side === "short" ? entry : Math.min(entry, entry - a * 0.15);
  const entryHigh = side === "short" ? entry + a * 0.2 : entry;
  const risk = Math.abs(entry - stop);
  const riskPct = (risk / entry) * 100;
  const rr1 = Math.abs(tp1 - entry) / risk;
  const rr2 = Math.abs(tp2 - entry) / risk;
  const rr3 = Math.abs(tp3 - entry) / risk;

  return { side, entry, entryLow, entryHigh, stop, tp1, tp2, tp3, riskPct, rr1, rr2, rr3, atr: a, rationale };
}

type Timeframe = "15m" | "1h" | "4h";
const TIMEFRAMES: Timeframe[] = ["15m", "1h", "4h"];
const REFRESH_MS = 5 * 60 * 1000;

interface CrashRisk {
  symbol: string;
  price: number;
  change24h: number;
  riskScore: number; // 0-100
  tier: "extreme" | "high" | "elevated";
  rsi: number;
  atrPct: number;
  atrAbs: number;
  distFromHighPct: number; // distance below 50-bar high (negative if recent ATH break)
  volRatio: number; // last bar vs 20-bar avg
  bearishVolRatio: number; // last 5 bears vs 5 bulls volume
  consecBears: number;
  reasons: string[];
  quoteVol: number;
  setup: CrashTradeSetup;
}

const STABLE_EXCLUDE = new Set([
  "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "PYUSD", "EURI", "EUR",
  "GBP", "AUD", "BRL", "TRY", "RUB", "PLN", "ZAR", "ARS", "MXN", "JPY",
]);

async function fetchCrashUniverse(limit: number): Promise<{ symbol: string; quoteVol: number; change24h: number }[]> {
  const tickers = await fetch24h();
  return tickers
    .filter((t) => {
      if (!t.symbol.endsWith("USDT")) return false;
      const base = t.symbol.slice(0, -4);
      if (STABLE_EXCLUDE.has(base)) return false;
      if (/(UP|DOWN|BULL|BEAR)$/.test(base)) return false;
      return true;
    })
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, limit)
    .map((t) => ({
      symbol: t.symbol,
      quoteVol: parseFloat(t.quoteVolume),
      change24h: parseFloat(t.priceChangePercent),
    }));
}

async function evalCrashRisk(
  symbol: string,
  timeframe: Timeframe,
  change24h: number,
  quoteVol: number
): Promise<CrashRisk | null> {
  try {
    const klines = await fetchKlines(symbol, timeframe, 120);
    if (klines.length < 60) return null;

    const closes = klines.map((k) => k.close);
    const highs = klines.map((k) => k.high);
    const lows = klines.map((k) => k.low);
    const vols = klines.map((k) => k.volume);
    const last = klines[klines.length - 1];
    const price = last.close;

    // 50-bar swing high — used for distance + breakdown detection
    const recentHigh = Math.max(...highs.slice(-50));
    const distFromHighPct = ((price - recentHigh) / recentHigh) * 100; // negative

    // ATR % (volatility)
    const atrSlice = klines.slice(-15);
    const atr = atrSlice.reduce((s, k) => s + (k.high - k.low), 0) / atrSlice.length;
    const atrPct = (atr / price) * 100;

    // RSI + EMA trend
    const rsiArr = rsi(closes, 14);
    const lastRsi = rsiArr[rsiArr.length - 1] ?? 50;
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const e20 = ema20[ema20.length - 1] ?? price;
    const e50 = ema50[ema50.length - 1] ?? price;
    const e20Prev = ema20[ema20.length - 6] ?? e20;
    const emaSlope = ((e20 - e20Prev) / e20Prev) * 100; // % over last 5 bars

    // Volume confirmation
    const volAvg = vols.slice(-21, -1).reduce((s, v) => s + v, 0) / 20;
    const volRatio = volAvg > 0 ? last.volume / volAvg : 1;

    // Bearish vs bullish volume in last 10 bars
    const last10 = klines.slice(-10);
    let bearVol = 0, bullVol = 0, consecBears = 0;
    for (let i = last10.length - 1; i >= 0; i--) {
      if (last10[i].close < last10[i].open) {
        bearVol += last10[i].volume;
        if (i === last10.length - 1 || consecBears === last10.length - 1 - i) consecBears++;
      } else {
        bullVol += last10[i].volume;
      }
    }
    const bearishVolRatio = bullVol > 0 ? bearVol / bullVol : bearVol > 0 ? 3 : 1;

    // === Risk scoring ===
    let score = 0;
    const reasons: string[] = [];

    // 1. Overextended → mean reversion risk
    if (lastRsi > 78) { score += 22; reasons.push(`RSI ${lastRsi.toFixed(0)} extreme`); }
    else if (lastRsi > 72) { score += 14; reasons.push(`RSI ${lastRsi.toFixed(0)} overbought`); }

    // 2. 24h pump exhaustion (parabolic comes down hard)
    if (change24h > 25) { score += 22; reasons.push(`+${change24h.toFixed(0)}% 24h parabolic`); }
    else if (change24h > 12) { score += 12; reasons.push(`+${change24h.toFixed(0)}% 24h pump`); }

    // 3. Active breakdown — already losing structure
    if (price < e20 && e20 < e50 && emaSlope < -0.4) {
      score += 18; reasons.push("Bearish EMA stack");
    } else if (price < e20 && emaSlope < -0.2) {
      score += 10; reasons.push("Below EMA20, rolling over");
    }

    // 4. Heavy distribution (sellers in control)
    if (bearishVolRatio > 2.2 && volRatio > 1.3) {
      score += 16; reasons.push(`Sell vol ${bearishVolRatio.toFixed(1)}× buy`);
    } else if (bearishVolRatio > 1.6) {
      score += 8; reasons.push("Distribution volume");
    }

    // 5. Consecutive red candles
    if (consecBears >= 4) { score += 10; reasons.push(`${consecBears} red bars`); }
    else if (consecBears >= 3) { score += 5; reasons.push(`${consecBears} red bars`); }

    // 6. High volatility = wider crash potential
    if (atrPct > 5) { score += 8; reasons.push(`ATR ${atrPct.toFixed(1)}% high vol`); }
    else if (atrPct > 3) { score += 4; }

    // 7. Distance from high — already broken
    if (distFromHighPct < -8 && distFromHighPct > -25) {
      score += 6; reasons.push(`${distFromHighPct.toFixed(0)}% off high`);
    }

    // 8. Bearish hammer/marubozu on last bar with vol
    const range = Math.max(1e-9, last.high - last.low);
    const body = Math.abs(last.close - last.open);
    const upperWick = last.high - Math.max(last.close, last.open);
    if (last.close < last.open && body / range > 0.7 && volRatio > 1.4) {
      score += 8; reasons.push("Bearish marubozu + vol");
    } else if (upperWick > body * 1.5 && upperWick > range * 0.45 && volRatio > 1.2) {
      score += 8; reasons.push("Rejection wick + vol");
    }

    // 9. RFD — acceleration of bearish force is the strongest leading-edge crash signal
    const rfdData = rfd(closes, vols, 5, 13);
    if (rfdData.value !== null) {
      if (rfdData.value < -60) {
        score += 18; reasons.push(`RFD ${rfdData.value.toFixed(0)} explosive sell force`);
      } else if (rfdData.value < -25) {
        score += 10; reasons.push(`RFD ${rfdData.value.toFixed(0)} bear force expanding`);
      }
      if (rfdData.crossDown) {
        score += 10; reasons.push("RFD flipped negative (force regime change)");
      }
      if (rfdData.divergence === "bear") {
        score += 14; reasons.push("RFD bear divergence (price up, force fading)");
      }
    }

    score = Math.min(100, score);
    if (score < 45) return null;

    let tier: CrashRisk["tier"];
    if (score >= 75) tier = "extreme";
    else if (score >= 60) tier = "high";
    else tier = "elevated";

    const setup = buildCrashSetup(price, atr, tier, distFromHighPct, lastRsi);
    return {
      symbol, price, change24h, riskScore: score, tier,
      rsi: lastRsi, atrPct, atrAbs: atr, distFromHighPct, volRatio, bearishVolRatio, consecBears,
      reasons: reasons.slice(0, 4),
      quoteVol,
      setup,
    };
  } catch {
    return null;
  }
}

const TIER_STYLES: Record<CrashRisk["tier"], { label: string; emoji: string; cls: string; pulse: boolean }> = {
  extreme:  { label: "EXTREME",  emoji: "☠",  cls: "border-bear/70 bg-bear/20 text-bear shadow-[0_0_8px_hsl(var(--bear)/0.5)]", pulse: true },
  high:     { label: "HIGH",     emoji: "🔥", cls: "border-bear/50 bg-bear/15 text-bear", pulse: false },
  elevated: { label: "ELEVATED", emoji: "⚠", cls: "border-warning/50 bg-warning/15 text-warning", pulse: false },
};

export function CrashRiskRadar({ onSelect }: { onSelect?: (sym: string) => void }) {
  const [items, setItems] = useState<CrashRisk[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanned, setScanned] = useState(0);
  const [universeSize, setUniverseSize] = useState(0);
  const [timeframe, setTimeframe] = useState<Timeframe>("1h");
  const [tierFilter, setTierFilter] = useState<"all" | CrashRisk["tier"]>("all");
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (sym: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym); else next.add(sym);
      return next;
    });
  };

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setScanned(0);
    setItems([]);

    (async () => {
      let universe: { symbol: string; quoteVol: number; change24h: number }[] = [];
      try {
        universe = await fetchCrashUniverse(80);
      } catch {
        universe = [];
      }
      if (cancelled) return;
      setUniverseSize(universe.length);

      const results: CrashRisk[] = [];
      const batchSize = 8;
      for (let i = 0; i < universe.length; i += batchSize) {
        if (cancelled) return;
        const batch = universe.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map((u) => evalCrashRisk(u.symbol, timeframe, u.change24h, u.quoteVol))
        );
        batchResults.forEach((r) => r && results.push(r));
        if (!cancelled) {
          const sorted = [...results].sort((a, b) => b.riskScore - a.riskScore);
          setItems(sorted.slice(0, 15));
          setScanned(Math.min(i + batchSize, universe.length));
        }
      }
      if (!cancelled) {
        setLoading(false);
        setLastUpdated(Date.now());
      }
    })();

    return () => { cancelled = true; };
  }, [timeframe, refreshTick]);

  useEffect(() => {
    const id = setInterval(() => refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const filtered = items.filter((it) => tierFilter === "all" || it.tier === tierFilter);
  const counts = {
    extreme: items.filter((i) => i.tier === "extreme").length,
    high: items.filter((i) => i.tier === "high").length,
    elevated: items.filter((i) => i.tier === "elevated").length,
  };

  return (
    <div className="panel flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Skull className="size-3.5 text-bear" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Crash Risk Radar
          </h3>
          <span className="rounded bg-bear/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-bear">
            Downside
          </span>
          {loading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
          {universeSize > 0 && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {loading ? `${scanned}/${universeSize}` : `${universeSize} pairs`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex overflow-hidden rounded-md border border-border bg-surface-elevated">
            {(["all", "extreme", "high", "elevated"] as const).map((t) => {
              const active = tierFilter === t;
              const lbl = t === "all" ? "All" : TIER_STYLES[t as CrashRisk["tier"]].label;
              const cnt = t === "all" ? items.length : counts[t as CrashRisk["tier"]];
              const activeCls =
                t === "extreme" ? "bg-bear/30 text-bear"
                : t === "high" ? "bg-bear/20 text-bear"
                : t === "elevated" ? "bg-warning/20 text-warning"
                : "bg-primary text-primary-foreground";
              return (
                <button
                  key={t}
                  onClick={() => setTierFilter(t)}
                  className={cn(
                    "px-2 py-0.5 font-mono text-[10px] font-semibold uppercase transition-colors",
                    active ? activeCls : "text-muted-foreground hover:text-foreground"
                  )}
                  title={`Filter ${lbl}`}
                >
                  {lbl}
                  {cnt > 0 && <span className="ml-1 opacity-70">{cnt}</span>}
                </button>
              );
            })}
          </div>
          <div className="flex overflow-hidden rounded-md border border-border bg-surface-elevated">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={cn(
                  "px-2 py-0.5 font-mono text-[10px] font-semibold uppercase transition-colors",
                  timeframe === tf
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tf}
              </button>
            ))}
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center justify-center rounded-md border border-border bg-surface-elevated p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            title="Rescan now"
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {filtered.length === 0 && !loading && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <AlertTriangle className="size-6 text-muted-foreground/50" />
            <p className="font-mono text-xs text-muted-foreground">
              No tokens flagged for crash risk on {timeframe}
            </p>
            <p className="font-mono text-[10px] text-muted-foreground/70">
              Market structure looks stable — try a different timeframe
            </p>
          </div>
        )}
        {filtered.length === 0 && loading && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <ul className="divide-y divide-border">
          {filtered.map((it) => {
            const tier = TIER_STYLES[it.tier];
            const isOpen = expanded.has(it.symbol);
            const sd = it.setup;
            const sideColor = sd.side === "short"
              ? "text-bear bg-bear/15 border-bear/30"
              : "text-bull bg-bull/15 border-bull/30";
            return (
              <Fragment key={it.symbol}>
                <li
                  className="cursor-pointer px-3 py-2 transition-colors hover:bg-surface-elevated/60"
                  onClick={() => toggleExpand(it.symbol)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <ChevronDown className={cn("size-3 shrink-0 text-muted-foreground transition-transform", isOpen ? "rotate-0" : "-rotate-90")} />
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded border px-1.5 py-[1px] font-mono text-[9px] font-bold uppercase tracking-wider whitespace-nowrap",
                          tier.cls,
                          tier.pulse && "animate-pulse"
                        )}
                        title={`Risk score: ${it.riskScore}/100`}
                      >
                        <span className="leading-none">{tier.emoji}</span>
                        {tier.label}
                      </span>
                      <span className="truncate font-mono text-sm font-semibold text-foreground">
                        {it.symbol.replace("USDT", "")}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {formatPrice(it.price)}
                      </span>
                      <span
                        className={cn(
                          "font-mono text-[10px] tabular-nums",
                          it.change24h >= 0 ? "text-bull" : "text-bear"
                        )}
                      >
                        {it.change24h >= 0 ? "+" : ""}{it.change24h.toFixed(1)}%
                      </span>
                      <span
                        className={cn(
                          "ml-1 inline-flex items-center gap-1 rounded border px-1.5 py-[1px] font-mono text-[9px] font-bold uppercase tracking-wider whitespace-nowrap",
                          sideColor
                        )}
                        title={`Suggested trade setup · R:R up to ${sd.rr3.toFixed(1)}`}
                      >
                        {sd.side === "short" ? <TrendingDown className="size-2.5" /> : <TrendingUp className="size-2.5" />}
                        {sd.side} · {sd.rr2.toFixed(1)}R
                      </span>
                    </div>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <div
                        className="h-1.5 w-16 overflow-hidden rounded bg-surface-elevated"
                        title={`Risk ${it.riskScore}/100`}
                      >
                        <div
                          className={cn(
                            "h-full",
                            it.tier === "extreme" ? "bg-bear" : it.tier === "high" ? "bg-bear/70" : "bg-warning"
                          )}
                          style={{ width: `${it.riskScore}%` }}
                        />
                      </div>
                      <span className="font-mono text-[10px] font-bold tabular-nums text-foreground">
                        {it.riskScore}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-1">
                    {it.reasons.map((r, idx) => (
                      <span
                        key={idx}
                        className="font-mono text-[9.5px] text-muted-foreground"
                      >
                        • {r}
                      </span>
                    ))}
                    <span className="ml-auto font-mono text-[9px] text-muted-foreground/70">
                      Vol {formatCompact(it.quoteVol)}
                    </span>
                  </div>
                </li>
                {isOpen && (
                  <li className="bg-surface-elevated/40 px-4 py-3">
                    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider", sideColor)}>
                            {sd.side === "short" ? <TrendingDown className="size-3" /> : <TrendingUp className="size-3" />}
                            {sd.side === "short" ? "SHORT" : "LONG"}
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground">{sd.rationale}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] sm:grid-cols-3">
                          <SetupField label="Entry zone" value={`${formatPrice(sd.entryLow)} – ${formatPrice(sd.entryHigh)}`} />
                          <SetupField label="Stop loss" value={formatPrice(sd.stop)} valueClass="text-bear" icon={<Shield className="size-3 text-bear" />} />
                          <SetupField label="Risk" value={`${sd.riskPct.toFixed(2)}%`} valueClass="text-warning" />
                          <SetupField label="TP1" value={formatPrice(sd.tp1)} valueClass={sd.side === "short" ? "text-bull" : "text-bull"} icon={<Target className="size-3 text-bull" />} extra={`${sd.rr1.toFixed(2)}R`} />
                          <SetupField label="TP2" value={formatPrice(sd.tp2)} valueClass="text-bull" icon={<Target className="size-3 text-bull" />} extra={`${sd.rr2.toFixed(2)}R`} />
                          <SetupField label="TP3" value={formatPrice(sd.tp3)} valueClass="text-bull" icon={<Target className="size-3 text-bull" />} extra={`${sd.rr3.toFixed(2)}R`} />
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          ATR(14): {formatPrice(sd.atr)} · Reward potential up to <span className="font-bold text-bull">{sd.rr3.toFixed(1)}× risk</span> if TP3 hits.
                        </div>
                      </div>
                      <div className="flex items-end justify-end">
                        <button
                          onClick={(e) => { e.stopPropagation(); onSelect?.(it.symbol); }}
                          className="rounded border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary hover:bg-primary/20"
                        >
                          Open chart →
                        </button>
                      </div>
                    </div>
                  </li>
                )}
              </Fragment>
            );
          })}
        </ul>
      </div>

      {lastUpdated && (
        <div className="border-t border-border px-3 py-1 font-mono text-[9px] text-muted-foreground">
          Updated {new Date(lastUpdated).toLocaleTimeString()} · auto-refresh 5m · click row to load chart
        </div>
      )}
    </div>
  );
}
