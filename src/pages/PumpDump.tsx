import { Fragment, useEffect, useMemo, useState } from "react";
import { Flame, TrendingUp, TrendingDown, Activity, RefreshCw, Search, ChevronDown, Target, Shield } from "lucide-react";
import { fetch24h, fetchKlines, formatCompact, formatPrice } from "@/lib/binance";
import { SCANNER_UNIVERSE, tickerToRow, type ScannerRow } from "@/lib/scanner";
import { cn } from "@/lib/utils";

interface TradeSetup {
  side: "long" | "short";
  entry: number;
  entryLow: number;
  entryHigh: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskPct: number;     // % from entry to stop
  rr1: number;
  rr2: number;
  rr3: number;
  atr: number;
  rationale: string;
}

interface SpikeRow {
  symbol: string;
  base: string;
  last: number;
  changePct1h: number;
  volRatio: number; // recent vol vs 20-bar avg
  thrustPct: number; // close vs prev close
  verdict: "pump" | "dump" | "watch";
  setup: TradeSetup;
}

function buildSetup(
  last: number,
  atr: number,
  thrustPct: number,
  volRatio: number,
  verdict: "pump" | "dump" | "watch"
): TradeSetup {
  // Pumps & "watch" with positive thrust → fade short into resistance OR breakout long.
  // Heuristic: extreme pumps (vol ≥ 5×, thrust ≥ 2%) → mean-reversion SHORT (exhaustion).
  // Moderate pumps → breakout LONG with tight invalidation.
  // Dumps → mean-reversion LONG (capitulation bounce).
  const extremePump = verdict === "pump" && (volRatio >= 5 || Math.abs(thrustPct) >= 2);
  const side: "long" | "short" = verdict === "dump" ? "long" : extremePump ? "short" : "long";
  const a = atr > 0 ? atr : last * 0.01;

  let entry: number, stop: number, tp1: number, tp2: number, tp3: number, rationale: string;
  if (side === "long" && verdict === "dump") {
    // Buy the bounce — entry slightly above current, stop below recent low.
    entry = last + a * 0.15;
    stop = last - a * 1.2;
    tp1 = entry + a * 1.0;
    tp2 = entry + a * 2.0;
    tp3 = entry + a * 3.5;
    rationale = "Capitulation bounce — mean-reversion long after volume dump";
  } else if (side === "short") {
    // Fade the pump — entry slightly above last, stop above thrust high.
    entry = last + a * 0.2;
    stop = last + a * 1.5;
    tp1 = entry - a * 1.2;
    tp2 = entry - a * 2.4;
    tp3 = entry - a * 3.8;
    rationale = "Exhaustion fade — extreme volume + price thrust = late buyers";
  } else {
    // Breakout long — buy continuation, stop below thrust candle.
    entry = last + a * 0.1;
    stop = last - a * 1.0;
    tp1 = entry + a * 1.2;
    tp2 = entry + a * 2.5;
    tp3 = entry + a * 4.0;
    rationale = "Volume breakout continuation — momentum long with trailing stop";
  }

  const entryLow = Math.min(entry, side === "long" ? entry - a * 0.15 : entry);
  const entryHigh = Math.max(entry, side === "short" ? entry + a * 0.15 : entry);
  const risk = Math.abs(entry - stop);
  const riskPct = (risk / entry) * 100;
  const rr1 = Math.abs(tp1 - entry) / risk;
  const rr2 = Math.abs(tp2 - entry) / risk;
  const rr3 = Math.abs(tp3 - entry) / risk;

  return { side, entry, entryLow, entryHigh, stop, tp1, tp2, tp3, riskPct, rr1, rr2, rr3, atr: a, rationale };
}

