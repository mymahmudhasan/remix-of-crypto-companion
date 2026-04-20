import { Target, Shield, Flame, Clock, Zap, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { formatPrice } from "@/lib/binance";
import { MiniSetupChart } from "@/components/MiniSetupChart";
import { WinChanceBadge } from "@/components/WinChanceBadge";
import { cn } from "@/lib/utils";

/**
 * Compact "trade setup guideline" card styled like the Signals tab.
 * Shows entry zone, stop, R:R, T1–T3 with % distances, reasoning bullets,
 * trigger + invalidation, and a mini setup chart.
 */
interface Props {
  symbol: string;
  side: "long" | "short" | "neutral";
  setupName: string;
  timeframe?: string;
  leverage?: number;
  conviction: number;
  entryLow: number;
  entryHigh: number;
  stop: number;
  targets: number[];
  reasoning: string[];
  trigger?: string;
  invalidation?: string;
}

export function TradeSetupSummary({
  symbol, side, setupName, timeframe, leverage, conviction,
  entryLow, entryHigh, stop, targets, reasoning, trigger, invalidation,
}: Props) {
  const isLong = side === "long";
  const isNeutral = side === "neutral";
  const entryMid = (entryLow + entryHigh) / 2;
  const slDistPct = entryMid > 0 ? Math.abs(((stop - entryMid) / entryMid) * 100) : 0;
  const risk = Math.abs(entryMid - stop);
  const firstTarget = targets[0];
  const t1DistPct = firstTarget && entryMid > 0 ? Math.abs(((firstTarget - entryMid) / entryMid) * 100) : 0;
  const rr = firstTarget && risk > 0 ? Math.abs(firstTarget - entryMid) / risk : 0;

  const SideIcon = isLong ? TrendingUp : isNeutral ? Activity : TrendingDown;
  const sideCls = isLong
    ? "border-bull/50 bg-bull/10 text-bull"
    : isNeutral
    ? "border-border bg-surface-elevated text-muted-foreground"
    : "border-bear/50 bg-bear/10 text-bear";
  const sideBadgeCls = isLong
    ? "bg-bull/20 text-bull"
    : isNeutral
    ? "bg-muted/30 text-muted-foreground"
    : "bg-bear/20 text-bear";

  const convictionColor =
    conviction >= 80 ? "text-bull border-bull/50 bg-bull/10"
    : conviction >= 65 ? "text-primary border-primary/50 bg-primary/10"
    : "text-amber-400 border-amber-500/40 bg-amber-500/10";

  return (
    <div className="panel flex flex-col gap-3 p-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={cn("flex size-9 items-center justify-center rounded-md border", sideCls)}>
            <SideIcon className="size-4" />
          </div>
          <div className="leading-tight">
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-sm font-bold text-foreground">
              <span>{symbol.replace("USDT", "/USDT")}</span>
              <span className={cn("rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase", sideBadgeCls)}>
                {side}
              </span>
              {!isNeutral && rr > 0 && (
                <WinChanceBadge conviction={conviction} risk_reward={rr} />
              )}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {setupName}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className={cn("flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-bold", convictionColor)}>
            <Flame className="size-2.5" /> {conviction}
          </div>
          {(timeframe || leverage) && (
            <div className="flex items-center gap-1 font-mono text-[9px] uppercase text-muted-foreground">
              <Clock className="size-2.5" />
              {timeframe}
              {leverage ? ` · ${leverage}x` : ""}
            </div>
          )}
        </div>
      </div>

      {/* Mini chart */}
      {firstTarget && (
        <MiniSetupChart
          symbol={symbol}
          entryLow={entryLow}
          entryHigh={entryHigh}
          stop={stop}
          targets={targets}
        />
      )}

      {/* Levels grid */}
      <div className="grid grid-cols-3 gap-1.5 font-mono text-[10px]">
        <Stat label="Entry zone" value={`${formatPrice(entryLow)} – ${formatPrice(entryHigh)}`} />
        <Stat label="Stop loss" value={formatPrice(stop)} valueClass="text-bear" sub={`-${slDistPct.toFixed(2)}%`} />
        <Stat label="R:R" value={rr > 0 ? rr.toFixed(2) : "—"} valueClass="text-primary" />
        {targets[0] != null && (
          <Stat label="T1" value={formatPrice(targets[0])} valueClass="text-bull" sub={`+${t1DistPct.toFixed(2)}%`} />
        )}
        {targets[1] != null && (
          <Stat label="T2" value={formatPrice(targets[1])} valueClass="text-bull" />
        )}
        {targets[2] != null && (
          <Stat label="T3" value={formatPrice(targets[2])} valueClass="text-bull" />
        )}
      </div>

      {/* Reasoning */}
      {reasoning.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <Zap className="size-2.5 text-primary" /> Why this setup
          </div>
          <ul className="space-y-0.5 font-mono text-[11px] text-foreground/90">
            {reasoning.map((r, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-primary">▸</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Trigger + invalidation */}
      {(trigger || invalidation) && (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {trigger && (
            <InfoBlock icon={<Target className="size-2.5 text-bull" />} label="Trigger" text={trigger} />
          )}
          {invalidation && (
            <InfoBlock icon={<Shield className="size-2.5 text-bear" />} label="Invalidation" text={invalidation} />
          )}
        </div>
      )}
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
