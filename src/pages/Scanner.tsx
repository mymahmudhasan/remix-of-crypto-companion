import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, RefreshCw, Search, Sparkles } from "lucide-react";
import { fetch24h, fetchAllUsdtSymbols, formatCompact, formatPrice } from "@/lib/binance";
import { tickerToRow, sortRows, type ScannerRow, type SortKey, type SortDir } from "@/lib/scanner";
import { cn } from "@/lib/utils";

const SPREADS = [
  { id: "all", label: "All Spreads" },
  { id: "tight", label: "Tight (<3%)" },
  { id: "normal", label: "Normal (3-7%)" },
  { id: "wide", label: "Wide (>7%)" },
] as const;

const PAGE_SIZES = [25, 50, 100, 200];

export default function Scanner() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ScannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date>(new Date());
  const [query, setQuery] = useState("");
  const [spread, setSpread] = useState<typeof SPREADS[number]["id"]>("all");
  const [sortKey, setSortKey] = useState<SortKey>("quoteVolume");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [pageSize, setPageSize] = useState(50);

  const refresh = async () => {
    setLoading(true);
    try {
      // Fetch ALL Binance USDT pairs (spot + web3 tokens — anything trading on Binance)
      const symbols = await fetchAllUsdtSymbols();
      const data = await fetch24h(symbols);
      const r = data
        .map((t) => tickerToRow(t))
        .filter((x): x is ScannerRow => !!x && x.quoteVolume > 10_000); // drop dust pairs
      setRows(r);
      setUpdatedAt(new Date());
    } catch (e) {
      console.error("Scanner fetch failed", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    let r = rows;
    if (query.trim()) {
      const q = query.trim().toUpperCase();
      r = r.filter((x) => x.base.includes(q) || x.symbol.includes(q));
    }
    if (spread !== "all") r = r.filter((x) => x.spreadCategory === spread);
    return sortRows(r, sortKey, sortDir).slice(0, pageSize);
  }, [rows, query, spread, sortKey, sortDir, pageSize]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  const Th = ({ k, label, align = "right" }: { k: SortKey; label: string; align?: "left" | "right" }) => (
    <button
      onClick={() => toggleSort(k)}
      className={cn(
        "flex w-full items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground",
        align === "right" ? "justify-end" : "justify-start"
      )}
    >
      {label}
      {sortKey === k && (sortDir === "desc" ? <ArrowDown className="size-3 text-primary" /> : <ArrowUp className="size-3 text-primary" />)}
    </button>
  );

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      {/* Filter bar */}
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol… e.g. BTC"
            className="w-full rounded-md border border-border bg-surface-elevated py-1.5 pl-7 pr-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
          />
        </div>
        <div className="flex overflow-hidden rounded-md border border-border bg-surface-elevated">
          {SPREADS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSpread(s.id)}
              className={cn(
                "px-2.5 py-1.5 font-mono text-[11px] font-semibold transition-colors",
                spread === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="rounded-md border border-border bg-surface-elevated px-2 py-1.5 font-mono text-[11px] text-foreground focus:border-primary/50 focus:outline-none"
        >
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} rows</option>)}
        </select>
        <button
          onClick={refresh}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-primary hover:bg-primary/20"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </button>
        <span className="font-mono text-[10px] text-muted-foreground">
          Last update: {updatedAt.toLocaleTimeString()} · {filtered.length}/{rows.length} pairs
        </span>
      </div>

      {/* Table */}
      <div className="panel min-h-0 flex-1 overflow-hidden">
        <div className="overflow-y-auto h-full scrollbar-thin">
          <table className="w-full border-separate border-spacing-0">
            <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur">
              <tr>
                <th className="border-b border-border px-3 py-2 text-left"><Th k={"changePct" as SortKey} label="Pair" align="left" /></th>
                <th className="border-b border-border px-3 py-2"><Th k="last" label="Last" /></th>
                <th className="border-b border-border px-3 py-2 hidden sm:table-cell"><Th k="changePct" label="24h %" /></th>
                <th className="border-b border-border px-3 py-2 hidden md:table-cell"><Th k="nearLowPct" label="Near 24h Low" /></th>
                <th className="border-b border-border px-3 py-2 hidden lg:table-cell"><Th k="spreadPct" label="Spread H-L" /></th>
                <th className="border-b border-border px-3 py-2"><Th k="quoteVolume" label="Volume" /></th>
                <th className="border-b border-border px-3 py-2 text-right hidden md:table-cell">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Signal</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const up = r.changePct >= 0;
                const nearLow = r.nearLowPct < 25;
                const nearHigh = r.nearLowPct > 75;
                const signal = nearLow && r.changePct < 0 ? { label: "Reversal Watch", cls: "bg-bull/15 text-bull border-bull/30" }
                  : nearHigh && r.changePct > 5 ? { label: "Overextended", cls: "bg-bear/15 text-bear border-bear/30" }
                  : Math.abs(r.changePct) > 8 ? { label: up ? "Momentum ↑" : "Breakdown ↓", cls: up ? "bg-bull/15 text-bull border-bull/30" : "bg-bear/15 text-bear border-bear/30" }
                  : { label: "Neutral", cls: "bg-muted/20 text-muted-foreground border-border" };
                return (
                  <tr
                    key={r.symbol}
                    onClick={() => navigate(`/spot?symbol=${r.symbol}`)}
                    className="group cursor-pointer transition-colors hover:bg-surface-hover"
                    title={`Analyze ${r.base}/USDT with AI`}
                  >
                    <td className="border-b border-border/50 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-foreground group-hover:text-primary">{r.base}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">/USDT</span>
                        <Sparkles className="size-3 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    </td>
                    <td className="border-b border-border/50 px-3 py-2 text-right font-mono text-sm tabular-nums">{formatPrice(r.last)}</td>
                    <td className={cn("border-b border-border/50 px-3 py-2 text-right font-mono text-xs font-semibold tabular-nums hidden sm:table-cell", up ? "text-bull" : "text-bear")}>
                      {up ? "+" : ""}{r.changePct.toFixed(2)}%
                    </td>
                    <td className="border-b border-border/50 px-3 py-2 hidden md:table-cell">
                      <div className="ml-auto flex w-32 items-center gap-2">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-elevated">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${r.nearLowPct}%`,
                              background: r.nearLowPct < 25 ? "hsl(var(--bull))" : r.nearLowPct > 75 ? "hsl(var(--bear))" : "hsl(var(--accent))",
                            }}
                          />
                        </div>
                        <span className="w-10 text-right font-mono text-[10px] text-muted-foreground">{r.nearLowPct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="border-b border-border/50 px-3 py-2 text-right font-mono text-xs hidden lg:table-cell">{r.spreadPct.toFixed(2)}%</td>
                    <td className="border-b border-border/50 px-3 py-2 text-right font-mono text-xs text-muted-foreground">${formatCompact(r.quoteVolume)}</td>
                    <td className="border-b border-border/50 px-3 py-2 text-right hidden md:table-cell">
                      <span className={cn("inline-block rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider", signal.cls)}>
                        {signal.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-12 text-center font-mono text-xs text-muted-foreground">No pairs match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
