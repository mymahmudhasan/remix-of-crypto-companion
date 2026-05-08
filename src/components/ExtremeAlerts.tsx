import { useEffect, useState } from "react";
import { fetchKlines, formatPrice } from "@/lib/binance";
import { snapshotFromCandles, scoreSignal, type Candle, type IndicatorSnapshot } from "@/lib/indicators";
import { Skull, Rocket, Loader2, TrendingDown, TrendingUp, Flame } from "lucide-react";
import { cn } from "@/lib/utils";

type Kind = "crash" | "rebound";

interface Alert {
  symbol: string;
  kind: Kind;
  probability: number;        // 80–98
  price: number;
  changePct: number;          // recent move (last 30 bars on 4h ≈ 5d)
  rsi: number | null;
  atrPct: number | null;
  reasons: string[];
  // Suggested trade levels
  entry: number;
  stop: number;
  target: number;
}

const UNIVERSE = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT",
  "AVAXUSDT", "LINKUSDT", "TONUSDT", "TRXUSDT", "DOTUSDT", "NEARUSDT", "APTUSDT",
  "ARBUSDT", "OPUSDT", "SUIUSDT", "INJUSDT", "ATOMUSDT", "LTCUSDT", "TIAUSDT",
  "SEIUSDT", "RNDRUSDT", "FETUSDT", "JUPUSDT", "WLDUSDT", "ETCUSDT", "FILUSDT",
  "PEPEUSDT", "WIFUSDT", "SHIBUSDT", "BONKUSDT", "ORDIUSDT", "AAVEUSDT", "UNIUSDT",
];

/** Crash probability: bearish stack + recent rally fading + at/near upper BB or breakdown. */
function crashScore(s: IndicatorSnapshot, recentChangePct: number): { p: number; reasons: string[] } | null {
  const reasons: string[] = [];
  let p = 0;

  if (s.rsi14 !== null && s.rsi14 > 72) { p += 22; reasons.push(`RSI ${s.rsi14.toFixed(0)} extreme overbought`); }
  if (s.bbPercentB !== null && s.bbPercentB > 0.95) { p += 14; reasons.push("Hugging upper Bollinger band"); }
  if (s.stochK !== null && s.stochD !== null && s.stochK > 80 && s.stochK < s.stochD) {
    p += 12; reasons.push("Stochastic overbought rolling over");
  }
  if (s.macd !== null && s.macdSignal !== null && s.macd < s.macdSignal && s.macdHist !== null && s.macdHist < 0) {
    p += 14; reasons.push("MACD bearish cross");
  }
  if (s.ema20 && s.ema50 && s.ema20 < s.ema50) { p += 10; reasons.push("EMA20 lost EMA50 (downtrend)"); }
  if (s.ema50 && s.ema200 && s.ema50 < s.ema200) { p += 10; reasons.push("Death-cross structure (EMA50<EMA200)"); }
  if (s.ema20 && s.price < s.ema20) { p += 6; reasons.push("Price under EMA20"); }
  if (recentChangePct > 25) { p += 14; reasons.push(`Pumped +${recentChangePct.toFixed(0)}% recently — mean-reversion risk`); }
  if (recentChangePct < -10 && s.price < (s.ema50 ?? s.price)) { p += 10; reasons.push("Breaking down through EMA50"); }
  if (s.atrPct !== null && s.atrPct > 6) { p += 8; reasons.push(`High volatility (ATR ${s.atrPct.toFixed(1)}%)`); }
  if (s.volRatio !== null && s.volRatio > 1.8 && recentChangePct < 0) {
    p += 8; reasons.push(`Distribution volume ${s.volRatio.toFixed(1)}× avg`);
  }

  if (p < 80) return null;
  return { p: Math.min(98, p), reasons: reasons.slice(0, 4) };
}

/** Rebound probability: deep drop + oversold + bullish reversal cues. */
function reboundScore(s: IndicatorSnapshot, recentChangePct: number): { p: number; reasons: string[] } | null {
  const reasons: string[] = [];
  let p = 0;

  if (recentChangePct < -20) { p += 18; reasons.push(`Down ${recentChangePct.toFixed(0)}% recently`); }
  else if (recentChangePct < -10) { p += 10; reasons.push(`Pulled back ${recentChangePct.toFixed(0)}%`); }
  if (s.rsi14 !== null && s.rsi14 < 30) { p += 22; reasons.push(`RSI ${s.rsi14.toFixed(0)} oversold`); }
  else if (s.rsi14 !== null && s.rsi14 < 38) { p += 10; reasons.push(`RSI ${s.rsi14.toFixed(0)} weak`); }
  if (s.bbPercentB !== null && s.bbPercentB < 0.05) { p += 14; reasons.push("Tagging lower Bollinger band"); }
  if (s.stochK !== null && s.stochD !== null && s.stochK < 20 && s.stochK > s.stochD) {
    p += 14; reasons.push("Stochastic bullish cross from oversold");
  }
  if (s.macd !== null && s.macdSignal !== null && s.macd > s.macdSignal && s.macdHist !== null && s.macdHist > 0) {
    p += 12; reasons.push("MACD turning up");
  }
  if (s.ema200 && s.price > s.ema200 * 0.97 && s.price < s.ema200 * 1.05) {
    p += 8; reasons.push("Holding near EMA200 support");
  }
  if (s.volRatio !== null && s.volRatio > 1.5) { p += 8; reasons.push(`Capitulation volume ${s.volRatio.toFixed(1)}× avg`); }
  if (s.ema20 && s.ema50 && s.ema20 > s.ema50 && s.price > s.ema20) { p += 6; reasons.push("Reclaiming EMA20"); }

  if (p < 80) return null;
  return { p: Math.min(98, p), reasons: reasons.slice(0, 4) };
}

