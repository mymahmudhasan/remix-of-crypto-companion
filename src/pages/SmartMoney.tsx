import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import {
  Crosshair, Loader2, AlertCircle, Search, Filter, Activity, TrendingUp, TrendingDown,
  Sparkles, ArrowRight, CheckCircle2, XCircle, AlertTriangle, ListChecks, PlayCircle, Star,
  Zap, ShoppingCart, Rocket,
} from "lucide-react";
import { fetchKlines, fetch24h, formatPrice } from "@/lib/binance";
import { snapshotFromCandles, scoreSignal } from "@/lib/indicators";
import {
  detectCandleFootprints, detectFuturesFootprints, footprintBias, fetchOIHistory, fetchFundingRate,
  type Footprint, footprintMeta,
} from "@/lib/footprints";
import { SCANNER_UNIVERSE, tickerToRow } from "@/lib/scanner";
import { useFavorites } from "@/hooks/use-favorites";
import { CandleChart } from "@/components/CandleChart";
import { SaveCoachButton, type CoachPayload } from "@/components/SaveCoachButton";
import { cn } from "@/lib/utils";

const MTF_INTERVALS = ["1h", "4h", "1d"];
const TIMEFRAMES = ["15m", "1h", "4h", "1d"];
const SCAN_LIMIT = 40; // top liquid pairs

interface ScreenerEntry {
  symbol: string;
  changePct: number;
  quoteVolume: number;
  fps: Footprint[];
  bias: "bull" | "bear" | "neutral";
  bullScore: number;
  bearScore: number;
  topFp: Footprint | null;
}

