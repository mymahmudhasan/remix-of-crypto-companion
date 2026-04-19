import { useEffect, useState, useCallback } from "react";
import { fetchKlines, fetch24h, formatPrice } from "@/lib/binance";
import { rsi } from "@/lib/indicators";
import { Radar, TrendingUp, TrendingDown, Loader2, Target, Shield, Zap, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type Timeframe = "15m" | "1h" | "4h";
const TIMEFRAMES: Timeframe[] = ["15m", "1h", "4h"];
const REFRESH_MS = 5 * 60 * 1000;

interface ReversalSetup {
  symbol: string;
  side: "long" | "short"; // long = bought at low, short = sold at high
  type: "bottom" | "top";
  price: number;
  prevExtreme: number; // previous high or low being broken
  distancePct: number; // how far past the previous extreme (negative = wicked back)
  rsi: number;
  reversalScore: number; // 0-100, higher = better reversal odds
  entryLow: number;
  entryHigh: number;
  stop: number;
  target1: number;
  target2: number;
  rr: number;
  reasons: string[];
}

// Stablecoin / wrapped pairs we don't want in the radar (no real reversal play)
const EXCLUDE_BASES = new Set([
  "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "PYUSD", "EURI", "EUR",
  "GBP", "AUD", "BRL", "TRY", "RUB", "PLN", "ZAR", "ARS", "MXN", "JPY",
]);

async function fetchTopUsdtUniverse(limit = 100): Promise<string[]> {
  const tickers = await fetch24h();
  return tickers
    .filter((t) => {
      if (!t.symbol.endsWith("USDT")) return false;
      const base = t.symbol.slice(0, -4);
      if (EXCLUDE_BASES.has(base)) return false;
      // skip leveraged tokens (UP/DOWN/BULL/BEAR)
      if (/(UP|DOWN|BULL|BEAR)$/.test(base)) return false;
      return true;
    })
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, limit)
    .map((t) => t.symbol);
}

const LOOKBACK = 50; // bars used to define "previous high/low"