async function scan(symbol: string): Promise<Alert[]> {
  try {
    const klines = await fetchKlines(symbol, "4h", 220);
    if (klines.length < 100) return [];
    const candles: Candle[] = klines.map((k) => ({
      open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume,
    }));
    const s = snapshotFromCandles(candles);
    const closes = candles.map((c) => c.close);
    const ref = closes[Math.max(0, closes.length - 30)] || s.price;
    const recentChangePct = ((s.price - ref) / ref) * 100;
    const atr = s.atr14 ?? s.price * 0.02;

    const out: Alert[] = [];
    const c = crashScore(s, recentChangePct);
    if (c) {
      out.push({
        symbol, kind: "crash", probability: c.p, price: s.price,
        changePct: recentChangePct, rsi: s.rsi14, atrPct: s.atrPct, reasons: c.reasons,
        entry: s.price, stop: s.price + atr * 1.2, target: s.price - atr * 3,
      });
    }
    const r = reboundScore(s, recentChangePct);
    if (r) {
      out.push({
        symbol, kind: "rebound", probability: r.p, price: s.price,
        changePct: recentChangePct, rsi: s.rsi14, atrPct: s.atrPct, reasons: r.reasons,
        entry: s.price, stop: s.price - atr * 1.2, target: s.price + atr * 3,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function ExtremeAlerts({
  mode,
  onSelect,
}: {
  mode: "spot" | "futures";
  onSelect?: (sym: string) => void;
}) {
  const [items, setItems] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setItems([]);
    (async () => {
      const all: Alert[] = [];
      const batchSize = 6;
      for (let i = 0; i < UNIVERSE.length; i += batchSize) {
        if (cancelled) return;
        const batch = UNIVERSE.slice(i, i + batchSize);
        const res = await Promise.all(batch.map(scan));
        res.flat().forEach((a) => all.push(a));
        if (!cancelled) {
          const sorted = [...all].sort((a, b) => b.probability - a.probability);
          setItems(sorted);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // On Spot, hide crash alerts as actionable trades (you can't short on spot) but still show them as warnings.
  const crashes = items.filter((i) => i.kind === "crash").slice(0, 5);
  const rebounds = items.filter((i) => i.kind === "rebound").slice(0, 5);

  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <AlertColumn
        title={mode === "spot" ? "Crash Warning · 80%+ Down Risk" : "Crash Setups · 80%+ Down · SHORT"}
        icon={<Skull className="size-3.5 text-bear" />}
        accent="bear"
        emptyText="No coins with ≥80% crash probability right now."
        items={crashes}
        loading={loading}
        onSelect={onSelect}
        ctaLabel={mode === "spot" ? "Avoid / Take profit" : "Short setup"}
      />
      <AlertColumn
        title="Rebound Setups · 80%+ Up · LONG"
        icon={<Rocket className="size-3.5 text-bull" />}
        accent="bull"
        emptyText="No deeply oversold coins with ≥80% rebound probability."
        items={rebounds}
        loading={loading}
        onSelect={onSelect}
        ctaLabel="Buy the dip"
      />
    </div>
  );
}

function AlertColumn({
  title, icon, accent, items, loading, onSelect, emptyText, ctaLabel,
}: {
  title: string;
  icon: React.ReactNode;
  accent: "bull" | "bear";
  items: Alert[];
  loading: boolean;
  onSelect?: (s: string) => void;
  emptyText: string;
  ctaLabel: string;
}) {
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </h3>
          {loading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        </div>
        <span className="font-mono text-[10px] uppercase text-muted-foreground">4h · scan</span>
      </div>

      <div className="divide-y divide-border">
        {items.length === 0 && !loading && (
          <div className="px-3 py-6 text-center font-mono text-[11px] text-muted-foreground">
            {emptyText}
          </div>
        )}
        {items.map((it) => {
          const down = it.kind === "crash";
          return (
            <button
              key={`${it.kind}-${it.symbol}`}
              onClick={() => onSelect?.(it.symbol)}
              className="flex w-full flex-col gap-1.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase",
                      down ? "bg-bear/20 text-bear" : "bg-bull/20 text-bull"
                    )}
                  >
                    {down ? <TrendingDown className="size-2.5" /> : <TrendingUp className="size-2.5" />}
                    {down ? "crash" : "rebound"}
                  </span>
                  <span className="font-mono text-sm font-bold">{it.symbol.replace("USDT", "")}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">${formatPrice(it.price)}</span>
                  <span
                    className={cn(
                      "font-mono text-[10px] font-bold",
                      it.changePct >= 0 ? "text-bull" : "text-bear"
                    )}
                  >
                    {it.changePct >= 0 ? "+" : ""}{it.changePct.toFixed(1)}%
                  </span>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-black",
                    accent === "bear" ? "bg-bear/20 text-bear" : "bg-bull/20 text-bull"
                  )}
                >
                  <Flame className="size-2.5" /> {it.probability}%
                </span>
              </div>

              <div className="grid grid-cols-4 gap-1 font-mono text-[10px]">
                <div className="flex flex-col">
                  <span className="text-muted-foreground">{ctaLabel}</span>
                  <span className="text-foreground">${formatPrice(it.entry)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground">Stop</span>
                  <span className="text-bear">${formatPrice(it.stop)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground">Target</span>
                  <span className="text-bull">${formatPrice(it.target)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground">RSI</span>
                  <span className="text-foreground/80">{it.rsi !== null ? it.rsi.toFixed(0) : "—"}</span>
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
