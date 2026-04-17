import { useEffect, useRef, useState } from "react";
import { fetch24h, subscribeMiniTickers, formatCompact, formatPrice, type Ticker24h } from "@/lib/binance";
import { cn } from "@/lib/utils";

interface Props {
  symbols: string[];
  selected: string;
  onSelect: (sym: string) => void;
}

export function Watchlist({ symbols, selected, onSelect }: Props) {
  const [tickers, setTickers] = useState<Record<string, Ticker24h>>({});
  const [flash, setFlash] = useState<Record<string, "up" | "down" | null>>({});
  const lastPrice = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    fetch24h(symbols).then((data) => {
      if (cancelled) return;
      const map: Record<string, Ticker24h> = {};
      data.forEach((t) => {
        map[t.symbol] = t;
        lastPrice.current[t.symbol] = parseFloat(t.lastPrice);
      });
      setTickers(map);
    }).catch(() => {});

    const unsub = subscribeMiniTickers(symbols, (m) => {
      const newPrice = parseFloat(m.c);
      const old = lastPrice.current[m.s] ?? newPrice;
      const dir = newPrice > old ? "up" : newPrice < old ? "down" : null;
      lastPrice.current[m.s] = newPrice;
      setFlash((prev) => ({ ...prev, [m.s]: dir }));
      setTimeout(() => setFlash((prev) => ({ ...prev, [m.s]: null })), 600);
      setTickers((prev) => {
        const open = parseFloat(m.o);
        const pct = ((newPrice - open) / open) * 100;
        return {
          ...prev,
          [m.s]: {
            symbol: m.s,
            lastPrice: m.c,
            priceChangePercent: pct.toFixed(2),
            quoteVolume: m.q,
            highPrice: m.h,
            lowPrice: m.l,
          },
        };
      });
    });
    return () => { cancelled = true; unsub(); };
  }, [symbols.join(",")]);

  return (
    <div className="panel flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="size-2 animate-pulse-glow rounded-full bg-bull" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">Watchlist</h3>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">LIVE</span>
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="flex-1">Pair</span>
        <span className="w-20 text-right">Price</span>
        <span className="w-16 text-right">24h%</span>
        <span className="hidden w-20 text-right md:inline">Vol</span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {symbols.map((sym) => {
          const t = tickers[sym];
          const pct = t ? parseFloat(t.priceChangePercent) : 0;
          const up = pct >= 0;
          const isSelected = sym === selected;
          const f = flash[sym];
          return (
            <button
              key={sym}
              onClick={() => onSelect(sym)}
              className={cn(
                "flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left transition-colors",
                isSelected
                  ? "border-primary bg-surface-hover"
                  : "border-transparent hover:bg-surface-hover",
                f === "up" && "flash-bull",
                f === "down" && "flash-bear"
              )}
            >
              <div className="flex flex-1 flex-col">
                <span className="font-mono text-sm font-semibold">{sym.replace("USDT", "")}</span>
                <span className="font-mono text-[10px] text-muted-foreground">/USDT</span>
              </div>
              <span className="w-20 text-right font-mono text-sm">
                {t ? formatPrice(parseFloat(t.lastPrice)) : "—"}
              </span>
              <span className={cn("w-16 text-right font-mono text-xs font-medium", up ? "text-bull" : "text-bear")}>
                {t ? `${up ? "+" : ""}${pct.toFixed(2)}%` : "—"}
              </span>
              <span className="hidden w-20 text-right font-mono text-xs text-muted-foreground md:inline">
                {t ? formatCompact(parseFloat(t.quoteVolume)) : "—"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
