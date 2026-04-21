import { useEffect, useState } from "react";
import { fetch24h } from "@/lib/binance";

/**
 * Fetches 24h % change and refreshes every 60s.
 * Pulls the FULL ticker list once (cheap, gzipped) and filters in JS, because
 * passing a `symbols=[...]` filter fails (400) the moment one symbol isn't a
 * valid spot pair — and many futures perps aren't listed on spot.
 *
 * Returns a map of symbol → percent change. Empty while loading or on error.
 */
export function use24hChanges(symbols: string[]): Record<string, number> {
  const [map, setMap] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!symbols.length) return;
    let cancelled = false;
    const wanted = new Set(symbols);

    async function load() {
      try {
        const all = await fetch24h(); // no filter → returns every spot ticker
        if (cancelled) return;
        const next: Record<string, number> = {};
        for (const t of all) {
          if (!wanted.has(t.symbol)) continue;
          const v = parseFloat(t.priceChangePercent);
          if (isFinite(v)) next[t.symbol] = v;
        }
        setMap(next);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[use24hChanges] fetch failed", e);
      }
    }

    load();
    const id = window.setInterval(load, 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(",")]);

  return map;
}