async function buildReversalSetup(symbol: string, timeframe: Timeframe): Promise<ReversalSetup | null> {
  try {
    const klines = await fetchKlines(symbol, timeframe, 120);
    if (klines.length < LOOKBACK + 5) return null;

    const closes = klines.map((k) => k.close);
    const highs = klines.map((k) => k.high);
    const lows = klines.map((k) => k.low);
    const last = klines[klines.length - 1];
    const price = last.close;

    // Previous extremes from the LOOKBACK window BEFORE the most recent 2 candles
    const windowEnd = klines.length - 2;
    const windowStart = Math.max(0, windowEnd - LOOKBACK);
    const prevWindowHighs = highs.slice(windowStart, windowEnd);
    const prevWindowLows = lows.slice(windowStart, windowEnd);
    const prevHigh = Math.max(...prevWindowHighs);
    const prevLow = Math.min(...prevWindowLows);

    // Recent extreme of last 2-3 candles
    const recentHigh = Math.max(last.high, klines[klines.length - 2].high);
    const recentLow = Math.min(last.low, klines[klines.length - 2].low);

    // ATR proxy for stops
    const atrSlice = klines.slice(-15);
    const atr = atrSlice.reduce((s, k) => s + (k.high - k.low), 0) / atrSlice.length;

    const rsiArr = rsi(closes, 14);
    const lastRsi = rsiArr[rsiArr.length - 1] ?? 50;

    let setup: ReversalSetup | null = null;

    // Loosened wick/reclaim threshold so more setups surface
    const wickTolerance = 0.992; // close within 0.8% of extreme counts as "wicked back"

    // TOP REVERSAL: recent high broke above previous range AND price wicked back / RSI overbought
    if (recentHigh > prevHigh) {
      const distancePct = ((recentHigh - prevHigh) / prevHigh) * 100;
      const wickedBack = price < recentHigh * wickTolerance;
      const overbought = lastRsi > 65;
      if (wickedBack && (overbought || distancePct > 1)) {
        const reasons: string[] = [];
        reasons.push(`New ${LOOKBACK}h high broken`);
        if (overbought) reasons.push(`RSI ${lastRsi.toFixed(0)} overbought`);
        if (wickedBack) reasons.push("Failed to hold breakout");
        if (distancePct > 2) reasons.push(`+${distancePct.toFixed(1)}% spike`);

        const stop = recentHigh + atr * 0.5;
        const entryLow = price;
        const entryHigh = price + atr * 0.3;
        const target1 = price - atr * 1.5;
        const target2 = price - atr * 3;
        const risk = stop - price;
        const reward = price - target2;
        const rr = risk > 0 ? reward / risk : 0;

        const score = Math.min(
          100,
          40 + (overbought ? 25 : 0) + (wickedBack ? 15 : 0) + Math.min(20, distancePct * 5)
        );

        setup = {
          symbol,
          side: "short",
          type: "top",
          price,
          prevExtreme: prevHigh,
          distancePct,
          rsi: lastRsi,
          reversalScore: score,
          entryLow: Math.min(entryLow, entryHigh),
          entryHigh: Math.max(entryLow, entryHigh),
          stop,
          target1,
          target2,
          rr,
          reasons,
        };
      }
    }

    // BOTTOM REVERSAL: recent low broke below previous range AND price wicked back / RSI oversold
    if (recentLow < prevLow) {
      const distancePct = ((prevLow - recentLow) / prevLow) * 100;
      const wickedBack = price > recentLow * (2 - wickTolerance);
      const oversold = lastRsi < 35;
      if (wickedBack && (oversold || distancePct > 1)) {
        const reasons: string[] = [];
        reasons.push(`New ${LOOKBACK}h low broken`);
        if (oversold) reasons.push(`RSI ${lastRsi.toFixed(0)} oversold`);
        if (wickedBack) reasons.push("Reclaimed lost level");
        if (distancePct > 2) reasons.push(`-${distancePct.toFixed(1)}% flush`);

        const stop = recentLow - atr * 0.5;
        const entryLow = price - atr * 0.3;
        const entryHigh = price;
        const target1 = price + atr * 1.5;
        const target2 = price + atr * 3;
        const risk = price - stop;
        const reward = target2 - price;
        const rr = risk > 0 ? reward / risk : 0;

        const score = Math.min(
          100,
          40 + (oversold ? 25 : 0) + (wickedBack ? 15 : 0) + Math.min(20, distancePct * 5)
        );

        const candidate: ReversalSetup = {
          symbol,
          side: "long",
          type: "bottom",
          price,
          prevExtreme: prevLow,
          distancePct,
          rsi: lastRsi,
          reversalScore: score,
          entryLow: Math.min(entryLow, entryHigh),
          entryHigh: Math.max(entryLow, entryHigh),
          stop,
          target1,
          target2,
          rr,
          reasons,
        };
        // Prefer the stronger setup if both triggered (rare)
        if (!setup || candidate.reversalScore > setup.reversalScore) setup = candidate;
      }
    }

    if (!setup) return null;
    // Require minimum quality (loosened so moderate reversals also surface)
    if (setup.reversalScore < 40 || setup.rr < 1) return null;
    return setup;
  } catch {
    return null;
  }
}

