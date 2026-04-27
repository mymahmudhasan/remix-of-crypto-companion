import { useEffect, useState, useCallback } from "react";
import { fetchKlines, fetch24h, formatPrice } from "@/lib/binance";
import { rsi, ema, rfd } from "@/lib/indicators";
import { Radar, TrendingUp, TrendingDown, Loader2, Target, Shield, Zap, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type Timeframe = "15m" | "1h" | "4h";
const TIMEFRAMES: Timeframe[] = ["15m", "1h", "4h"];
const REFRESH_MS = 5 * 60 * 1000;

type Risk = "conservative" | "balanced" | "aggressive";
const RISK_LEVELS: Risk[] = ["conservative", "balanced", "aggressive"];

interface RiskProfile {
  /** Max acceptable ATR% per timeframe */
  atrCap: Record<Timeframe, number>;
  /** Max acceptable single-bar move % per timeframe */
  barMoveCap: Record<Timeframe, number>;
  /** Max 20-bar range % per timeframe */
  rangeCap: Record<Timeframe, number>;
  /** Exclude meme/micro-cap tokens */
  excludeMemes: boolean;
  /** Min reversal score to display */
  minScore: number;
  /** Min risk:reward */
  minRR: number;
}

const RISK_PROFILES: Record<Risk, RiskProfile> = {
  conservative: {
    atrCap:     { "15m": 1.0, "1h": 2.5, "4h": 5 },
    barMoveCap: { "15m": 2.5, "1h": 5,   "4h": 9 },
    rangeCap:   { "15m": 6,   "1h": 14,  "4h": 28 },
    excludeMemes: true,
    minScore: 70,
    minRR: 2.0,
  },
  balanced: {
    atrCap:     { "15m": 1.5, "1h": 3.5, "4h": 7 },
    barMoveCap: { "15m": 4,   "1h": 7,   "4h": 12 },
    rangeCap:   { "15m": 8,   "1h": 18,  "4h": 35 },
    excludeMemes: true,
    minScore: 60,
    minRR: 1.8,
  },
  aggressive: {
    atrCap:     { "15m": 3,   "1h": 6,   "4h": 12 },
    barMoveCap: { "15m": 8,   "1h": 14,  "4h": 22 },
    rangeCap:   { "15m": 15,  "1h": 30,  "4h": 60 },
    excludeMemes: false,
    minScore: 45,
    minRR: 1.3,
  },
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

interface ReversalSetup {
  symbol: string;
  side: "long" | "short"; // long = bought at low, short = sold at high
  type: "bottom" | "top";
  price: number;
  prevExtreme: number; // previous high or low being broken
  distancePct: number; // how far past the previous extreme (negative = wicked back)
  rsi: number;
  atrPct: number; // ATR as % of price — volatility gauge
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
// Always-excluded: stables, fiat, leveraged tokens
const ALWAYS_EXCLUDE = new Set([
  "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "PYUSD", "EURI", "EUR",
  "GBP", "AUD", "BRL", "TRY", "RUB", "PLN", "ZAR", "ARS", "MXN", "JPY",
]);

// High-volatility meme / micro-cap pumps — excluded only in conservative/balanced
const MEME_BASES = new Set([
  "PEPE", "SHIB", "FLOKI", "BONK", "WIF", "MEME", "PNUT", "GOAT", "ACT",
  "NEIRO", "TURBO", "BOME", "MOG", "POPCAT", "BRETT", "MEW", "PONKE",
  "TRUMP", "MELANIA", "FARTCOIN", "CHILLGUY", "MOODENG", "PEOPLE",
]);

async function fetchTopUsdtUniverse(limit: number, excludeMemes: boolean): Promise<string[]> {
  const tickers = await fetch24h();
  return tickers
    .filter((t) => {
      if (!t.symbol.endsWith("USDT")) return false;
      const base = t.symbol.slice(0, -4);
      if (ALWAYS_EXCLUDE.has(base)) return false;
      if (excludeMemes && MEME_BASES.has(base)) return false;
      // skip leveraged tokens (UP/DOWN/BULL/BEAR)
      if (/(UP|DOWN|BULL|BEAR)$/.test(base)) return false;
      return true;
    })
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, limit)
    .map((t) => t.symbol);
}

const LOOKBACK = 50; // bars used to define "previous high/low"

async function buildReversalSetup(symbol: string, timeframe: Timeframe, profile: RiskProfile): Promise<ReversalSetup | null> {
  try {
    const klines = await fetchKlines(symbol, timeframe, 120);
    if (klines.length < LOOKBACK + 5) return null;

    const closes = klines.map((k) => k.close);
    const highs = klines.map((k) => k.high);
    const lows = klines.map((k) => k.low);
    const vols = klines.map((k) => k.volume);
    const last = klines[klines.length - 1];
    const prev = klines[klines.length - 2];
    const price = last.close;

    // Previous extremes from the LOOKBACK window BEFORE the most recent 2 candles
    const windowEnd = klines.length - 2;
    const windowStart = Math.max(0, windowEnd - LOOKBACK);
    const prevWindowHighs = highs.slice(windowStart, windowEnd);
    const prevWindowLows = lows.slice(windowStart, windowEnd);
    const prevHigh = Math.max(...prevWindowHighs);
    const prevLow = Math.min(...prevWindowLows);

    // Recent extreme of last 2 candles
    const recentHigh = Math.max(last.high, prev.high);
    const recentLow = Math.min(last.low, prev.low);

    // ATR proxy for stops
    const atrSlice = klines.slice(-15);
    const atr = atrSlice.reduce((s, k) => s + (k.high - k.low), 0) / atrSlice.length;
    const atrPct = (atr / price) * 100;

    // VOLATILITY GATE — reject erratic/high-flux pairs (per risk profile)
    if (atrPct > profile.atrCap[timeframe]) return null;

    // Reject bars with extreme single-candle moves (pump/dump, not reversal)
    const lastBarMovePct = (Math.abs(last.close - last.open) / last.open) * 100;
    if (lastBarMovePct > profile.barMoveCap[timeframe]) return null;

    // Reject choppy ranges (no clear trend structure → whipsaw risk)
    const recentRangePct = ((Math.max(...highs.slice(-20)) - Math.min(...lows.slice(-20))) / price) * 100;
    if (recentRangePct > profile.rangeCap[timeframe]) return null;

    const rsiArr = rsi(closes, 14);
    const lastRsi = rsiArr[rsiArr.length - 1] ?? 50;
    const prevRsi = rsiArr[rsiArr.length - 2] ?? 50;

    // Trend filter (higher-timeframe context via EMA50)
    const ema50Arr = ema(closes, 50);
    const ema50 = ema50Arr[ema50Arr.length - 1] ?? price;

    // Volume confirmation
    const volAvg = vols.slice(-21, -1).reduce((s, v) => s + v, 0) / 20;
    const volRatio = volAvg > 0 ? last.volume / volAvg : 1;

    // RFD — acceleration of volume-weighted force. For top reversals we want
    // bearish divergence (price up, RFD fading); for bottom reversals the mirror.
    const rfdData = rfd(closes, vols, 5, 13);

    // Candle structure
    const range = Math.max(1e-9, last.high - last.low);
    const body = Math.abs(last.close - last.open);
    const upperWick = last.high - Math.max(last.close, last.open);
    const lowerWick = Math.min(last.close, last.open) - last.low;
    const bullCandle = last.close > last.open;
    const bearCandle = last.close < last.open;

    let setup: ReversalSetup | null = null;

    // Stricter wick: close must reclaim ≥40% of the breakout extension
    const wickTolerance = 0.985; // 1.5% reclaim from extreme

    // TOP REVERSAL: stricter — needs overbought + reclaim + bearish candle + volume + counter-trend OR exhaustion
    if (recentHigh > prevHigh) {
      const distancePct = ((recentHigh - prevHigh) / prevHigh) * 100;
      const wickedBack = price < recentHigh * wickTolerance;
      const overbought = lastRsi > 70;
      const rsiRolling = lastRsi < prevRsi - 2; // momentum fading
      const upperWickStrong = upperWick > body * 1.2 && upperWick > range * 0.4;
      const volumeOk = volRatio > 1.2;
      const bearishConfirm = bearCandle || upperWickStrong;

      // Require: reclaim + (overbought OR strong upper wick) + bearish confirmation + volume
      if (wickedBack && bearishConfirm && volumeOk && (overbought || upperWickStrong) && rsiRolling) {
        const reasons: string[] = [];
        reasons.push(`Broke ${LOOKBACK}-bar high`);
        if (overbought) reasons.push(`RSI ${lastRsi.toFixed(0)} overbought`);
        if (upperWickStrong) reasons.push("Long upper wick (rejection)");
        reasons.push(`Vol ${volRatio.toFixed(1)}× avg`);
        if (rsiRolling) reasons.push("RSI rolling over");
        if (distancePct > 2) reasons.push(`+${distancePct.toFixed(1)}% spike`);

        // RFD bias for top reversals: bear divergence or fading positive force
        const rfdTopBonus =
          rfdData.divergence === "bear" ? 14 :
          (rfdData.value !== null && rfdData.value < 0 && rfdData.crossDown) ? 10 :
          (rfdData.value !== null && rfdData.value < 25 && (rfdData.delta ?? 0) < -5) ? 6 : 0;
        if (rfdTopBonus >= 14) reasons.push("RFD bear divergence");
        else if (rfdTopBonus >= 10) reasons.push("RFD flipped negative");
        else if (rfdTopBonus >= 6) reasons.push("RFD force fading");

        const stop = recentHigh + atr * 0.5;
        const entryLow = price - atr * 0.1;
        const entryHigh = price + atr * 0.3;
        const target1 = price - atr * 1.8;
        const target2 = price - atr * 3.5;
        const risk = stop - price;
        const reward = price - target2;
        const rr = risk > 0 ? reward / risk : 0;

        const score = Math.min(
          100,
          35 +
            (overbought ? 20 : 0) +
            (upperWickStrong ? 15 : 0) +
            (volRatio > 1.8 ? 12 : volRatio > 1.2 ? 6 : 0) +
            (rsiRolling ? 8 : 0) +
            Math.min(15, distancePct * 4) +
            rfdTopBonus
        );

        setup = {
          symbol, side: "short", type: "top", price,
          prevExtreme: prevHigh, distancePct, rsi: lastRsi, atrPct, reversalScore: score,
          entryLow: Math.min(entryLow, entryHigh),
          entryHigh: Math.max(entryLow, entryHigh),
          stop, target1, target2, rr, reasons,
        };
      }
    }

    // BOTTOM REVERSAL: stricter mirror
    if (recentLow < prevLow) {
      const distancePct = ((prevLow - recentLow) / prevLow) * 100;
      const wickedBack = price > recentLow * (2 - wickTolerance);
      const oversold = lastRsi < 30;
      const rsiRising = lastRsi > prevRsi + 2;
      const lowerWickStrong = lowerWick > body * 1.2 && lowerWick > range * 0.4;
      const volumeOk = volRatio > 1.2;
      const bullishConfirm = bullCandle || lowerWickStrong;

      if (wickedBack && bullishConfirm && volumeOk && (oversold || lowerWickStrong) && rsiRising) {
        const reasons: string[] = [];
        reasons.push(`Broke ${LOOKBACK}-bar low`);
        if (oversold) reasons.push(`RSI ${lastRsi.toFixed(0)} oversold`);
        if (lowerWickStrong) reasons.push("Long lower wick (rejection)");
        reasons.push(`Vol ${volRatio.toFixed(1)}× avg`);
        if (rsiRising) reasons.push("RSI turning up");
        if (distancePct > 2) reasons.push(`-${distancePct.toFixed(1)}% flush`);

        const stop = recentLow - atr * 0.5;
        const entryLow = price - atr * 0.3;
        const entryHigh = price + atr * 0.1;
        const target1 = price + atr * 1.8;
        const target2 = price + atr * 3.5;
        const risk = price - stop;
        const reward = target2 - price;
        const rr = risk > 0 ? reward / risk : 0;

        const score = Math.min(
          100,
          35 +
            (oversold ? 20 : 0) +
            (lowerWickStrong ? 15 : 0) +
            (volRatio > 1.8 ? 12 : volRatio > 1.2 ? 6 : 0) +
            (rsiRising ? 8 : 0) +
            Math.min(15, distancePct * 4)
        );

        const candidate: ReversalSetup = {
          symbol, side: "long", type: "bottom", price,
          prevExtreme: prevLow, distancePct, rsi: lastRsi, atrPct, reversalScore: score,
          entryLow: Math.min(entryLow, entryHigh),
          entryHigh: Math.max(entryLow, entryHigh),
          stop, target1, target2, rr, reasons,
        };
        if (!setup || candidate.reversalScore > setup.reversalScore) setup = candidate;
      }
    }

    if (!setup) return null;
    // Quality gates per profile
    const stopDistPct = (Math.abs(setup.price - setup.stop) / setup.price) * 100;
    if (setup.reversalScore < profile.minScore) return null;
    if (setup.rr < profile.minRR) return null;
    if (stopDistPct < 0.3 || stopDistPct > 8) return null;
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
  const [risk, setRisk] = useState<Risk>("balanced");
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    const profile = RISK_PROFILES[risk];
    setLoading(true);
    setScanned(0);
    setItems([]);

    (async () => {
      let universe: string[] = [];
      try {
        universe = await fetchTopUsdtUniverse(100, profile.excludeMemes);
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
        const batchResults = await Promise.all(batch.map((s) => buildReversalSetup(s, timeframe, profile)));
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
  }, [timeframe, risk, refreshTick]);

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
          <div className="flex overflow-hidden rounded-md border border-border bg-surface-elevated" title="Risk profile — controls volatility caps and meme exclusion">
            {RISK_LEVELS.map((r) => {
              const short = r === "conservative" ? "Safe" : r === "balanced" ? "Bal" : "Pro";
              const activeCls =
                r === "conservative" ? "bg-bull/25 text-bull"
                : r === "balanced" ? "bg-primary text-primary-foreground"
                : "bg-warning/25 text-warning";
              return (
                <button
                  key={r}
                  onClick={() => setRisk(r)}
                  className={cn(
                    "px-2 py-0.5 font-mono text-[10px] font-semibold uppercase transition-colors",
                    risk === r ? activeCls : "text-muted-foreground hover:text-foreground"
                  )}
                  title={`${r.charAt(0).toUpperCase() + r.slice(1)} risk profile`}
                >
                  {short}
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
            No A+ reversal setups right now. Strict filters active — patience pays.
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

              <div className="grid grid-cols-3 gap-1 font-mono text-[10px]">
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
                <div
                  className="flex items-center gap-1 justify-self-end"
                  title={`ATR ${it.atrPct.toFixed(2)}% — ${
                    it.atrPct < 1 ? "very stable" : it.atrPct < 2.5 ? "stable" : it.atrPct < 5 ? "moderate volatility" : "high volatility"
                  }`}
                >
                  <span className="text-muted-foreground">Vol</span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 font-bold",
                      it.atrPct < 1
                        ? "bg-bull/15 text-bull"
                        : it.atrPct < 2.5
                          ? "bg-primary/15 text-primary"
                          : it.atrPct < 5
                            ? "bg-warning/15 text-warning"
                            : "bg-bear/15 text-bear"
                    )}
                  >
                    {it.atrPct.toFixed(1)}%
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
