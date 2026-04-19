import { TrendingUp, TrendingDown, Minus, AlertTriangle, Layers, Target, Sparkles } from "lucide-react";
import { formatPrice } from "@/lib/binance";
import { cn } from "@/lib/utils";
import { WinChanceBadge } from "@/components/WinChanceBadge";
import { RiskGuidance } from "@/components/RiskGuidance";

export interface IndicatorRow {
  name: string;
  reading: string;
  verdict: "bullish" | "bearish" | "neutral";
  weight: number;
  note: string;
}

export interface MTFRow {
  timeframe: string;
  bias: "bull" | "bear" | "neutral";
  summary: string;
}

export interface Scenarios {
  bullCase: string;
  bearCase: string;
  keyLevel: number;
  keyLevelNote: string;
}

export interface PlanCommon {
  conviction: number;
  entry: { low: number; high: number };
  stop: number;
  targets: number[];
  riskPct: number;
  rationale: string[];
  invalidations: string[];
  summary: string;
  indicatorBreakdown: IndicatorRow[];
  multiTimeframe: MTFRow[];
  scenarios: Scenarios;
  timeHorizon: "intraday" | "swing" | "position";
}

const verdictMeta = {
  bullish: { cls: "text-bull border-bull/30 bg-bull/10", icon: TrendingUp },
  bearish: { cls: "text-bear border-bear/30 bg-bear/10", icon: TrendingDown },
  neutral: { cls: "text-muted-foreground border-border bg-surface-elevated", icon: Minus },
};

const biasMeta = {
  bull: { label: "BULL", cls: "text-bull bg-bull/10 border-bull/40" },
  bear: { label: "BEAR", cls: "text-bear bg-bear/10 border-bear/40" },
  neutral: { label: "NEUTRAL", cls: "text-muted-foreground bg-muted/20 border-border" },
};

interface Props {
  plan: PlanCommon;
  side: "long" | "short" | "neutral"; // for R:R direction
  currentPrice: number;
  /** Optional: futures leverage for sizing math */
  leverage?: number;
}

/** Detailed bottom-half analysis: summary, indicator breakdown, MTF, scenarios, R:R. */
export function PlanDetails({ plan, side, currentPrice, leverage }: Props) {
  // Compute risk:reward per target (uses entry midpoint)
  const entryMid = (plan.entry.low + plan.entry.high) / 2;
  const risk = Math.abs(entryMid - plan.stop);
  const rrs = plan.targets.map((t) => (risk > 0 ? Math.abs(t - entryMid) / risk : 0));

  // First-target R:R drives the heuristic win-chance badge
  const firstRR = rrs[0] ?? 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Summary */}
      <div className="panel p-3">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <Sparkles className="size-3.5 text-primary" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">
            AI Thesis
          </h3>
          {side !== "neutral" && firstRR > 0 && (
            <WinChanceBadge conviction={plan.conviction} risk_reward={firstRR} size="md" />
          )}
          <span className="ml-auto rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary">
            {plan.timeHorizon}
          </span>
        </div>
        <p className="font-mono text-xs leading-relaxed text-foreground/90">{plan.summary}</p>
      </div>

      {/* Risk : Reward per target */}
      {plan.targets.length > 0 && side !== "neutral" && (
        <div className="panel p-3">
          <div className="mb-2 flex items-center gap-2">
            <Target className="size-3.5 text-primary" />
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">
              Risk : Reward
            </h3>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {plan.targets.map((t, i) => {
              const rr = rrs[i];
              const rrTone =
                rr >= 3 ? "text-bull" : rr >= 1.5 ? "text-warning" : "text-bear";
              return (
                <div
                  key={i}
                  className="rounded-md border border-border bg-surface-elevated p-2"
                >
                  <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span>TP{i + 1}</span>
                    <span className={cn("font-bold", rrTone)}>
                      {rr.toFixed(2)}R
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-sm font-bold tabular-nums">
                    ${formatPrice(t)}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {(((t - currentPrice) / currentPrice) * 100).toFixed(2)}% from spot
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Indicator breakdown table */}
      {plan.indicatorBreakdown?.length > 0 && (
        <div className="panel p-3">
          <div className="mb-2 flex items-center gap-2">
            <Layers className="size-3.5 text-primary" />
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">
              Indicator Breakdown
            </h3>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {plan.indicatorBreakdown.length} signals analyzed
            </span>
          </div>
          <div className="space-y-1.5">
            {plan.indicatorBreakdown.map((row, i) => {
              const meta = verdictMeta[row.verdict];
              const Icon = meta.icon;
              return (
                <div
                  key={i}
                  className={cn(
                    "grid gap-2 rounded-md border p-2 sm:grid-cols-[140px_1fr_auto]",
                    meta.cls
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon className="size-3.5 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-mono text-xs font-bold uppercase">
                        {row.name}
                      </span>
                      <span className="font-mono text-[10px] tabular-nums opacity-80">
                        {row.reading}
                      </span>
                    </div>
                  </div>
                  <p className="font-mono text-[11px] leading-snug text-foreground/80">
                    {row.note}
                  </p>
                  <div className="flex items-center gap-0.5" title={`Weight ${row.weight}/5`}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <span
                        key={j}
                        className={cn(
                          "h-3 w-1 rounded-sm",
                          j < row.weight ? "bg-current" : "bg-current/20"
                        )}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Multi-timeframe confluence */}
      {plan.multiTimeframe?.length > 0 && (
        <div className="panel p-3">
          <h3 className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
            Multi-Timeframe Confluence
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {plan.multiTimeframe.map((tf) => {
              const m = biasMeta[tf.bias];
              return (
                <div
                  key={tf.timeframe}
                  className={cn("rounded-md border p-2", m.cls)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold">{tf.timeframe}</span>
                    <span className="font-mono text-[10px] font-bold">{m.label}</span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] leading-snug opacity-90">
                    {tf.summary}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Scenarios */}
      {plan.scenarios && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="panel p-3">
            <h3 className="mb-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-bull">
              ▲ Bull Scenario
            </h3>
            <p className="font-mono text-xs leading-relaxed text-foreground/80">
              {plan.scenarios.bullCase}
            </p>
          </div>
          <div className="panel p-3">
            <h3 className="mb-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-bear">
              ▼ Bear Scenario
            </h3>
            <p className="font-mono text-xs leading-relaxed text-foreground/80">
              {plan.scenarios.bearCase}
            </p>
          </div>
          <div className="panel p-3 lg:col-span-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-3.5 text-warning" />
              <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-warning">
                Key Level to Watch · ${formatPrice(plan.scenarios.keyLevel)}
              </h3>
            </div>
            <p className="mt-1 font-mono text-xs leading-relaxed text-foreground/80">
              {plan.scenarios.keyLevelNote}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
