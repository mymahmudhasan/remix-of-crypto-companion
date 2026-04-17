import { useEffect, useState } from "react";
import { fetch24h, subscribeMiniTickers, formatCompact, formatPrice, type Ticker24h } from "@/lib/binance";
import { cn } from "@/lib/utils";

const INTERVALS = ["15m", "1h", "4h", "1d"];

interface Props {
  symbol: string;
  interval: string;
  onIntervalChange: (i: string) => void;
}

export function SymbolHeader({ symbol, interval, onIntervalChange }: Props) {
  const [t, setT] = useState<Ticker24h | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch24h([symbol]).then((d) => { if (!cancelled) setT(d[0] ?? null); }).catch(() => {});
    const unsub = subscribeMiniTickers([symbol], (m) => {
      const open = parseFloat(m.o);
      const close = parseFloat(m.c);
      const pct = ((close - open) / open) * 100;
      setT({
        symbol: m.s,
        lastPrice: m.c,
        priceChangePercent: pct.toFixed(2),
        quoteVolume: m.q,
        highPrice: m.h,
        lowPrice: m.l,
      });
    });
    return () => { cancelled = true; unsub(); };
  }, [symbol]);

  const pct = t ? parseFloat(t.priceChangePercent) : 0;
  const up = pct >= 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface/40 px-4 py-3 backdrop-blur">
      <div className="flex items-baseline gap-4">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xl font-bold text-foreground">{symbol.replace("USDT", "")}</span>
          <span className="font-mono text-xs text-muted-foreground">/USDT</span>
        </div>
        <span className={cn("font-mono text-2xl font-bold tabular-nums", up ? "text-bull neon-text" : "text-bear")}>
          ${t ? formatPrice(parseFloat(t.lastPrice)) : "—"}
        </span>
        <span className={cn("font-mono text-sm font-semibold", up ? "text-bull" : "text-bear")}>
          {t ? `${up ? "+" : ""}${pct.toFixed(2)}%` : "—"}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden items-center gap-4 font-mono text-[11px] sm:flex">
          <div className="flex flex-col items-end">
            <span className="text-[9px] uppercase text-muted-foreground">24h High</span>
            <span className="text-foreground">{t ? formatPrice(parseFloat(t.highPrice)) : "—"}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[9px] uppercase text-muted-foreground">24h Low</span>
            <span className="text-foreground">{t ? formatPrice(parseFloat(t.lowPrice)) : "—"}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[9px] uppercase text-muted-foreground">24h Vol</span>
            <span className="text-foreground">${t ? formatCompact(parseFloat(t.quoteVolume)) : "—"}</span>
          </div>
        </div>
        <div className="flex overflow-hidden rounded-md border border-border bg-surface-elevated">
          {INTERVALS.map((i) => (
            <button
              key={i}
              onClick={() => onIntervalChange(i)}
              className={cn(
                "px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors",
                interval === i ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              )}
            >
              {i}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
