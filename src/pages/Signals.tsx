import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Sparkles, TrendingUp, TrendingDown, Loader2, AlertCircle, Target, Shield, Flame, Clock, Zap, ExternalLink } from "lucide-react";
import { fetchPremiumSignals, type PremiumSignalsResponse, type PremiumSignal } from "@/lib/premium-signals";
import { formatPrice } from "@/lib/binance";
import { MiniSetupChart } from "@/components/MiniSetupChart";
import { SaveSignalButton } from "@/components/SaveSignalButton";
import { SignalsFilterBar, DEFAULT_FILTERS, type SignalsFilterState } from "@/components/SignalsFilterBar";
import { cn } from "@/lib/utils";

const REFRESH_MS = 15 * 60 * 1000; // 15 minutes

export default function Signals() {
  const navigate = useNavigate();
  const [data, setData] = useState<PremiumSignalsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [nextRunIn, setNextRunIn] = useState<number>(REFRESH_MS);
  const [filters, setFilters] = useState<SignalsFilterState>(DEFAULT_FILTERS);
  const timerRef = useRef<number | null>(null);

  const visibleSignals = useMemo(() => {
    if (!data) return [];
    const filtered = data.signals.filter((s) => {
      if (filters.side !== "all" && s.side !== filters.side) return false;
      if (filters.timeframe !== "all" && s.timeframe !== filters.timeframe) return false;
      if (s.conviction < filters.minConviction) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (filters.sortBy === "risk_reward") return b.risk_reward - a.risk_reward;
      return b.conviction - a.conviction;
    });
  }, [data, filters]);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchPremiumSignals();
      setData(r);
      setLastRun(new Date());
      setNextRunIn(REFRESH_MS);
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  // Initial + interval
  useEffect(() => {
    run();
    const id = window.setInterval(run, REFRESH_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countdown
  useEffect(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setNextRunIn((n) => Math.max(0, n - 1000));
    }, 1000);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [lastRun]);

  const mins = Math.floor(nextRunIn / 60000);
  const secs = Math.floor((nextRunIn % 60000) / 1000);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header strip */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface/40 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md border border-primary/40 bg-primary/10 glow-bull">
            <Sparkles className="size-4 text-primary" />
          </div>
          <div className="leading-tight">
            <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-foreground neon-text">
              Premium Signals
            </h2>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              AI-curated · Top 30 USDT perps · auto-refresh 15 min
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase text-muted-foreground">
          {lastRun && (
            <span className="hidden md:inline">
              Updated {lastRun.toLocaleTimeString()} · next in {mins}:{secs.toString().padStart(2, "0")}
            </span>
          )}
          <button
            onClick={run}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md border border-primary/50 bg-primary/10 px-3 py-1.5 text-[11px] font-bold text-primary transition-all hover:bg-primary/20 disabled:opacity-60"
          >
            {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            {loading ? "Scanning…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Market summary */}
      {data && (
        <div className="shrink-0 border-b border-border bg-surface/20 px-4 py-2 font-mono text-[11px] text-muted-foreground">
          <span className="text-primary">Market read:</span> {data.market_summary}
          <span className="ml-3 text-[10px] opacity-60">
            ({data.shortlist_size} of {data.universe_size} pairs shortlisted)
          </span>
        </div>
      )}

      {/* Filter & sort bar */}
      {data && (
        <SignalsFilterBar
          value={filters}
          onChange={setFilters}
          totalCount={data.signals.length}
          visibleCount={visibleSignals.length}
        />
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-bold">Could not generate signals</div>
              <div className="text-destructive/80">{error}</div>
            </div>
          </div>
        )}

        {loading && !data && (
          <div className="flex h-full flex-col items-center justify-center gap-3 font-mono text-xs text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-primary" />
            <div>Scanning top 30 perps · pulling CVD, funding, OI, indicators…</div>
            <div className="text-[10px] opacity-60">This takes ~15-25 seconds</div>
          </div>
        )}

        {data && visibleSignals.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
            <Filter className="size-5 opacity-60" />
            <div>No signals match your filters</div>
            <button
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="rounded border border-primary/40 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary hover:bg-primary/20"
            >
              Reset filters
            </button>
          </div>
        )}

        {data && visibleSignals.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-2">
            {visibleSignals.map((s, i) => (
              <SignalCard key={`${s.symbol}-${i}`} signal={s} onOpen={() => navigate(`/futures?symbol=${s.symbol}`)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SignalCard({ signal, onOpen }: { signal: PremiumSignal; onOpen: () => void }) {
  const isLong = signal.side === "long";
  const entryMid = (signal.entry_low + signal.entry_high) / 2;
  const slDistPct = Math.abs(((signal.stop - entryMid) / entryMid) * 100);
  const t1DistPct = Math.abs(((signal.targets[0] - entryMid) / entryMid) * 100);

  const convictionColor =
    signal.conviction >= 80 ? "text-bull border-bull/50 bg-bull/10"
    : signal.conviction >= 65 ? "text-primary border-primary/50 bg-primary/10"
    : "text-amber-400 border-amber-500/40 bg-amber-500/10";

  return (
    <div className="panel flex flex-col gap-3 p-3">
      {/* Card header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={cn(
            "flex size-9 items-center justify-center rounded-md border",
            isLong ? "border-bull/50 bg-bull/10 text-bull" : "border-bear/50 bg-bear/10 text-bear"
          )}>
            {isLong ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-2 font-mono text-sm font-bold text-foreground">
              {signal.symbol.replace("USDT", "/USDT")}
              <span className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase",
                isLong ? "bg-bull/20 text-bull" : "bg-bear/20 text-bear"
              )}>
                {signal.side}
              </span>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {signal.setup_name}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className={cn(
            "flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-bold",
            convictionColor
          )}>
            <Flame className="size-2.5" /> {signal.conviction}
          </div>
          <div className="flex items-center gap-1 font-mono text-[9px] uppercase text-muted-foreground">
            <Clock className="size-2.5" /> {signal.timeframe} · {signal.leverage}x
          </div>
        </div>
      </div>

      {/* Mini chart */}
      <MiniSetupChart
        symbol={signal.symbol}
        entryLow={signal.entry_low}
        entryHigh={signal.entry_high}
        stop={signal.stop}
        targets={signal.targets}
      />

      {/* Levels grid */}
      <div className="grid grid-cols-3 gap-1.5 font-mono text-[10px]">
        <Stat label="Entry zone" value={`${formatPrice(signal.entry_low)} – ${formatPrice(signal.entry_high)}`} />
        <Stat label="Stop loss" value={formatPrice(signal.stop)} valueClass="text-bear" sub={`-${slDistPct.toFixed(2)}%`} />
        <Stat label="R:R" value={signal.risk_reward.toFixed(2)} valueClass="text-primary" />
        <Stat label="T1" value={formatPrice(signal.targets[0])} valueClass="text-bull" sub={`+${t1DistPct.toFixed(2)}%`} />
        <Stat label="T2" value={formatPrice(signal.targets[1])} valueClass="text-bull" />
        <Stat label="T3" value={formatPrice(signal.targets[2])} valueClass="text-bull" />
      </div>

      {/* Reasoning */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <Zap className="size-2.5 text-primary" /> Why this setup
        </div>
        <ul className="space-y-0.5 font-mono text-[11px] text-foreground/90">
          {signal.reasoning.map((r, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-primary">▸</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Catalysts + invalidation */}
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <InfoBlock icon={<Target className="size-2.5 text-bull" />} label="Trigger" text={signal.catalysts} />
        <InfoBlock icon={<Shield className="size-2.5 text-bear" />} label="Invalidation" text={signal.invalidation} />
      </div>

      {/* Actions */}
      <div className="mt-1 flex gap-2">
        <SaveSignalButton signal={signal} />
        <button
          onClick={onOpen}
          className="flex flex-1 items-center justify-center gap-1.5 rounded border border-border bg-surface-elevated px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          <ExternalLink className="size-3" /> Open in chart
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, valueClass, sub }: { label: string; value: string; valueClass?: string; sub?: string }) {
  return (
    <div className="rounded border border-border bg-surface/40 px-1.5 py-1">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-[11px] font-bold tabular-nums text-foreground", valueClass)}>{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function InfoBlock({ icon, label, text }: { icon: React.ReactNode; label: string; text: string }) {
  return (
    <div className="rounded border border-border bg-surface/40 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-0.5 font-mono text-[10px] leading-snug text-foreground/90">{text}</div>
    </div>
  );
}
