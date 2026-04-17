import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bookmark, Trophy, X, Trash2, Loader2, ArrowUpRight,
  TrendingUp, TrendingDown, Filter, BarChart3, AlertCircle, Clock, Radio,
} from "lucide-react";
import { plansClient, SAVED_PLANS_TABLE } from "@/lib/plans-client";
import { formatPrice, subscribeMiniTickers } from "@/lib/binance";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** Compute PnL % from entry to current price (leverage-aware for futures). */
function computePnlPct(side: string, action: string | null, entry: number, price: number, leverage: number | null): number {
  if (!entry || !price) return 0;
  const isShort = side === "short" || action === "sell";
  const raw = ((price - entry) / entry) * 100 * (isShort ? -1 : 1);
  return raw * (leverage && leverage > 1 ? leverage : 1);
}

/** Decide if an open plan should auto-resolve given the latest price. */
function checkAutoResolve(
  row: { status: string; side: string; action: string | null; stop: number; targets: number[] },
  price: number
): "won" | "lost" | null {
  if (row.status !== "open") return null;
  const isShort = row.side === "short" || row.action === "sell";
  const tp1 = row.targets?.[0];
  if (isShort) {
    if (price >= row.stop) return "lost";
    if (tp1 && price <= tp1) return "won";
  } else {
    if (price <= row.stop) return "lost";
    if (tp1 && price >= tp1) return "won";
  }
  return null;
}

interface SavedPlanRow {
  id: string;
  mode: "spot" | "futures";
  symbol: string;
  interval: string;
  side: string;
  action: string | null;
  leverage: number | null;
  entry_low: number;
  entry_high: number;
  stop: number;
  targets: number[];
  conviction: number | null;
  risk_pct: number | null;
  entry_price: number | null;
  chart_snapshot: string | null;
  status: "open" | "won" | "lost" | "cancelled";
  closed_price: number | null;
  notes: string | null;
  created_at: string;
}

type FilterTab = "all" | "open" | "won" | "lost";