export default function PumpDump() {
  const [movers, setMovers] = useState<ScannerRow[]>([]);
  const [spikes, setSpikes] = useState<SpikeRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);
  const [scannedCount, setScannedCount] = useState(0);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (sym: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym); else next.add(sym);
      return next;
    });
  };

  const refreshMovers = async () => {
    try {
      const data = await fetch24h(SCANNER_UNIVERSE);
      const rows = data.map((t) => tickerToRow(t)).filter(Boolean) as ScannerRow[];
      setMovers(rows);
      setUpdatedAt(new Date());
      setError(null);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Unable to reach Binance from your network");
    }
  };

  const runSpikeScan = async () => {
    setScanning(true);
    setScanProgress(0);
    setScannedCount(0);
    const found: SpikeRow[] = [];
    let succeeded = 0;
    let failed = 0;
    // Scan top 100 by liquidity (universe is already sorted by volume rank)
    const subset = SCANNER_UNIVERSE.slice(0, 100);
    for (let i = 0; i < subset.length; i++) {
      const sym = subset[i];
      try {
        const k = await fetchKlines(sym, "5m", 30);
        succeeded++;
        if (k.length < 22) { setScanProgress(((i + 1) / subset.length) * 100); continue; }
        const last = k[k.length - 1];
        const prev = k[k.length - 2];
        const recentVols = k.slice(-3).map((c) => c.volume);
        const baselineVols = k.slice(-23, -3).map((c) => c.volume);
        const recentAvg = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
        const baseAvg = baselineVols.reduce((a, b) => a + b, 0) / baselineVols.length || 1e-9;
        const volRatio = recentAvg / baseAvg;
        const thrustPct = ((last.close - prev.close) / prev.close) * 100;
        const changePct1h = ((last.close - k[Math.max(0, k.length - 13)].close) / k[Math.max(0, k.length - 13)].close) * 100;

        // ATR (14) on 5m candles for stop/target sizing
        const atrWindow = k.slice(-15);
        let atrSum = 0;
        for (let j = 1; j < atrWindow.length; j++) {
          const c = atrWindow[j], p = atrWindow[j - 1];
          atrSum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
        }
        const atr = atrSum / Math.max(1, atrWindow.length - 1);

        if (volRatio >= 1.8 && Math.abs(thrustPct) >= 0.5) {
          const verdict: "pump" | "dump" | "watch" = thrustPct > 0 ? (volRatio >= 5 ? "pump" : "watch") : "dump";
          found.push({
            symbol: sym,
            base: sym.replace("USDT", ""),
            last: last.close,
            changePct1h,
            volRatio,
            thrustPct,
            verdict,
            setup: buildSetup(last.close, atr, thrustPct, volRatio, verdict),
          });
        }
      } catch {
        failed++;
      }
      setScanProgress(((i + 1) / subset.length) * 100);
      await new Promise((r) => setTimeout(r, 30));
    }
    found.sort((a, b) => b.volRatio - a.volRatio);
    setSpikes(found);
    setScannedCount(succeeded);
    if (succeeded === 0 && failed > 0) {
      setError("Binance API is unreachable from your network (likely region-blocked). Try a VPN or different network.");
    } else if (succeeded > 0) {
      setError(null);
    }
    setScanning(false);
  };

  useEffect(() => {
    refreshMovers();
    runSpikeScan();
    const id = setInterval(refreshMovers, 15_000);
    return () => clearInterval(id);
  }, []);

  const q = search.trim().toUpperCase();
  const matchSym = (s: string) => !q || s.toUpperCase().includes(q);
  const gainers = useMemo(
    () => [...movers].filter((r) => matchSym(r.symbol)).sort((a, b) => b.changePct - a.changePct).slice(0, 10),
    [movers, q]
  );
  const losers = useMemo(
    () => [...movers].filter((r) => matchSym(r.symbol)).sort((a, b) => a.changePct - b.changePct).slice(0, 10),
    [movers, q]
  );
  const filteredSpikes = useMemo(() => spikes.filter((s) => matchSym(s.symbol)), [spikes, q]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden p-2">
      {/* Search bar */}
      <div className="panel flex shrink-0 items-center gap-2 p-2">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter pumps/dumps by symbol… (BTC, PEPE, SOL)"
            className="w-full rounded-md border border-border bg-surface-elevated py-1.5 pl-7 pr-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
          />
        </div>
        {q && (
          <button
            onClick={() => setSearch("")}
            className="rounded border border-border bg-surface-elevated px-2 py-1 font-mono text-[10px] uppercase text-muted-foreground hover:border-primary hover:text-primary"
          >
            Clear
          </button>
        )}
      </div>

      <div className="grid min-h-0 flex-1 gap-2 overflow-hidden lg:grid-cols-2 lg:grid-rows-[1fr_1fr]">
      {/* Gainers */}
      <MoverList title="Top Gainers · 24h" rows={gainers} variant="bull" icon={TrendingUp} />
      {/* Losers */}
      <MoverList title="Top Losers · 24h" rows={losers} variant="bear" icon={TrendingDown} />

      {/* Spike scanner */}
      <div className="panel col-span-1 flex min-h-0 flex-col lg:col-span-2">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <Flame className="size-3.5 text-warning" />
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Live Spike Detector · 5m volume thrust
            </h3>
          </div>
          <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
            {scanning && <span>Scanning {Math.round(scanProgress)}%</span>}
            <span>{spikes.length} alerts</span>
            <button
              onClick={runSpikeScan}
              disabled={scanning}
              className="flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3", scanning && "animate-spin")} /> Rescan
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <table className="w-full border-separate border-spacing-0">
            <thead className="sticky top-0 bg-surface/95 backdrop-blur">
              <tr className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="border-b border-border px-2 py-2 text-left w-6"></th>
                <th className="border-b border-border px-3 py-2 text-left">Pair</th>
                <th className="border-b border-border px-3 py-2 text-right">Verdict</th>
                <th className="border-b border-border px-3 py-2 text-right">Last</th>
                <th className="border-b border-border px-3 py-2 text-right hidden sm:table-cell">Thrust 5m</th>
                <th className="border-b border-border px-3 py-2 text-right hidden md:table-cell">Δ 1h</th>
                <th className="border-b border-border px-3 py-2 text-right">Vol ×</th>
                <th className="border-b border-border px-3 py-2 text-right">Setup</th>
              </tr>
            </thead>
            <tbody>
              {filteredSpikes.map((s) => {
                const v = s.verdict;
                const color = v === "pump" ? "bg-bull/15 text-bull border-bull/30" : v === "dump" ? "bg-bear/15 text-bear border-bear/30" : "bg-warning/15 text-warning border-warning/30";
                const label = v === "pump" ? "🚀 PUMP" : v === "dump" ? "💥 DUMP" : "👀 WATCH";
                const isOpen = expanded.has(s.symbol);
                const sd = s.setup;
                const sideColor = sd.side === "long" ? "text-bull bg-bull/15 border-bull/30" : "text-bear bg-bear/15 border-bear/30";
                return (
                  <Fragment key={s.symbol}>
                    <tr className="cursor-pointer hover:bg-surface-hover" onClick={() => toggleExpand(s.symbol)}>
                      <td className="border-b border-border/50 px-2 py-2 text-muted-foreground">
                        <ChevronDown className={cn("size-3.5 transition-transform", isOpen ? "rotate-0" : "-rotate-90")} />
                      </td>
                      <td className="border-b border-border/50 px-3 py-2 font-mono text-sm font-semibold">{s.base}<span className="text-[10px] text-muted-foreground">/USDT</span></td>
                      <td className="border-b border-border/50 px-3 py-2 text-right">
                        <span className={cn("inline-block rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider", color)}>{label}</span>
                      </td>
                      <td className="border-b border-border/50 px-3 py-2 text-right font-mono text-sm tabular-nums">{formatPrice(s.last)}</td>
                      <td className={cn("border-b border-border/50 px-3 py-2 text-right font-mono text-xs font-semibold tabular-nums hidden sm:table-cell", s.thrustPct >= 0 ? "text-bull" : "text-bear")}>
                        {s.thrustPct >= 0 ? "+" : ""}{s.thrustPct.toFixed(2)}%
                      </td>
                      <td className={cn("border-b border-border/50 px-3 py-2 text-right font-mono text-xs tabular-nums hidden md:table-cell", s.changePct1h >= 0 ? "text-bull" : "text-bear")}>
                        {s.changePct1h >= 0 ? "+" : ""}{s.changePct1h.toFixed(2)}%
                      </td>
                      <td className="border-b border-border/50 px-3 py-2 text-right font-mono text-sm font-bold text-warning">{s.volRatio.toFixed(1)}×</td>
                      <td className="border-b border-border/50 px-3 py-2 text-right">
                        <span className={cn("inline-block rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider", sideColor)}>
                          {sd.side} · {sd.rr2.toFixed(1)}R
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${s.symbol}-setup`} className="bg-surface-elevated/40">
                        <td colSpan={8} className="border-b border-border/50 px-4 py-3">
                          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <span className={cn("inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider", sideColor)}>
                                  {sd.side === "long" ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                                  {sd.side === "long" ? "LONG" : "SHORT"}
                                </span>
                                <span className="font-mono text-[11px] text-muted-foreground">{sd.rationale}</span>
                              </div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] sm:grid-cols-3">
                                <Field label="Entry zone" value={`${formatPrice(sd.entryLow)} – ${formatPrice(sd.entryHigh)}`} />
                                <Field label="Stop loss" value={formatPrice(sd.stop)} valueClass="text-bear" icon={<Shield className="size-3 text-bear" />} />
                                <Field label="Risk" value={`${sd.riskPct.toFixed(2)}%`} valueClass="text-warning" />
                                <Field label="TP1" value={formatPrice(sd.tp1)} valueClass="text-bull" icon={<Target className="size-3 text-bull" />} extra={`${sd.rr1.toFixed(2)}R`} />
                                <Field label="TP2" value={formatPrice(sd.tp2)} valueClass="text-bull" icon={<Target className="size-3 text-bull" />} extra={`${sd.rr2.toFixed(2)}R`} />
                                <Field label="TP3" value={formatPrice(sd.tp3)} valueClass="text-bull" icon={<Target className="size-3 text-bull" />} extra={`${sd.rr3.toFixed(2)}R`} />
                              </div>
                              <div className="font-mono text-[10px] text-muted-foreground">
                                ATR(14·5m): {formatPrice(sd.atr)} · Reward potential up to <span className="font-bold text-bull">{sd.rr3.toFixed(1)}× risk</span> if TP3 hits.
                              </div>
                            </div>
                            <div className="flex items-end justify-end">
                              <a
                                href={`/?symbol=${s.symbol}`}
                                className="rounded border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary hover:bg-primary/20"
                              >
                                Open chart →
                              </a>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {!scanning && filteredSpikes.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-10 text-center font-mono text-xs text-muted-foreground">
                  {error
                    ? <span className="text-bear">⚠ {error}</span>
                    : q && spikes.length > 0
                      ? `No spikes match "${q}".`
                      : scannedCount > 0
                        ? `Scanned ${scannedCount} pairs · no spikes ≥ 1.8× vol & |Δ| ≥ 0.5% / 5m. Markets are calm — try Rescan in a few min.`
                        : "Loading…"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
          Last refresh: {updatedAt.toLocaleTimeString()} · alerts trigger at vol ≥ 1.8× baseline & |Δ| ≥ 0.5% / 5m · top 100 pairs
        </div>
      </div>
      </div>
    </div>
  );
}

function MoverList({ title, rows, variant, icon: Icon }: { title: string; rows: ScannerRow[]; variant: "bull" | "bear"; icon: any }) {
  return (
    <div className="panel flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Icon className={cn("size-3.5", variant === "bull" ? "text-bull" : "text-bear")} />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        </div>
        <Activity className="size-3 text-muted-foreground" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {rows.map((r) => {
          const up = r.changePct >= 0;
          return (
            <div key={r.symbol} className="flex items-center gap-3 border-b border-border/40 px-3 py-2 hover:bg-surface-hover">
              <span className="flex-1 font-mono text-sm font-semibold">{r.base}<span className="text-[10px] text-muted-foreground">/USDT</span></span>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">${formatPrice(r.last)}</span>
              <span className={cn("w-20 text-right font-mono text-sm font-bold tabular-nums", up ? "text-bull" : "text-bear")}>
                {up ? "+" : ""}{r.changePct.toFixed(2)}%
              </span>
              <span className="hidden w-16 text-right font-mono text-[10px] text-muted-foreground sm:inline">${formatCompact(r.quoteVolume)}</span>
            </div>
          );
        })}
        {rows.length === 0 && <div className="p-6 text-center font-mono text-xs text-muted-foreground">Loading…</div>}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  valueClass,
  icon,
  extra,
}: {
  label: string;
  value: string;
  valueClass?: string;
  icon?: React.ReactNode;
  extra?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 rounded border border-border/60 bg-surface px-2 py-1">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="flex items-baseline gap-1.5 tabular-nums">
        <span className={cn("font-semibold", valueClass)}>{value}</span>
        {extra && <span className="text-[10px] text-muted-foreground">{extra}</span>}
      </span>
    </div>
  );
}
