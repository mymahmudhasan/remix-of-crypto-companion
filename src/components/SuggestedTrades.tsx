import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchKlines, formatPrice } from "@/lib/binance";
import { snapshotFromCandles, scoreSignal, type Candle } from "@/lib/indicators";
import { Sparkles, TrendingUp, TrendingDown, Loader2, Target, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

interface Suggestion {
  symbol: string;
  side: "long" | "short";
  score: number;
  conviction: number;
  price: number;
  entryLow: number;
  entryHigh: number;
  stop: number;
  target: number;
  rr: number;
  reasons: string[];
}

const SCAN_UNIVERSE = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT",
  "AVAXUSDT", "LINKUSDT", "TONUSDT", "TRXUSDT", "DOTUSDT", "NEARUSDT", "APTUSDT",
  "ARBUSDT", "OPUSDT", "SUIUSDT", "INJUSDT", "ATOMUSDT", "LTCUSDT", "TIAUSDT",
  "SEIUSDT", "RNDRUSDT", "FETUSDT", "WIFUSDT", "PEPEUSDT", "JUPUSDT", "WLDUSDT",
];

async function buildSuggestion(symbol: string): Promise<Suggestion | null> {
  try {
    const klines = await fetchKlines(symbol, "1h", 220);
    if (klines.length < 100) return null;
    const candles: Candle[] = klines.map((k) => ({
      open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume,
    }));
    const s = snapshotFromCandles(candles);
    const sig = scoreSignal(s);
    if (Math.abs(sig.score) < 25) return null;
    const side: "long" | "short" = sig.score > 0 ? "long" : "short";
    const atr = s.atr14 ?? s.price * 0.015;
    const price = s.price;
    const entryLow = side === "long" ? price - atr * 0.3 : price + atr * 0.1;
    const entryHigh = side === "long" ? price + atr * 0.1 : price + atr * 0.3;
    const stop = side === "long" ? price - atr * 1.5 : price + atr * 1.5;
    const target = side === "long" ? price + atr * 3 : price - atr * 3;
    const risk = Math.abs(price - stop);
    const reward = Math.abs(target - price);
    const rr = risk > 0 ? reward / risk : 0;
    return {
      symbol,
      side,
      score: sig.score,
      conviction: Math.min(100, Math.abs(sig.score) + (s.volRatio && s.volRatio > 1.5 ? 10 : 0)),
      price,
      entryLow: Math.min(entryLow, entryHigh),
      entryHigh: Math.max(entryLow, entryHigh),
      stop,
      target,
      rr,
      reasons: sig.reasons.slice(0, 3),
    };
  } catch {
    return null;
  }
}

export function SuggestedTrades({ onSelect }: { onSelect?: (sym: string) => void }) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "long" | "short">("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      // Run in batches to avoid hammering Binance
      const results: Suggestion[] = [];
      const batchSize = 6;
      for (let i = 0; i < SCAN_UNIVERSE.length; i += batchSize) {
        if (cancelled) return;
        const batch = SCAN_UNIVERSE.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(buildSuggestion));
        batchResults.forEach((r) => r && results.push(r));
        if (!cancelled) {
          const sorted = [...results].sort((a, b) => b.conviction - a.conviction);
          setItems(sorted.slice(0, 8));
        }
      }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, []);

  const filtered = items.filter((it) => filter === "all" || it.side === filter);

  return (
    <div className="panel flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-3.5 text-primary" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Suggested Trades
          </h3>
          {loading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex overflow-hidden rounded-md border border-border bg-surface-elevated">
          {(["all", "long", "short"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-2 py-0.5 font-mono text-[10px] font-semibold uppercase transition-colors",
                filter === f
                  ? f === "long"
                    ? "bg-bull/20 text-bull"
                    : f === "short"
                      ? "bg-bear/20 text-bear"
                      : "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {filtered.length === 0 && !loading && (
          <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
            No high-conviction setups right now
          </div>
        )}
        {filtered.map((it) => {
          const long = it.side === "long";
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
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 font-mono text-[10px]">
                    <span className="text-muted-foreground">R:R</span>
                    <span className={cn("font-bold", it.rr >= 2 ? "text-bull" : "text-warning")}>
                      {it.rr.toFixed(1)}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "font-mono text-[10px] font-bold",
                      it.conviction >= 60 ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {it.conviction}%
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1 font-mono text-[10px]">
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Entry</span>
                  <span className="text-foreground">
                    {formatPrice(it.entryLow)}–{formatPrice(it.entryHigh)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Shield className="size-2.5 text-bear" />
                  <span className="text-bear">{formatPrice(it.stop)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Target className="size-2.5 text-bull" />
                  <span className="text-bull">{formatPrice(it.target)}</span>
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

      <Link
        to="/scanner"
        className="border-t border-border px-3 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-primary hover:bg-surface-hover"
      >
        Open full Scanner →
      </Link>
    </div>
  );
}
