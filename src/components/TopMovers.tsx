import { useEffect, useState } from "react";
import { fetch24h, formatPrice, formatCompact, type Ticker24h } from "@/lib/binance";
import { ArrowUpRight, ArrowDownRight, Flame } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  onSelect?: (sym: string) => void;
}

export function TopMovers({ onSelect }: Props) {
  const [gainers, setGainers] = useState<Ticker24h[]>([]);
  const [losers, setLosers] = useState<Ticker24h[]>([]);
  const [hot, setHot] = useState<Ticker24h[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch24h().then((data) => {
        if (cancelled) return;
        const usdt = data.filter(
          (t) => t.symbol.endsWith("USDT") && parseFloat(t.quoteVolume) > 5_000_000
        );
        const sortedByPct = [...usdt].sort(
          (a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent)
        );
        const sortedByVol = [...usdt].sort(
          (a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume)
        );
        setGainers(sortedByPct.slice(0, 5));
        setLosers(sortedByPct.slice(-5).reverse());
        setHot(sortedByVol.slice(0, 5));
      }).catch(() => {});
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div className="panel flex h-full flex-col overflow-hidden">
      <div className="grid grid-cols-3 gap-px bg-border">
        <Section
          title="Top Gainers"
          icon={<ArrowUpRight className="size-3 text-bull" />}
          rows={gainers}
          onSelect={onSelect}
          accent="bull"
        />
        <Section
          title="Top Losers"
          icon={<ArrowDownRight className="size-3 text-bear" />}
          rows={losers}
          onSelect={onSelect}
          accent="bear"
        />
        <Section
          title="Hot Volume"
          icon={<Flame className="size-3 text-warning" />}
          rows={hot}
          onSelect={onSelect}
          accent="warning"
          showVol
        />
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  rows,
  onSelect,
  accent,
  showVol,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Ticker24h[];
  onSelect?: (s: string) => void;
  accent: "bull" | "bear" | "warning";
  showVol?: boolean;
}) {
  return (
    <div className="flex flex-col bg-card">
      <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
        {icon}
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
      </div>
      <div className="flex-1">
        {rows.length === 0 && (
          <div className="p-3 font-mono text-[10px] text-muted-foreground">Loading…</div>
        )}
        {rows.map((t) => {
          const pct = parseFloat(t.priceChangePercent);
          const up = pct >= 0;
          return (
            <button
              key={t.symbol}
              onClick={() => onSelect?.(t.symbol)}
              className="flex w-full items-center justify-between px-2.5 py-1.5 text-left transition-colors hover:bg-surface-hover"
            >
              <div className="flex flex-col leading-tight">
                <span className="font-mono text-xs font-semibold">{t.symbol.replace("USDT", "")}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  ${formatPrice(parseFloat(t.lastPrice))}
                </span>
              </div>
              <span
                className={cn(
                  "font-mono text-xs font-semibold tabular-nums",
                  showVol ? "text-warning" : up ? "text-bull" : "text-bear"
                )}
              >
                {showVol
                  ? `$${formatCompact(parseFloat(t.quoteVolume))}`
                  : `${up ? "+" : ""}${pct.toFixed(2)}%`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
