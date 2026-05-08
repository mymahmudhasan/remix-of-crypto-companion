import { useEffect, useState } from "react";
import { fetchKlines, formatPrice } from "@/lib/binance";
import { snapshotFromCandles, scoreSignal, type Candle } from "@/lib/indicators";
import { estimateWinChance, winTier } from "@/lib/win-chance";
import { ShieldCheck, TrendingUp, TrendingDown, Loader2, Target, Shield, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface Pick {
  symbol: string;
  side: "long" | "short";
  conviction: number;
  winChance: number;
  price: number;
  entryLow: number;
  entryHigh: number;
  stop: number;
  target: number;
  rr: number;
  atrPct: number;
  leverage: number;
  reasons: string[];
}

const UNIVERSE = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT",
  "AVAXUSDT", "LINKUSDT", "TONUSDT", "TRXUSDT", "DOTUSDT", "NEARUSDT", "APTUSDT",
  "ARBUSDT", "OPUSDT", "SUIUSDT", "INJUSDT", "ATOMUSDT", "LTCUSDT", "TIAUSDT",
  "SEIUSDT", "RNDRUSDT", "FETUSDT", "JUPUSDT", "WLDUSDT", "ETCUSDT", "FILUSDT",
];

async function buildPick(symbol: string, mode: "spot" | "futures"): Promise<Pick | null> {
  try {
    const klines = await fetchKlines(symbol, "4h", 220);
    if (klines.length < 100) return null;
    const candles: Candle[] = klines.map((k) => ({
      open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume,
    }));
    const s = snapshotFromCandles(candles);
    const sig = scoreSignal(s);

    // Low-risk filters: meaningful direction, manageable volatility
    if (Math.abs(sig.score) < 25) return null;
    const atrPct = s.atrPct ?? 99;
    if (atrPct > 4.5) return null; // skip extreme volatility = lower-risk pick

    // Spot tab focuses on long-only opportunities (you can't short on spot)
    const side: "long" | "short" = sig.score > 0 ? "long" : "short";
    if (mode === "spot" && side === "short") return null;

    const atr = s.atr14 ?? s.price * 0.015;
    const price = s.price;
    const entryLow = side === "long" ? price - atr * 0.3 : price + atr * 0.1;
    const entryHigh = side === "long" ? price + atr * 0.1 : price + atr * 0.3;
    // Tighter stop (1.2 ATR) + further target (3 ATR) → favorable RR
    const stop = side === "long" ? price - atr * 1.2 : price + atr * 1.2;
    const target = side === "long" ? price + atr * 3 : price - atr * 3;
    const risk = Math.abs(price - stop);
    const reward = Math.abs(target - price);
    const rr = risk > 0 ? reward / risk : 0;
    if (rr < 2) return null;

    const conviction = Math.min(100, Math.abs(sig.score) + (s.volRatio && s.volRatio > 1.5 ? 10 : 0));
    const winChance = estimateWinChance({ conviction, risk_reward: rr });
    if (winChance < 65) return null;

    // Conservative leverage suggestion based on volatility (futures only)
    const leverage = atrPct > 3 ? 2 : atrPct > 2 ? 3 : atrPct > 1 ? 5 : 7;

    return {
      symbol, side, conviction, winChance, price,
      entryLow: Math.min(entryLow, entryHigh),
      entryHigh: Math.max(entryLow, entryHigh),
      stop, target, rr, atrPct, leverage,
      reasons: sig.reasons.slice(0, 3),
    };
  } catch {
    return null;
  }
}

export function LowRiskPicks({
  mode,
  onSelect,
}: {
  mode: "spot" | "futures";
  onSelect?: (sym: string) => void;
}) {
  const [items, setItems] = useState<Pick[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setItems([]);
    (async () => {
      const results: Pick[] = [];
      const batchSize = 6;
      for (let i = 0; i < UNIVERSE.length; i += batchSize) {
        if (cancelled) return;
        const batch = UNIVERSE.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map((s) => buildPick(s, mode)));
        batchResults.forEach((r) => r && results.push(r));
        if (!cancelled) {
          const sorted = [...results].sort((a, b) => b.winChance - a.winChance);
          setItems(sorted.slice(0, 6));
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [mode]);

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-3.5 text-bull" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Low-Risk · High Win-Chance Picks
          </h3>
          {loading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        </div>
        <span className="font-mono text-[10px] uppercase text-muted-foreground">
          {mode === "spot" ? "Spot · Long only" : "Perp · 2–7×"}
        </span>
      </div>

      <div className="divide-y divide-border">
        {items.length === 0 && !loading && (
          <div className="px-3 py-6 text-center font-mono text-xs text-muted-foreground">
            No high win-chance setups passed the low-risk filter right now.
          </div>
        )}
        {items.map((it) => {
          const long = it.side === "long";
          const tier = winTier(it.winChance);
          return (
            <button
              key={it.symbol}
              onClick={() => onSelect?.(it.symbol)}
              className="flex w-full flex-col gap-1.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase",
                      long ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
                    )}
                  >
                    {long ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
                    {it.side}
                  </span>
                  <span className="font-mono text-sm font-bold">{it.symbol.replace("USDT", "")}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    ${formatPrice(it.price)}
                  </span>
                  {mode === "futures" && (
                    <span className="inline-flex items-center gap-0.5 rounded border border-border bg-surface-elevated px-1 py-0.5 font-mono text-[9px] text-foreground/80">
                      <Zap className="size-2.5" /> {it.leverage}×
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">R:R</span>
                  <span className="font-mono text-[10px] font-bold text-bull">{it.rr.toFixed(1)}</span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 font-mono text-[10px] font-bold",
                      tier === "elite" ? "bg-primary/20 text-primary"
                      : tier === "strong" ? "bg-bull/15 text-bull"
                      : "bg-warning/15 text-warning"
                    )}
                  >
                    {it.winChance}% win
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-1 font-mono text-[10px]">
                <div className="flex flex-col">
                  <span className="text-muted-foreground">Entry</span>
                  <span className="text-foreground">{formatPrice(it.entryLow)}–{formatPrice(it.entryHigh)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground">Stop</span>
                  <span className="flex items-center gap-1 text-bear"><Shield className="size-2.5" />{formatPrice(it.stop)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground">Target</span>
                  <span className="flex items-center gap-1 text-bull"><Target className="size-2.5" />{formatPrice(it.target)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground">ATR%</span>
                  <span className="text-foreground/80">{it.atrPct.toFixed(2)}%</span>
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
    </div>
  );
}
