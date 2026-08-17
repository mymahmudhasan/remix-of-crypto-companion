import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell, BellRing, Loader2, RefreshCw, TrendingDown, TrendingUp,
  ArrowUpRight, ArrowDownRight, Target, ShieldAlert, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { Panel, PanelHeader, SectionLabel } from "@/components/ui/panel";
import { formatPrice } from "@/lib/binance";
import { notificationPermission, requestNotificationPermission } from "@/lib/signal-alerts";
import {
  scanUniverse, rangeAlertsEnabled, setRangeAlertsEnabled, markUnseen,
  notifyRangeAlert, alertKey, RANGE_UNIVERSE, type RangeAlert,
} from "@/lib/range-alerts";
import { cn } from "@/lib/utils";

const REFRESH_MS = 5 * 60_000;
type Filter = "all" | "high" | "low";

const STAGE_LABEL: Record<RangeAlert["stage"], string> = {
  at: "AT LEVEL",
  near: "NEAR",
  approaching: "APPROACHING",
};

function ChanceBar({ value, kind }: { value: number; kind: RangeAlert["kind"] }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-surface-elevated">
      <div
        className={cn("h-full rounded-full", kind === "high" ? "bg-bear" : "bg-bull")}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function AlertRow({ a }: { a: RangeAlert }) {
  const [open, setOpen] = useState(false);
  const isHigh = a.kind === "high";
  const tone = isHigh ? "bear" : "bull";

  return (
    <div className="border-b border-border/60 last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover/50"
      >
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded border",
            isHigh ? "border-bear/40 bg-bear/10 text-bear" : "border-bull/40 bg-bull/10 text-bull",
          )}
        >
          {isHigh ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[12.5px] font-bold text-foreground">
              {a.symbol.replace("USDT", "/USDT")}
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-[1px] font-mono text-[9px] font-bold uppercase tracking-wider",
                a.stage === "at"
                  ? isHigh ? "bg-bear/20 text-bear" : "bg-bull/20 text-bull"
                  : "bg-surface-elevated text-muted-foreground",
              )}
            >
              {STAGE_LABEL[a.stage]} {a.lookbackDays}D {isHigh ? "HIGH" : "LOW"}
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-[1px] font-mono text-[9px] font-bold uppercase tracking-wider",
                isHigh ? "bg-bear/10 text-bear" : "bg-bull/10 text-bull",
              )}
            >
              {isHigh ? "Fade / short" : "Buy & hold"}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{a.action}</p>
        </div>

        <div className="hidden w-[92px] shrink-0 flex-col gap-1 sm:flex">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Touch {a.touchChance}%
          </span>
          <ChanceBar value={a.touchChance} kind={a.kind} />
        </div>

        <div className="shrink-0 text-right">
          <div className="font-mono text-[12px] font-semibold text-foreground">${formatPrice(a.price)}</div>
          <div className={cn("font-mono text-[10px]", `text-${tone}`)}>
            {a.distancePct.toFixed(1)}% away
          </div>
        </div>

        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="grid grid-cols-1 gap-3 border-t border-border/50 bg-surface/40 px-3 py-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <SectionLabel>Trade setup</SectionLabel>
            <Metric label="Bias" value={a.bias.toUpperCase()} tone={isHigh ? "bear" : "bull"} />
            <Metric label="Entry" value={`$${formatPrice(a.entry)}`} />
            <Metric label="Stop" value={`$${formatPrice(a.stop)}`} tone="bear" icon={<ShieldAlert className="size-3" />} />
            <Metric label="R:R (T2)" value={`${a.rr.toFixed(2)}R`} />
          </div>
          <div className="space-y-1.5">
            <SectionLabel>Targets</SectionLabel>
            {a.targets.map((t, i) => (
              <Metric
                key={i}
                label={`T${i + 1}`}
                value={`$${formatPrice(t)}`}
                tone={isHigh ? "bear" : "bull"}
                icon={isHigh ? <ArrowDownRight className="size-3" /> : <ArrowUpRight className="size-3" />}
              />
            ))}
            <Metric label={`${a.lookbackDays}D ${isHigh ? "high" : "low"}`} value={`$${formatPrice(a.level)}`} />
            <Metric label="ATR" value={a.atrPct !== null ? `${a.atrPct.toFixed(1)}%` : "—"} />
          </div>
          <div className="space-y-1.5">
            <SectionLabel>Why</SectionLabel>
            <ul className="space-y-1">
              {a.reasons.map((r, i) => (
                <li key={i} className="flex gap-1.5 text-[11.5px] leading-snug text-muted-foreground">
                  <Target className="mt-[3px] size-3 shrink-0 text-primary" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            <p className="pt-1 text-[11px] leading-snug text-muted-foreground/80">
              {isHigh
                ? "Range top = supply. Take the opposite side (short) with a tight stop above the high; invalidation is a daily close above it."
                : "Range bottom = demand. Accumulate here and hold tight — stop just below the low, scale out into the range mid/top."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({
  label, value, tone, icon,
}: { label: string; value: string; tone?: "bull" | "bear"; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-border/60 bg-surface-elevated/40 px-2 py-1">
      <span className="flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">
        {icon}{label}
      </span>
      <span
        className={cn(
          "font-mono text-[11.5px] font-semibold",
          tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

const RangeAlerts = () => {
  const [alerts, setAlerts] = useState<RangeAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [minChance, setMinChance] = useState(40);
  const [notify, setNotify] = useState(false);
  const notifyRef = useRef(false);
  const [updated, setUpdated] = useState<Date | null>(null);

  useEffect(() => {
    const on = rangeAlertsEnabled();
    setNotify(on);
    notifyRef.current = on;
  }, []);

  const run = useCallback(async () => {
    setLoading(true);
    setProgress(0);
    const res = await scanUniverse(RANGE_UNIVERSE, (done, total) =>
      setProgress(Math.round((done / total) * 100)));
    setAlerts(res);
    setUpdated(new Date());
    setLoading(false);
    if (notifyRef.current) {
      for (const a of res.filter((x) => x.stage === "at" || x.touchChance >= 75)) {
        if (markUnseen(a)) notifyRangeAlert(a);
      }
    }
  }, []);

  useEffect(() => {
    run();
    const t = window.setInterval(run, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [run]);

  const toggleNotify = async () => {
    if (notify) {
      setRangeAlertsEnabled(false);
      setNotify(false);
      notifyRef.current = false;
      toast.info("Level alerts muted");
      return;
    }
    if (notificationPermission() === "unsupported") {
      toast.error("Notifications not supported in this browser");
      return;
    }
    const granted = await requestNotificationPermission();
    if (!granted) {
      toast.error("Notification permission denied");
      return;
    }
    setRangeAlertsEnabled(true);
    setNotify(true);
    notifyRef.current = true;
    toast.success("Level alerts ON", {
      description: "You'll be pinged when a token hits — or is likely to hit — a 30D/90D high or low.",
    });
  };

  const shown = alerts.filter(
    (a) => (filter === "all" || a.kind === filter) && a.touchChance >= minChance,
  );
  const atHigh = alerts.filter((a) => a.kind === "high" && a.stage === "at").length;
  const atLow = alerts.filter((a) => a.kind === "low" && a.stage === "at").length;

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="flex flex-col gap-4 p-3 md:p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-foreground">Level Alerts</h1>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              Tokens at — or likely to reach — a 30D / 90D range extreme. Highs are fade (opposite-direction)
              setups; lows are buy-and-hold-tight zones.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleNotify}
              className={cn(
                "flex items-center gap-1.5 rounded border px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors",
                notify
                  ? "border-warning/50 bg-warning/10 text-warning"
                  : "border-border bg-surface/40 text-muted-foreground hover:border-primary/50 hover:text-primary",
              )}
            >
              {notify ? <BellRing className="size-3 animate-pulse" /> : <Bell className="size-3" />}
              Alerts {notify ? "On" : "Off"}
            </button>
            <button
              onClick={run}
              disabled={loading}
              className="flex items-center gap-1.5 rounded border border-border bg-surface/40 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3", loading && "animate-spin")} />
              Rescan
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <Stat label="At range high" value={atHigh} tone="bear" hint="Fade / take profit" />
          <Stat label="At range low" value={atLow} tone="bull" hint="Buy & hold tight" />
          <Stat label="Watching" value={RANGE_UNIVERSE.length} hint="USDT pairs · daily" />
          <Stat
            label="Last scan"
            value={updated ? updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
            hint="Auto every 5 min"
          />
        </div>

        <Panel>
          <PanelHeader
            title="Range extremes"
            meta={loading ? `Scanning ${progress}%` : `${shown.length} alerts`}
            icon={<BellRing className="size-3.5" />}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex overflow-hidden rounded border border-border">
                  {(["all", "high", "low"] as Filter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={cn(
                        "px-2 py-1 font-mono text-[9.5px] font-bold uppercase tracking-wider transition-colors",
                        filter === f
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {f === "all" ? "All" : f === "high" ? "Highs" : "Lows"}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">
                  Chance ≥ {minChance}%
                  <input
                    type="range"
                    min={5}
                    max={90}
                    step={5}
                    value={minChance}
                    onChange={(e) => setMinChance(Number(e.target.value))}
                    className="h-1 w-20 accent-primary"
                  />
                </label>
              </div>
            }
          />
          {loading && alerts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-muted-foreground">
              <Loader2 className="size-5 animate-spin text-primary" />
              <span className="font-mono text-[10.5px] uppercase tracking-wider">Scanning daily ranges · {progress}%</span>
            </div>
          ) : shown.length === 0 ? (
            <div className="py-14 text-center text-[12.5px] text-muted-foreground">
              No token is near a range extreme with ≥ {minChance}% touch chance right now.
            </div>
          ) : (
            <div>
              {shown.map((a) => <AlertRow key={alertKey(a)} a={a} />)}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
};

function Stat({
  label, value, hint, tone,
}: { label: string; value: string | number; hint?: string; tone?: "bull" | "bear" }) {
  return (
    <div className="panel px-3 py-2">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-display text-lg font-bold leading-tight",
          tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-foreground",
        )}
      >
        {value}
      </div>
      {hint && <div className="text-[10.5px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default RangeAlerts;
