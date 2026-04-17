import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Star, X, Plus } from "lucide-react";
import { useFavorites } from "@/hooks/use-favorites";
import { fetch24h, formatPrice, subscribeMiniTickers, type MiniTickerMsg } from "@/lib/binance";
import { cn } from "@/lib/utils";

interface Tick {
  price: number;
  changePct: number;
}

/**
 * Compact horizontal strip showing the user's starred symbols with live prices.
 * Renders nothing when there are no favorites.
 */
export function FavoritesStrip() {
  const navigate = useNavigate();
  const { favorites, toggle } = useFavorites();
  const symbols = useMemo(() => Array.from(favorites), [favorites]);
  const [ticks, setTicks] = useState<Record<string, Tick>>({});
  const wsRef = useRef<(() => void) | null>(null);

  // Seed with REST snapshot, then keep updating via WebSocket
  useEffect(() => {
    if (symbols.length === 0) {
      setTicks({});
      wsRef.current?.();
      wsRef.current = null;
      return;
    }
    let cancelled = false;
    fetch24h(symbols)
      .then((rows) => {
        if (cancelled) return;
        const map: Record<string, Tick> = {};
        for (const r of rows) {
          map[r.symbol] = {
            price: parseFloat(r.lastPrice),
            changePct: parseFloat(r.priceChangePercent),
          };
        }
        setTicks((prev) => ({ ...prev, ...map }));
      })
      .catch(() => {});

    wsRef.current?.();
    wsRef.current = subscribeMiniTickers(symbols, (m: MiniTickerMsg) => {
      const close = parseFloat(m.c);
      const open = parseFloat(m.o);
      const changePct = open > 0 ? ((close - open) / open) * 100 : 0;
      setTicks((prev) => ({ ...prev, [m.s]: { price: close, changePct } }));
    });

    return () => {
      cancelled = true;
      wsRef.current?.();
      wsRef.current = null;
    };
  }, [symbols.join(",")]); // re-subscribe when set changes

  if (symbols.length === 0) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface/30 px-3 py-1.5">
        <Star className="size-3 text-muted-foreground/60" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          No favorites yet — star tokens in the Scanner to pin them here
        </span>
        <button
          onClick={() => navigate("/scanner")}
          className="ml-auto flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary hover:bg-primary/20"
        >
          <Plus className="size-3" /> Add
        </button>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface/30 px-2 py-1 scrollbar-thin">
      <Star className="size-3 shrink-0 fill-warning text-warning" />
      {symbols.map((s) => {
        const t = ticks[s];
        const up = (t?.changePct ?? 0) >= 0;
        const base = s.replace(/USDT$|USDC$|BUSD$|FDUSD$/, "");
        return (
          <div
            key={s}
            className="group flex shrink-0 items-center gap-1.5 rounded border border-border bg-surface-elevated px-2 py-0.5 font-mono text-[11px] hover:border-primary/40"
          >
            <button
              onClick={() => navigate(`/spot?symbol=${s}`)}
              className="flex items-center gap-1.5"
              title={`Open ${s} in Spot`}
            >
              <span className="font-bold text-foreground">{base}</span>
              <span className="tabular-nums text-muted-foreground">
                {t ? `$${formatPrice(t.price)}` : "—"}
              </span>
              <span className={cn("tabular-nums font-semibold", up ? "text-bull" : "text-bear")}>
                {t ? `${up ? "+" : ""}${t.changePct.toFixed(2)}%` : ""}
              </span>
            </button>
            <button
              onClick={() => toggle(s)}
              className="opacity-0 transition-opacity hover:text-bear group-hover:opacity-100"
              title="Remove from favorites"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
