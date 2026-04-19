import { useEffect, useState } from "react";
import { fetch24h, formatCompact, formatPrice, subscribeMiniTickers, type Ticker24h } from "@/lib/binance";
import { TrendingUp, TrendingDown, Activity, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

const HERO_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];

interface Props {
  onSelect?: (sym: string) => void;
  selected?: string;
}

export function MarketHero({ onSelect, selected }: Props) {
  const [tickers, setTickers] = useState<Record<string, Ticker24h>>({});

  useEffect(() => {
    let cancelled = false;
    fetch24h(HERO_SYMBOLS).then((data) => {
      if (cancelled) return;
      const map: Record<string, Ticker24h> = {};
      data.forEach((t) => (map[t.symbol] = t));
      setTickers(map);
    }).catch(() => {});
    const unsub = subscribeMiniTickers(HERO_SYMBOLS, (m) => {
      const open = parseFloat(m.o);
      const close = parseFloat(m.c);
      const pct = ((close - open) / open) * 100;
      setTickers((prev) => ({
        ...prev,
        [m.s]: {
          symbol: m.s, lastPrice: m.c, priceChangePercent: pct.toFixed(2),
          quoteVolume: m.q, highPrice: m.h, lowPrice: m.l,
        },
      }));
    });
    return () => { cancelled = true; unsub(); };
  }, []);

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {HERO_SYMBOLS.map((sym) => {
        const t = tickers[sym];
        const pct = t ? parseFloat(t.priceChangePercent) : 0;
        const up = pct >= 0;
        const isSelected = sym === selected;
        return (
          <button
            key={sym}
            onClick={() => onSelect?.(sym)}
            className={cn(
              "panel group relative overflow-hidden p-3 text-left transition-all hover:border-primary/40",
              isSelected && "border-primary/60 ring-1 ring-primary/30"
            )}
          >
            <div
              className={cn(
                "absolute inset-x-0 top-0 h-0.5 transition-opacity",
                up ? "bg-bull/70" : "bg-bear/70"
              )}
            />
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-bold text-foreground">
                {sym.replace("USDT", "")}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                  up ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
                )}
              >
                {up ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
                {up ? "+" : ""}{pct.toFixed(2)}%
              </span>
            </div>
            <div className="mt-1.5 font-mono text-lg font-bold tabular-nums text-foreground">
              ${t ? formatPrice(parseFloat(t.lastPrice)) : "—"}
            </div>
            <div className="mt-0.5 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
              <span>Vol ${t ? formatCompact(parseFloat(t.quoteVolume)) : "—"}</span>
              <span>H ${t ? formatPrice(parseFloat(t.highPrice)) : "—"}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function MarketStatsBar() {
  const [stats, setStats] = useState<{ gainers: number; losers: number; totalVol: number; topGainer?: Ticker24h; topLoser?: Ticker24h }>({
    gainers: 0, losers: 0, totalVol: 0,
  });

  useEffect(() => {
    let cancelled = false;
    fetch24h().then((data) => {
      if (cancelled) return;
      const usdt = data.filter((t) => t.symbol.endsWith("USDT") && parseFloat(t.quoteVolume) > 1_000_000);
      let gainers = 0, losers = 0, totalVol = 0;
      let topGainer: Ticker24h | undefined, topLoser: Ticker24h | undefined;
      usdt.forEach((t) => {
        const pct = parseFloat(t.priceChangePercent);
        const vol = parseFloat(t.quoteVolume);
        totalVol += vol;
        if (pct > 0) gainers++; else if (pct < 0) losers++;
        if (!topGainer || pct > parseFloat(topGainer.priceChangePercent)) topGainer = t;
        if (!topLoser || pct < parseFloat(topLoser.priceChangePercent)) topLoser = t;
      });
      setStats({ gainers, losers, totalVol, topGainer, topLoser });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const total = stats.gainers + stats.losers || 1;
  const gainerPct = (stats.gainers / total) * 100;

  return (
    <div className="panel grid grid-cols-2 gap-2 p-2.5 md:grid-cols-4">
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <DollarSign className="size-4" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">24h Vol</span>
          <span className="font-mono text-sm font-bold tabular-nums">${formatCompact(stats.totalVol)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-md bg-bull/10 text-bull">
          <TrendingUp className="size-4" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Gainers</span>
          <span className="font-mono text-sm font-bold text-bull tabular-nums">{stats.gainers}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-md bg-bear/10 text-bear">
          <TrendingDown className="size-4" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Losers</span>
          <span className="font-mono text-sm font-bold text-bear tabular-nums">{stats.losers}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-md bg-accent/10 text-accent">
          <Activity className="size-4" />
        </div>
        <div className="flex flex-1 flex-col leading-tight">
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Breadth</span>
          <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-surface-elevated">
            <div className="bg-bull" style={{ width: `${gainerPct}%` }} />
            <div className="bg-bear" style={{ width: `${100 - gainerPct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