export default function Plans() {
  const [rows, setRows] = useState<SavedPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterTab>("all");
  const [modeFilter, setModeFilter] = useState<"all" | "spot" | "futures">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  /** Tracks ids we've already auto-resolved this session so we don't retry on every tick. */
  const resolvedRef = useRef<Set<string>>(new Set());

  const load = async () => {
    setLoading(true); setError(null);
    const { data, error } = await plansClient
      .from(SAVED_PLANS_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) setError(error.message);
    else setRows((data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Subscribe to live mini-tickers for every distinct symbol that has an open plan.
  // Reconnects whenever the open-symbol set changes.
  const openSymbols = useMemo(
    () => Array.from(new Set(rows.filter((r) => r.status === "open").map((r) => r.symbol))).sort(),
    [rows]
  );
  const openSymbolsKey = openSymbols.join(",");

  useEffect(() => {
    if (openSymbols.length === 0) return;
    const unsub = subscribeMiniTickers(openSymbols, (m) => {
      const price = parseFloat(m.c);
      if (!isFinite(price)) return;
      setLivePrices((prev) => (prev[m.s] === price ? prev : { ...prev, [m.s]: price }));
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSymbolsKey]);

  // Auto-resolve open plans whose live price has hit TP1 or stop.
  useEffect(() => {
    for (const r of rows) {
      if (r.status !== "open") continue;
      if (resolvedRef.current.has(r.id)) continue;
      const price = livePrices[r.symbol];
      if (!price) continue;
      const verdict = checkAutoResolve(r, price);
      if (!verdict) continue;
      resolvedRef.current.add(r.id);
      // Optimistic UI
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: verdict, closed_price: price } : x)));
      // Persist
      plansClient
        .from(SAVED_PLANS_TABLE)
        .update({ status: verdict, closed_price: price } as any)
        .eq("id", r.id)
        .then(({ error }) => {
          if (error) {
            // Roll back if the DB write fails so we don't desync
            resolvedRef.current.delete(r.id);
            setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: "open", closed_price: null } : x)));
            toast.error("Auto-resolve failed", { description: error.message });
            return;
          }
          toast[verdict === "won" ? "success" : "error"](
            `${r.symbol.replace("USDT", "")} ${verdict === "won" ? "hit TP1 ✓" : "stopped out ✗"}`,
            { description: `Auto-closed at $${formatPrice(price)}` }
          );
        });
    }
  }, [livePrices, rows]);

  const stats = useMemo(() => {
    const total = rows.length;
    const open = rows.filter((r) => r.status === "open").length;
    const won = rows.filter((r) => r.status === "won").length;
    const lost = rows.filter((r) => r.status === "lost").length;
    const closed = won + lost;
    const winRate = closed > 0 ? (won / closed) * 100 : 0;
    return { total, open, won, lost, winRate };
  }, [rows]);

  const filtered = rows.filter((r) =>
    (tab === "all" || r.status === tab) &&
    (modeFilter === "all" || r.mode === modeFilter)
  );

  const setStatus = async (id: string, status: SavedPlanRow["status"]) => {
    setBusyId(id);
    const { error } = await plansClient
      .from(SAVED_PLANS_TABLE)
      .update({ status } as any)
      .eq("id", id);
    setBusyId(null);
    if (error) {
      toast.error("Update failed", { description: error.message });
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this saved plan?")) return;
    setBusyId(id);
    const { error } = await plansClient.from(SAVED_PLANS_TABLE).delete().eq("id", id);
    setBusyId(null);
    if (error) {
      toast.error("Delete failed", { description: error.message });
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden p-2">
      {/* Stats header */}
      <div className="grid shrink-0 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={Bookmark} label="Total Plans" value={String(stats.total)} tone="primary" />
        <StatCard icon={Clock} label="Open" value={String(stats.open)} tone="warning" />
        <StatCard icon={Trophy} label="Won" value={String(stats.won)} tone="bull" />
        <StatCard icon={X} label="Lost" value={String(stats.lost)} tone="bear" />
        <StatCard
          icon={BarChart3}
          label="Win Rate"
          value={`${stats.winRate.toFixed(1)}%`}
          tone={stats.winRate >= 60 ? "bull" : stats.winRate >= 40 ? "warning" : "bear"}
          sub={`${stats.won}W / ${stats.lost}L`}
        />
      </div>

      {/* Filters */}
      <div className="panel flex shrink-0 flex-wrap items-center gap-2 p-2">
        <Filter className="size-3.5 text-muted-foreground" />
        <div className="flex overflow-hidden rounded-md border border-border bg-surface-elevated">
          {(["all", "open", "won", "lost"] as FilterTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-3 py-1 font-mono text-[11px] font-semibold uppercase",
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-hover"
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-md border border-border bg-surface-elevated">
          {(["all", "spot", "futures"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setModeFilter(m)}
              className={cn(
                "px-3 py-1 font-mono text-[11px] font-semibold uppercase",
                modeFilter === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-hover"
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {/* List */}
      <div className="panel min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {loading && (
          <div className="flex h-full items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading plans…
          </div>
        )}
        {error && (
          <div className="m-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 font-mono text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <Bookmark className="size-10 text-muted-foreground/40" />
            <h2 className="font-mono text-lg font-bold neon-text">No plans yet</h2>
            <p className="max-w-md font-mono text-xs text-muted-foreground">
              Generate a plan on Spot or Futures and click <span className="text-primary">Save Plan</span> to start tracking your trade journal and win-rate.
            </p>
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div className="grid gap-3 p-3 lg:grid-cols-2 xl:grid-cols-3">
            {filtered.map((r) => (
              <PlanCard
                key={r.id}
                row={r}
                livePrice={livePrices[r.symbol] ?? null}
                onStatus={setStatus}
                onDelete={remove}
                busy={busyId === r.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanCard({
  row, livePrice, onStatus, onDelete, busy,
}: {
  row: SavedPlanRow;
  livePrice: number | null;
  onStatus: (id: string, s: SavedPlanRow["status"]) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const sideMeta =
    row.side === "long" || row.action === "buy"
      ? { cls: "border-bull/40 bg-bull/10 text-bull", Icon: TrendingUp, label: "LONG" }
      : row.side === "short" || row.action === "sell"
      ? { cls: "border-bear/40 bg-bear/10 text-bear", Icon: TrendingDown, label: "SHORT" }
      : { cls: "border-border bg-muted/20 text-muted-foreground", Icon: TrendingUp, label: row.side.toUpperCase() };

  const statusMeta: Record<SavedPlanRow["status"], string> = {
    open: "border-warning/40 bg-warning/10 text-warning",
    won: "border-bull/40 bg-bull/10 text-bull",
    lost: "border-bear/40 bg-bear/10 text-bear",
    cancelled: "border-border bg-muted/20 text-muted-foreground",
  };

  const tradeUrl = row.mode === "spot" ? `/spot?symbol=${row.symbol}` : `/futures?symbol=${row.symbol}`;
  const created = new Date(row.created_at);

  return (
    <div className="panel flex flex-col gap-2 p-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase", sideMeta.cls)}>
            <sideMeta.Icon className="size-3" /> {sideMeta.label}{row.leverage ? ` ${row.leverage}×` : ""}
          </span>
          <Link to={tradeUrl} className="font-mono text-sm font-bold neon-text hover:underline">
            {row.symbol.replace("USDT", "/USDT")}
          </Link>
          <span className="font-mono text-[10px] uppercase text-muted-foreground">{row.interval}</span>
          <span className="rounded border border-border px-1 py-px font-mono text-[9px] uppercase text-muted-foreground">
            {row.mode}
          </span>
        </div>
        <span className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase", statusMeta[row.status])}>
          {row.status}
        </span>
      </div>

      {/* Snapshot */}
      {row.chart_snapshot && (
        <img
          src={row.chart_snapshot}
          alt={`${row.symbol} ${row.interval} chart`}
          className="rounded-md border border-border"
        />
      )}

      {/* Levels */}
      <div className="grid grid-cols-3 gap-1.5 font-mono text-[11px]">
        <Cell label="Entry" value={`${formatPrice(row.entry_low)}–${formatPrice(row.entry_high)}`} tone="bull" />
        <Cell label="Stop" value={`$${formatPrice(row.stop)}`} tone="bear" />
        <Cell
          label="Targets"
          value={row.targets.length ? row.targets.map((t) => `$${formatPrice(t)}`).join(" → ") : "—"}
          tone="primary"
        />
      </div>

      {row.entry_price && (
        <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
          <span>Entry price @ save: <span className="font-bold tabular-nums text-foreground">${formatPrice(row.entry_price)}</span></span>
          {row.conviction != null && <span>Conviction: <span className="text-foreground">{row.conviction}/100</span></span>}
        </div>
      )}

      {/* Live PnL — only meaningful for open plans (or to show closed_price for resolved ones). */}
      {row.status === "open" && livePrice !== null && (() => {
        const entry = row.entry_price ?? (row.entry_low + row.entry_high) / 2;
        const pnl = computePnlPct(row.side, row.action, entry, livePrice, row.leverage);
        const tp1 = row.targets?.[0];
        const isShort = row.side === "short" || row.action === "sell";
        // Distance to TP1 / Stop as % of the entry→target / entry→stop journey
        const towardTpPct = tp1
          ? Math.max(0, Math.min(100, ((isShort ? entry - livePrice : livePrice - entry) /
              (isShort ? entry - tp1 : tp1 - entry)) * 100))
          : 0;
        const towardStopPct = Math.max(0, Math.min(100, ((isShort ? livePrice - entry : entry - livePrice) /
          (isShort ? row.stop - entry : entry - row.stop)) * 100));
        return (
          <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-elevated p-1.5">
            <div className="flex items-center justify-between font-mono text-[10px]">
              <span className="flex items-center gap-1 text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-bull" /> LIVE
                <span className="font-bold tabular-nums text-foreground">${formatPrice(livePrice)}</span>
              </span>
              <span className={cn(
                "font-bold tabular-nums",
                pnl > 0 ? "text-bull" : pnl < 0 ? "text-bear" : "text-muted-foreground"
              )}>
                {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                {row.leverage && row.leverage > 1 ? <span className="ml-1 text-muted-foreground">@{row.leverage}×</span> : null}
              </span>
            </div>
            {/* Twin progress bars: green = toward TP1, red = toward Stop. Whichever fills first wins. */}
            <div className="flex h-1 gap-px overflow-hidden rounded-sm">
              <div className="relative h-full flex-1 bg-bull/15">
                <div className="h-full bg-bull transition-all" style={{ width: `${towardTpPct}%` }} />
              </div>
              <div className="relative h-full flex-1 bg-bear/15">
                <div className="ml-auto h-full bg-bear transition-all" style={{ width: `${towardStopPct}%` }} />
              </div>
            </div>
            <div className="flex justify-between font-mono text-[9px] text-muted-foreground">
              <span>TP1 {towardTpPct.toFixed(0)}%</span>
              <span>Stop {towardStopPct.toFixed(0)}%</span>
            </div>
          </div>
        );
      })()}

      {row.status !== "open" && row.closed_price !== null && row.closed_price !== undefined && (
        <div className="flex justify-between rounded-md border border-border bg-surface-elevated p-1.5 font-mono text-[10px]">
          <span className="text-muted-foreground">Closed @ <span className="font-bold tabular-nums text-foreground">${formatPrice(row.closed_price)}</span></span>
          {row.entry_price && (() => {
            const pnl = computePnlPct(row.side, row.action, row.entry_price, row.closed_price!, row.leverage);
            return (
              <span className={cn("font-bold tabular-nums", pnl > 0 ? "text-bull" : pnl < 0 ? "text-bear" : "text-muted-foreground")}>
                {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
              </span>
            );
          })()}
        </div>
      )}

      {/* Footer */}
      <div className="mt-auto flex items-center gap-1 border-t border-border pt-2">
        <span className="font-mono text-[10px] text-muted-foreground">
          {created.toLocaleDateString()} {created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
        <Link
          to={tradeUrl}
          className="ml-auto flex items-center gap-1 rounded border border-border px-1.5 py-1 font-mono text-[10px] uppercase text-muted-foreground hover:border-primary hover:text-primary"
        >
          Open <ArrowUpRight className="size-3" />
        </Link>

        {row.status === "open" ? (
          <>
            <button
              disabled={busy}
              onClick={() => onStatus(row.id, "won")}
              className="flex items-center gap-1 rounded border border-bull/40 bg-bull/10 px-1.5 py-1 font-mono text-[10px] font-bold uppercase text-bull hover:bg-bull/20"
            >
              <Trophy className="size-3" /> Win
            </button>
            <button
              disabled={busy}
              onClick={() => onStatus(row.id, "lost")}
              className="flex items-center gap-1 rounded border border-bear/40 bg-bear/10 px-1.5 py-1 font-mono text-[10px] font-bold uppercase text-bear hover:bg-bear/20"
            >
              <X className="size-3" /> Loss
            </button>
          </>
        ) : (
          <button
            disabled={busy}
            onClick={() => onStatus(row.id, "open")}
            className="rounded border border-border px-1.5 py-1 font-mono text-[10px] uppercase text-muted-foreground hover:text-foreground"
          >
            Reopen
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => onDelete(row.id)}
          className="rounded border border-border px-1.5 py-1 text-muted-foreground hover:border-destructive hover:text-destructive"
          title="Delete plan"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone: "bull" | "bear" | "primary" }) {
  const cls = tone === "bull" ? "border-bull/30 text-bull" : tone === "bear" ? "border-bear/30 text-bear" : "border-primary/30 text-primary";
  return (
    <div className={cn("rounded border bg-surface-elevated p-1.5", cls)}>
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="truncate font-mono text-[11px] font-bold tabular-nums">{value}</div>
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, tone, sub,
}: { icon: any; label: string; value: string; tone: "bull" | "bear" | "warning" | "primary"; sub?: string }) {
  const cls =
    tone === "bull" ? "border-bull/30 text-bull"
    : tone === "bear" ? "border-bear/30 text-bear"
    : tone === "warning" ? "border-warning/30 text-warning"
    : "border-primary/30 text-primary";
  return (
    <div className={cn("rounded-md border bg-surface-elevated p-3", cls)}>
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1 font-mono text-2xl font-black tabular-nums">{value}</div>
      {sub && <div className="font-mono text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
