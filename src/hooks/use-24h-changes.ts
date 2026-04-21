import { useEffect, useState } from "react";
import { fetch24h } from "@/lib/binance";

/**
 * Fetches 24h % change for a list of symbols and refreshes every 60s.
 * Returns a map of symbol → percent change (number), or null while loading.
 */
export function use24hChanges(symbols: string[]): Record<string, number> {
  const [map, setMap] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!symbols.length) return;
    let cancelled = false;

    // De-dupe & sort for a stable cache key.
    const uniq = Array.from(new Set(symbols)).sort();

    async function load() {
      try {
        const data = await fetch24h(uniq);
        if (cancelled) return;
        const next: Record<string, number> = {};
        for (const t of data) {
          const v = parseFloat(t.priceChangePercent);
          if (isFinite(v)) next[t.symbol] = v;
        }
        setMap(next);
      } catch {
        // silent — label simply won't render
      }
    }

    load();
    const id = window.setInterval(load, 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(",")]);

  return map;
}
