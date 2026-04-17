import { useEffect, useRef, useState } from "react";
import { fetch24h, subscribeMiniTickers, formatCompact, type Ticker24h } from "@/lib/binance";

const TICKER_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "TONUSDT", "TRXUSDT", "DOTUSDT"];

export function TickerBar() {
  const [tickers, setTickers] = useState<Record<string, Ticker24h>>({});
  const flashRef = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    fetch24h(TICKER_SYMBOLS).then((data) => {
      if (cancelled) return;
      const map: Record<string, Ticker24h> = {};
      data.forEach((t) => (map[t.symbol] = t));
      setTickers(map);
    }).catch(() => {});

    const unsub = subscribeMiniTickers(TICKER_SYMBOLS, (m) => {
      setTickers((prev) => {
        const cur = prev[m.s];
        const newPrice = parseFloat(m.c);
        const oldPrice = cur ? parseFloat(cur.lastPrice) : newPrice;
        flashRef.current[m.s] = newPrice >= oldPrice ? 1 : -1;
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
  }, []);

  return (
    <div className="border-y border-border bg-surface/60 backdrop-blur">
      <div className="flex animate-[scroll_60s_linear_infinite] gap-8 overflow-x-auto px-4 py-2 scrollbar-thin">
        {TICKER_SYMBOLS.map((sym) => {
          const t = tickers[sym];
          if (!t) return (
            <div key={sym} className="flex shrink-0 items-center gap-2 font-mono text-xs">
              <span className="text-muted-foreground">{sym}</span>
              <span className="text-muted-foreground">—</span>
            </div>
          );
          const pct = parseFloat(t.priceChangePercent);
          const up = pct >= 0;
          return (
            <div key={sym} className="flex shrink-0 items-center gap-2 font-mono text-xs">
              <span className="font-semibold text-foreground">{sym.replace("USDT", "")}</span>
              <span className="text-foreground">${formatCompact(parseFloat(t.lastPrice))}</span>
              <span className={up ? "text-bull" : "text-bear"}>
                {up ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