export default function SmartMoney() {
  const [params, setParams] = useSearchParams();
  const initialSymbol = (params.get("symbol") || "BTCUSDT").toUpperCase();
  const [selected, setSelected] = useState(initialSymbol);
  const [interval, setInterval] = useState("1h");
  const [mode, setMode] = useState<"spot" | "futures">("futures");

  // ----- Screener -----
  const [screener, setScreener] = useState<ScreenerEntry[]>([]);
  const [screenerLoading, setScreenerLoading] = useState(true);
  const [screenerError, setScreenerError] = useState<string | null>(null);
  const [biasFilter, setBiasFilter] = useState<"all" | "bull" | "bear">("all");
  const [favOnly, setFavOnly] = useState(false);
  const { isFavorite, toggle } = useFavorites();
  const [search, setSearch] = useState("");

  const loadScreener = async () => {
    setScreenerLoading(true); setScreenerError(null);
    try {
      const universe = SCANNER_UNIVERSE.slice(0, SCAN_LIMIT);
      // Get 24h data for sort by volume / changePct
      const tickers = await fetch24h(universe);
      const ticker24Map = new Map(tickers.map((t) => [t.symbol, tickerToRow(t)]));
      const klinesArr = await Promise.all(
        universe.map((s) => fetchKlines(s, "1h", 100).catch(() => null))
      );
      const entries: ScreenerEntry[] = [];
      for (let i = 0; i < universe.length; i++) {
        const symbol = universe[i];
        const k = klinesArr[i];
        const t24 = ticker24Map.get(symbol);
        if (!k || k.length < 30) continue;
        const fps = detectCandleFootprints(k, { lookback: 30 });
        const { bias, bullScore, bearScore } = footprintBias(fps);
        if (fps.length === 0) continue;
        const topFp = [...fps].sort((a, b) => b.weight - a.weight)[0] ?? null;
        entries.push({
          symbol,
          changePct: t24?.changePct ?? 0,
          quoteVolume: t24?.quoteVolume ?? 0,
          fps,
          bias, bullScore, bearScore,
          topFp,
        });
      }
      // Sort by absolute footprint strength
      entries.sort((a, b) => Math.abs(b.bullScore - b.bearScore) - Math.abs(a.bullScore - a.bearScore));
      setScreener(entries);
    } catch (e: any) {
      setScreenerError(e.message ?? "Failed to scan");
    } finally {
      setScreenerLoading(false);
    }
  };

  useEffect(() => { loadScreener(); }, []);

  const filteredScreener = useMemo(() => {
    const q = search.trim().toUpperCase();
    return screener.filter((e) => {
      if (biasFilter !== "all" && e.bias !== biasFilter) return false;
      if (favOnly && !isFavorite(e.symbol)) return false;
      if (q && !e.symbol.includes(q)) return false;
      return true;
    });
  }, [screener, biasFilter, favOnly, isFavorite, search]);

  // ----- Detail (selected symbol) -----
  const [snap, setSnap] = useState<ReturnType<typeof snapshotFromCandles> | null>(null);
  const [mtf, setMtf] = useState<{ interval: string; bias: "bull" | "bear" | "neutral"; score: number }[]>([]);
  const [fps, setFps] = useState<Footprint[]>([]);
  const [fundingRate, setFundingRate] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const chartWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setDetailLoading(true); setDetailError(null);
    setSnap(null); setMtf([]); setFps([]); setFundingRate(null);

    const load = async () => {
      try {
        const primaryP = fetchKlines(selected, interval, 300);
        const extras = MTF_INTERVALS.filter((i) => i !== interval);
        const extraPs = extras.map((iv) => fetchKlines(selected, iv, 200));
        const futuresPs = mode === "futures"
          ? Promise.all([fetchOIHistory(selected, "1h", 24), fetchFundingRate(selected)])
          : Promise.resolve([null, null] as [null, null]);

        const [primary, ...extraK] = await Promise.all([primaryP, ...extraPs]);
        const [oiHistory, funding] = await futuresPs;
        if (cancelled) return;

        const ps = snapshotFromCandles(primary);
        setSnap(ps);

        const tfResults = extraK.map((k, i) => {
          const s = snapshotFromCandles(k);
          const sig = scoreSignal(s);
          return { interval: extras[i], bias: sig.bias, score: sig.score };
        });
        setMtf(tfResults);

        // Footprints
        const candleFps = detectCandleFootprints(primary, { lookback: 60 });
        const futFps = mode === "futures"
          ? detectFuturesFootprints(primary, { oiHistory: oiHistory ?? undefined, fundingRate: funding })
          : [];
        setFps([...candleFps, ...futFps].sort((a, b) => b.index - a.index));
        setFundingRate(funding);
      } catch (e: any) {
        if (!cancelled) setDetailError(e.message ?? "Failed to load");
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [selected, interval, mode]);

  // Sync selected -> URL
  useEffect(() => {
    const cur = params.get("symbol");
    if (cur !== selected) {
      const next = new URLSearchParams(params);
      next.set("symbol", selected);
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // ----- AI coach -----
  const [coach, setCoach] = useState<any | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);

  const runCoach = async () => {
    if (!snap) return;
    setCoachLoading(true); setCoachError(null); setCoach(null);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trade-coach`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          symbol: selected, interval, mode, snapshot: snap, multiTf: mtf,
          footprints: fps.slice(0, 12).map((f) => ({
            type: f.type, label: f.label, detail: f.detail,
            weight: f.weight, implication: f.implication,
          })),
          fundingRate, accountSize: 10000, maxLev: 10,
        }),
      });
      if (!resp.ok) {
        if (resp.status === 429) throw new Error("Rate limit hit. Wait a moment.");
        if (resp.status === 402) throw new Error("AI credits exhausted.");
        throw new Error(`Coach failed (${resp.status})`);
      }
      const data = await resp.json();
      setCoach(data.coach);
    } catch (e: any) {
      setCoachError(e.message);
    } finally {
      setCoachLoading(false);
    }
  };

  const detailBias = footprintBias(fps);

  return (
    <div className="grid h-full gap-2 overflow-hidden p-2 lg:grid-cols-[320px_1fr]">
      {/* Screener sidebar */}
      <div className="panel flex min-h-0 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Crosshair className="size-3.5 text-primary" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Smart Money Screener
          </h3>
          <button
            onClick={loadScreener}
            disabled={screenerLoading}
            className="ml-auto rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {screenerLoading ? <Loader2 className="size-3 animate-spin" /> : "Rescan"}
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-1.5 border-b border-border p-2">
          <div className="flex items-center gap-1.5 rounded border border-border bg-surface-elevated px-1.5">
            <Search className="size-3 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter symbols…"
              className="w-full bg-transparent py-1 font-mono text-[11px] outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          <div className="flex items-center gap-1">
            <Filter className="size-3 text-muted-foreground" />
            <div className="flex flex-1 overflow-hidden rounded border border-border bg-surface-elevated">
              {(["all", "bull", "bear"] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => setBiasFilter(b)}
                  className={cn(
                    "flex-1 py-1 font-mono text-[10px] font-bold uppercase",
                    biasFilter === b ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-hover"
                  )}
                >
                  {b}
                </button>
              ))}
            </div>
            <button
              onClick={() => setFavOnly((v) => !v)}
              className={cn(
                "flex items-center gap-1 rounded border px-1.5 py-1 font-mono text-[10px] font-bold uppercase",
                favOnly ? "border-warning bg-warning/10 text-warning" : "border-border bg-surface-elevated text-muted-foreground hover:text-foreground"
              )}
              title="Show only favorites"
            >
              <Star className={cn("size-3", favOnly && "fill-current")} />
            </button>
          </div>
        </div>

        {/* Screener list */}
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {screenerError && (
            <div className="m-2 flex items-start gap-1 rounded border border-destructive/30 bg-destructive/10 p-2 font-mono text-[10px] text-destructive">
              <AlertCircle className="mt-px size-3 shrink-0" /> {screenerError}
            </div>
          )}
          {screenerLoading && screener.length === 0 && (
            <div className="flex items-center justify-center gap-2 p-4 font-mono text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Scanning {SCAN_LIMIT} pairs…
            </div>
          )}
          {!screenerLoading && filteredScreener.length === 0 && (
            <div className="p-4 text-center font-mono text-[11px] text-muted-foreground">
              No footprints detected with current filters.
            </div>
          )}
          {filteredScreener.map((e) => {
            const isSel = e.symbol === selected;
            const biasCls = e.bias === "bull"
              ? "border-l-bull"
              : e.bias === "bear" ? "border-l-bear" : "border-l-border";
            return (
              <button
                key={e.symbol}
                onClick={() => setSelected(e.symbol)}
                className={cn(
                  "flex w-full items-center gap-2 border-b border-border border-l-2 px-2 py-1.5 text-left transition-colors",
                  biasCls,
                  isSel ? "bg-primary/10" : "hover:bg-surface-hover"
                )}
              >
                <button
                  onClick={(ev) => { ev.stopPropagation(); toggle(e.symbol); }}
                  className="shrink-0"
                  title={isFavorite(e.symbol) ? "Unfavorite" : "Favorite"}
                >
                  <Star className={cn("size-3", isFavorite(e.symbol) ? "fill-warning text-warning" : "text-muted-foreground/40 hover:text-warning")} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="font-bold">{e.symbol.replace("USDT", "")}</span>
                    <span className={cn(
                      "tabular-nums",
                      e.changePct > 0 ? "text-bull" : e.changePct < 0 ? "text-bear" : "text-muted-foreground"
                    )}>
                      {e.changePct >= 0 ? "+" : ""}{e.changePct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between font-mono text-[9px] text-muted-foreground">
                    <span className="truncate">{e.topFp?.label ?? "—"}</span>
                    <span>
                      <span className="text-bull">+{e.bullScore}</span>
                      <span className="mx-px">/</span>
                      <span className="text-bear">-{e.bearScore}</span>
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail */}
      <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
        {/* Header */}
        <div className="panel flex shrink-0 flex-wrap items-center gap-2 p-2">
          <h2 className="font-mono text-base font-bold neon-text">
            {selected.replace("USDT", "/USDT")}
          </h2>
          <span className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase",
            detailBias.bias === "bull" ? "border-bull/40 bg-bull/10 text-bull"
            : detailBias.bias === "bear" ? "border-bear/40 bg-bear/10 text-bear"
            : "border-border text-muted-foreground"
          )}>
            Footprint Bias: {detailBias.bias}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            +{detailBias.bullScore} / -{detailBias.bearScore}
          </span>

          <div className="ml-auto flex items-center gap-1">
            <div className="flex overflow-hidden rounded border border-border bg-surface-elevated">
              {(["spot", "futures"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "px-2 py-0.5 font-mono text-[10px] font-bold uppercase",
                    mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-hover"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="flex overflow-hidden rounded border border-border bg-surface-elevated">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  onClick={() => setInterval(tf)}
                  className={cn(
                    "px-2 py-0.5 font-mono text-[10px] font-bold uppercase",
                    interval === tf ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-hover"
                  )}
                >
                  {tf}
                </button>
              ))}
            </div>
            <Link
              to={mode === "futures" ? `/futures?symbol=${selected}` : `/spot?symbol=${selected}`}
              className="flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[10px] font-bold uppercase text-primary hover:bg-primary/20"
              title="Build a full trade plan"
            >
              {mode === "futures" ? <Rocket className="size-3" /> : <ShoppingCart className="size-3" />}
              Plan
              <ArrowRight className="size-3" />
            </Link>
          </div>
        </div>

        {/* Body — chart + footprints + coach */}
        <div className="grid min-h-0 flex-1 gap-2 overflow-hidden lg:grid-cols-[1fr_320px]">
          {/* Left: chart + coach */}
          <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
            <div ref={chartWrapRef} className="panel h-[260px] shrink-0 overflow-hidden p-2">
              <CandleChart
                symbol={selected}
                interval={interval}
                markers={fps.map((f) => ({
                  time: f.time,
                  position: f.implication === "bull" ? "belowBar" : f.implication === "bear" ? "aboveBar" : "inBar",
                  shape: f.implication === "bull" ? "arrowUp" : f.implication === "bear" ? "arrowDown" : "circle",
                  color: f.implication === "bull" ? "#22c55e" : f.implication === "bear" ? "#ef4444" : "#a3a3a3",
                  text: f.label.split(" ")[0],
                }))}
              />
            </div>

            {/* Coach panel */}
            <div className="panel min-h-0 flex-1 overflow-y-auto scrollbar-thin">
              {!coach && !coachLoading && (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                  <Sparkles className="size-9 text-muted-foreground/40" />
                  <h3 className="font-mono text-base font-bold neon-text">Winning Trade Coach</h3>
                  <p className="max-w-md font-mono text-xs leading-relaxed text-muted-foreground">
                    Combine the live indicators, multi-timeframe bias, and the institutional footprints detected on {selected.replace("USDT", "")} to build a strict checklist + step-by-step playbook.
                  </p>
                  <button
                    onClick={runCoach}
                    disabled={!snap}
                    className="flex items-center gap-2 rounded-md border border-primary bg-primary px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-primary-foreground transition-all hover:bg-primary-glow disabled:opacity-50"
                  >
                    <Zap className="size-3.5" /> Build Winning Setup
                  </button>
                  {coachError && (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 font-mono text-[11px] text-destructive">
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {coachError}
                    </div>
                  )}
                </div>
              )}
              {coachLoading && (
                <div className="flex h-full items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Coaching the setup…
                </div>
              )}
              {coach && (
                <CoachView
                  coach={coach}
                  symbol={selected}
                  interval={interval}
                  mode={mode}
                  entryPrice={snap?.price ?? 0}
                  onRerun={runCoach}
                  getChartEl={() => chartWrapRef.current}
                />
              )}
            </div>
          </div>

          {/* Right: footprints list */}
          <FootprintsPanel fps={fps} loading={detailLoading} error={detailError} fundingRate={fundingRate} mode={mode} />
        </div>
      </div>
    </div>
  );
}

function FootprintsPanel({
  fps, loading, error, fundingRate, mode,
}: { fps: Footprint[]; loading: boolean; error: string | null; fundingRate: number | null; mode: "spot" | "futures" }) {
  return (
    <div className="panel flex min-h-0 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Activity className="size-3.5 text-primary" />
        <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Institutional Footprints
        </h3>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{fps.length}</span>
      </div>
      {mode === "futures" && fundingRate !== null && (
        <div className="border-b border-border px-3 py-1.5 font-mono text-[10px]">
          <span className="text-muted-foreground">Funding (8h): </span>
          <span className={cn(
            "font-bold tabular-nums",
            fundingRate > 0.0003 ? "text-bear" : fundingRate < -0.0003 ? "text-bull" : "text-foreground"
          )}>
            {(fundingRate * 100).toFixed(4)}%
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {loading && (
          <div className="flex items-center justify-center gap-2 p-4 font-mono text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Detecting…
          </div>
        )}
        {error && (
          <div className="m-2 flex items-start gap-1 rounded border border-destructive/30 bg-destructive/10 p-2 font-mono text-[10px] text-destructive">
            <AlertCircle className="mt-px size-3 shrink-0" /> {error}
          </div>
        )}
        {!loading && fps.length === 0 && !error && (
          <div className="p-4 text-center font-mono text-[11px] text-muted-foreground">
            No footprints in the last 60 bars. Try another timeframe.
          </div>
        )}
        {fps.map((f, i) => {
          const meta = footprintMeta(f.type);
          const tone = meta.tone === "bull"
            ? "border-l-bull text-bull"
            : meta.tone === "bear" ? "border-l-bear text-bear" : "border-l-border text-muted-foreground";
          const Icon = meta.tone === "bull" ? TrendingUp : meta.tone === "bear" ? TrendingDown : Activity;
          return (
            <div key={i} className={cn("flex flex-col gap-0.5 border-b border-border border-l-2 p-2", tone)}>
              <div className="flex items-center gap-1.5">
                <Icon className="size-3 shrink-0" />
                <span className="font-mono text-[11px] font-bold">{f.label}</span>
                <span className="ml-auto flex items-center gap-px" title={`Weight ${f.weight}/5`}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <span key={j} className={cn("h-2 w-0.5 rounded-sm", j < f.weight ? "bg-current" : "bg-current/20")} />
                  ))}
                </span>
              </div>
              <div className="font-mono text-[10px] text-foreground/70">{f.detail}</div>
              <div className="flex items-center justify-between font-mono text-[9px] text-muted-foreground">
                <span>@ ${formatPrice(f.price)}</span>
                <span>{new Date(f.time * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CoachView({
  coach, symbol, interval, mode, entryPrice, onRerun, getChartEl,
}: {
  coach: CoachPayload;
  symbol: string;
  interval: string;
  mode: "spot" | "futures";
  entryPrice: number;
  onRerun: () => void;
  getChartEl: () => HTMLElement | null;
}) {
  const verdictMeta: Record<string, { cls: string; label: string }> = {
    GO: { cls: "border-bull bg-bull/10 text-bull", label: "▶ GO" },
    WAIT: { cls: "border-warning bg-warning/10 text-warning", label: "⏸ WAIT" },
    SKIP: { cls: "border-bear bg-bear/10 text-bear", label: "✕ SKIP" },
  };
  const v = verdictMeta[coach.verdict] ?? verdictMeta.WAIT;
  const sideMeta: Record<string, { Icon: any; cls: string }> = {
    long: { Icon: TrendingUp, cls: "text-bull" },
    short: { Icon: TrendingDown, cls: "text-bear" },
    neutral: { Icon: Activity, cls: "text-muted-foreground" },
  };
  const sm = sideMeta[coach.side] ?? sideMeta.neutral;

  const passes = coach.checklist.filter((c: any) => c.status === "pass").length;
  const total = coach.checklist.length;

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Verdict header */}
      <div className={cn("flex flex-wrap items-end justify-between gap-3 rounded-lg border-2 p-4", v.cls)}>
        <div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{symbol.replace("USDT", "/USDT")} · Coach Verdict</span>
          <h2 className="flex items-center gap-2 font-mono text-3xl font-black uppercase neon-text">
            {v.label}
            <sm.Icon className={cn("size-6", sm.cls)} />
            <span className={cn("text-2xl", sm.cls)}>{coach.side.toUpperCase()}</span>
          </h2>
          <p className="mt-1 max-w-2xl font-mono text-xs leading-snug text-foreground/85">{coach.headline}</p>
        </div>
        <div className="text-right">
          <div className="font-mono text-[10px] uppercase text-muted-foreground">Confidence</div>
          <div className="font-mono text-2xl font-bold">{coach.confidence}<span className="text-sm text-muted-foreground">/100</span></div>
          <div className="font-mono text-[10px] text-muted-foreground">Checklist {passes}/{total}</div>
        </div>
      </div>

      {/* Levels strip */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Lvl label="Entry Zone" value={`${formatPrice(coach.levels.entryLow)} – ${formatPrice(coach.levels.entryHigh)}`} tone="primary" />
        <Lvl label="Stop Loss" value={`$${formatPrice(coach.levels.stop)}`} tone="bear" />
        <Lvl label="Targets" value={coach.levels.targets.map((t: number) => `$${formatPrice(t)}`).join(" → ")} tone="bull" />
        <Lvl
          label={coach.levels.leverage ? `Leverage / Risk` : "Risk"}
          value={`${coach.levels.leverage ? `${coach.levels.leverage}× · ` : ""}${coach.levels.riskPct}%`}
          tone="primary"
        />
      </div>

      {/* Checklist */}
      <div className="panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <ListChecks className="size-3.5 text-primary" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">Setup Checklist</h3>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{passes} pass · {total - passes} pending</span>
        </div>
        <div className="space-y-1.5">
          {coach.checklist.map((c: any, i: number) => {
            const meta = c.status === "pass"
              ? { Icon: CheckCircle2, cls: "text-bull border-bull/30 bg-bull/10" }
              : c.status === "warn" ? { Icon: AlertTriangle, cls: "text-warning border-warning/30 bg-warning/10" }
              : { Icon: XCircle, cls: "text-bear border-bear/30 bg-bear/10" };
            return (
              <div key={i} className={cn("grid gap-2 rounded-md border p-2 sm:grid-cols-[200px_1fr_auto]", meta.cls)}>
                <div className="flex items-center gap-1.5">
                  <meta.Icon className="size-3.5 shrink-0" />
                  <span className="font-mono text-xs font-bold">{c.item}</span>
                </div>
                <p className="font-mono text-[11px] leading-snug text-foreground/80">{c.note}</p>
                <div className="flex items-center gap-px" title={`Weight ${c.weight}/5`}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <span key={j} className={cn("h-3 w-1 rounded-sm", j < c.weight ? "bg-current" : "bg-current/20")} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Playbook */}
      <div className="panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <PlayCircle className="size-3.5 text-primary" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">Step-by-Step Playbook</h3>
        </div>
        <ol className="space-y-1.5">
          {coach.playbook.map((p: any) => (
            <li key={p.step} className="flex items-start gap-2 rounded-md border border-border bg-surface-elevated p-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 font-mono text-[11px] font-black text-primary">
                {p.step}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold">{p.title}</span>
                  {typeof p.price === "number" && (
                    <span className="font-mono text-[11px] font-bold tabular-nums text-primary">
                      ${formatPrice(p.price)}
                    </span>
                  )}
                </div>
                <p className="font-mono text-[11px] leading-snug text-foreground/80">{p.action}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Invalidation */}
      <div className="rounded-md border border-bear/30 bg-bear/10 p-3">
        <div className="flex items-center gap-2">
          <XCircle className="size-3.5 text-bear" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-bear">Invalidation</h3>
        </div>
        <p className="mt-1 font-mono text-xs text-foreground/85">{coach.invalidation}</p>
      </div>

      {coach.skipReasons?.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning/10 p-3">
          <h3 className="mb-1 font-mono text-xs font-semibold uppercase tracking-wider text-warning">Why SKIP</h3>
          <ul className="space-y-0.5">
            {coach.skipReasons.map((r: string, i: number) => (
              <li key={i} className="flex items-start gap-1.5 font-mono text-xs">
                <span className="mt-1 size-1 shrink-0 rounded-full bg-warning" />
                <span className="text-foreground/85">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SaveCoachButton
          mode={mode}
          symbol={symbol}
          interval={interval}
          entryPrice={entryPrice}
          coach={coach}
          getChartEl={getChartEl}
        />
        <button
          onClick={onRerun}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 font-mono text-[10px] uppercase text-muted-foreground hover:border-primary hover:text-primary"
        >
          <Sparkles className="size-3" /> Re-run coach
        </button>
        <p className="ml-auto font-mono text-[10px] text-muted-foreground">⚠ Educational only — not financial advice.</p>
      </div>
    </div>
  );
}

function Lvl({ label, value, tone }: { label: string; value: string; tone: "bull" | "bear" | "primary" }) {
  const cls = tone === "bull" ? "border-bull/30 text-bull" : tone === "bear" ? "border-bear/30 text-bear" : "border-primary/30 text-primary";
  return (
    <div className={cn("rounded-md border bg-surface-elevated p-2", cls)}>
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-mono text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}
