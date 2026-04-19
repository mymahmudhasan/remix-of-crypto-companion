import { useEffect, useMemo, useState } from "react";
import { Flame, TrendingUp, TrendingDown, Activity, RefreshCw } from "lucide-react";
import { fetch24h, fetchKlines, formatCompact, formatPrice } from "@/lib/binance";
import { SCANNER_UNIVERSE, tickerToRow, type ScannerRow } from "@/lib/scanner";
import { cn } from "@/lib/utils";

interface SpikeRow {
  symbol: string;
  base: string;
  last: number;
  changePct1h: number;
  volRatio: number; // recent vol vs 20-bar avg
  thrustPct: number; // close vs prev close
  verdict: "pump" | "dump" | "watch";
}

export default function PumpDump() {
  const [movers, setMovers] = useState<ScannerRow[]>([]);
  const [spikes, setSpikes] = useState<SpikeRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);
  const [scannedCount, setScannedCount] = useState(0);

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

        if (volRatio >= 1.8 && Math.abs(thrustPct) >= 0.5) {
          found.push({
            symbol: sym,
            base: sym.replace("USDT", ""),
            last: last.close,
            changePct1h,
            volRatio,
            thrustPct,
            verdict: thrustPct > 0 ? (volRatio >= 5 ? "pump" : "watch") : "dump",
          });
        }
      } catch (e) {
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

  const gainers = useMemo(() => [...movers].sort((a, b) => b.changePct - a.changePct).slice(0, 10), [movers]);
  const losers = useMemo(() => [...movers].sort((a, b) => a.changePct - b.changePct).slice(0, 10), [movers]);

  return (
    <div className="grid h-full gap-2 overflow-hidden p-2 lg:grid-cols-2 lg:grid-rows-[1fr_1fr]">
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
                <th className="border-b border-border px-3 py-2 text-left">Pair</th>
                <th className="border-b border-border px-3 py-2 text-right">Verdict</th>
                <th className="border-b border-border px-3 py-2 text-right">Last</th>
                <th className="border-b border-border px-3 py-2 text-right hidden sm:table-cell">Thrust 5m</th>
                <th className="border-b border-border px-3 py-2 text-right hidden md:table-cell">Δ 1h</th>
                <th className="border-b border-border px-3 py-2 text-right">Vol ×</th>
              </tr>
            </thead>
            <tbody>
              {spikes.map((s) => {
                const v = s.verdict;
                const color = v === "pump" ? "bg-bull/15 text-bull border-bull/30" : v === "dump" ? "bg-bear/15 text-bear border-bear/30" : "bg-warning/15 text-warning border-warning/30";
                const label = v === "pump" ? "🚀 PUMP" : v === "dump" ? "💥 DUMP" : "👀 WATCH";
                return (
                  <tr key={s.symbol} className="hover:bg-surface-hover">
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
                  </tr>
                );
              })}
              {!scanning && spikes.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-10 text-center font-mono text-xs text-muted-foreground">
                  {error
                    ? <span className="text-bear">⚠ {error}</span>
                    : scannedCount > 0
                      ? `Scanned ${scannedCount} pairs · no spikes ≥ 2.5× vol & |Δ| ≥ 0.8% / 5m. Markets are calm — try Rescan in a few min.`
                      : "Loading…"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
          Last refresh: {updatedAt.toLocaleTimeString()} · alerts trigger at vol ≥ 2.5× baseline & |Δ| ≥ 0.8% / 5m
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