export function ReversalRadar({ onSelect }: { onSelect?: (sym: string) => void }) {
  const [items, setItems] = useState<ReversalSetup[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanned, setScanned] = useState(0);
  const [universeSize, setUniverseSize] = useState(0);
  const [filter, setFilter] = useState<"all" | "bottom" | "top">("all");
  const [timeframe, setTimeframe] = useState<Timeframe>("1h");
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setScanned(0);
    setItems([]);

    (async () => {
      let universe: string[] = [];
      try {
        universe = await fetchTopUsdtUniverse(100);
      } catch {
        universe = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
      }
      if (cancelled) return;
      setUniverseSize(universe.length);

      const results: ReversalSetup[] = [];
      const batchSize = 8;
      for (let i = 0; i < universe.length; i += batchSize) {
        if (cancelled) return;
        const batch = universe.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map((s) => buildReversalSetup(s, timeframe)));
        batchResults.forEach((r) => r && results.push(r));
        if (!cancelled) {
          const sorted = [...results].sort((a, b) => b.reversalScore - a.reversalScore);
          setItems(sorted.slice(0, 12));
          setScanned(Math.min(i + batchSize, universe.length));
        }
      }
      if (!cancelled) {
        setLoading(false);
        setLastUpdated(Date.now());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [timeframe, refreshTick]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const id = setInterval(() => refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const filtered = items.filter((it) => filter === "all" || it.type === filter);

  return (
    <div className="panel flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Radar className="size-3.5 text-warning" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Reversal Radar
          </h3>
          <span className="rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-warning">
            Low Risk
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
                title={`Scan on ${tf} candles`}
              >
                {tf}
              </button>
            ))}
          </div>
          <div className="flex overflow-hidden rounded-md border border-border bg-surface-elevated">
            {(["all", "bottom", "top"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-2 py-0.5 font-mono text-[10px] font-semibold uppercase transition-colors",
                  filter === f
                    ? f === "bottom"
                      ? "bg-bull/20 text-bull"
                      : f === "top"
                        ? "bg-bear/20 text-bear"
                        : "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f === "bottom" ? "Lows" : f === "top" ? "Highs" : "All"}
              </button>
            ))}
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center justify-center rounded-md border border-border bg-surface-elevated p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            title="Refresh scan now"
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-elevated/40 px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
        <span>
          Coins breaking <span className="text-bear">prev high</span> or{" "}
          <span className="text-bull">prev low</span> on {timeframe} with reversal confirmation
        </span>
        {lastUpdated && (
          <span className="text-[9px] whitespace-nowrap">
            Updated {timeAgo(lastUpdated)} · auto 5m
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {filtered.length === 0 && !loading && (
          <div className="flex h-full items-center justify-center px-4 text-center font-mono text-xs text-muted-foreground">
            No high-quality reversal setups right now. Market trending — wait for exhaustion.
          </div>
        )}
        {filtered.map((it) => {
          const isBottom = it.type === "bottom";
          return (
            <button
              key={it.symbol}
              onClick={() => onSelect?.(it.symbol)}
              className="flex w-full flex-col gap-1.5 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase",
                      isBottom ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
                    )}
                  >
                    {isBottom ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
                    {isBottom ? "Buy Dip" : "Fade Top"}
                  </span>
                  <span className="font-mono text-sm font-bold">{it.symbol.replace("USDT", "")}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    ${formatPrice(it.price)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 font-mono text-[10px]">
                    <Zap className="size-2.5 text-warning" />
                    <span
                      className={cn(
                        "font-bold",
                        it.reversalScore >= 70 ? "text-warning" : "text-muted-foreground"
                      )}
                    >
                      {it.reversalScore}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1 font-mono text-[10px]">
                    <span className="text-muted-foreground">R:R</span>
                    <span className={cn("font-bold", it.rr >= 2 ? "text-bull" : "text-warning")}>
                      {it.rr.toFixed(1)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1 font-mono text-[10px]">
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">
                    {isBottom ? "Prev Low" : "Prev High"}
                  </span>
                  <span className="text-foreground">{formatPrice(it.prevExtreme)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">RSI</span>
                  <span
                    className={cn(
                      "font-bold",
                      it.rsi < 35 ? "text-bull" : it.rsi > 65 ? "text-bear" : "text-foreground"
                    )}
                  >
                    {it.rsi.toFixed(0)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-1 rounded border border-border bg-surface-elevated/60 px-1.5 py-1 font-mono text-[10px]">
                <div className="flex flex-col">
                  <span className="text-[9px] uppercase text-muted-foreground">Entry</span>
                  <span className="text-foreground">
                    {formatPrice(it.entryLow)}–{formatPrice(it.entryHigh)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] uppercase text-muted-foreground">
                    <Shield className="inline size-2.5 text-bear" /> Stop
                  </span>
                  <span className="text-bear">{formatPrice(it.stop)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] uppercase text-muted-foreground">
                    <Target className="inline size-2.5 text-bull" /> TP1
                  </span>
                  <span className="text-bull">{formatPrice(it.target1)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] uppercase text-muted-foreground">
                    <Target className="inline size-2.5 text-bull" /> TP2
                  </span>
                  <span className="text-bull">{formatPrice(it.target2)}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                {it.reasons.map((r, i) => (
                  <span
                    key={i}
                    className="rounded border border-border bg-surface-elevated px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
                  >
                    {r}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <div className="border-t border-border bg-surface-elevated/40 px-3 py-1.5 font-mono text-[9px] leading-tight text-muted-foreground">
        ⚡ Risk only 1–2% per trade · Stop just beyond the broken extreme · Take partials at TP1
      </div>
    </div>
  );
}
