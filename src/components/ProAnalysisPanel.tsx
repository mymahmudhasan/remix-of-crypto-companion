import { useState, useCallback } from "react";
import {
  Briefcase, Bell, Microscope, Zap, Coins, Shield, Loader2, Sparkles,
  CheckCircle2, AlertTriangle, XCircle, RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadPortfolio, portfolioContext } from "@/lib/portfolio";
import { cn } from "@/lib/utils";

export interface ProAnalysisSetup {
  symbol: string;
  side: "long" | "short" | "neutral";
  entryLow: number;
  entryHigh: number;
  stop: number;
  targets: number[];
  conviction: number;
  timeHorizon?: "intraday" | "swing" | "position";
  leverage?: number;
  mode?: "spot" | "futures";
}

interface PortfolioFit {
  verdict: string;
  summary: string;
  recommended_alloc_pct: number;
  concerns: string[];
}
interface EntryExit {
  entry_trigger: string;
  scale_ins: string[];
  partial_exits: string[];
  hard_invalidation: string;
}
interface DeepDive {
  kind: string;
  green_flags: string[];
  red_flags: string[];
  narrative: string;
}
interface SignalStrength {
  verdict: "GO" | "WAIT" | "SKIP";
  conviction: number;
  reason: string;
}
interface DefiYield {
  available: boolean;
  opportunities: { protocol: string; strategy: string; apr_range: string; main_risk: string }[];
  note: string;
}
interface RiskFramework {
  max_risk_per_trade_pct: number;
  max_sector_concentration_pct: number;
  max_total_open_risk_pct: number;
  drawdown_circuit_breaker_pct: number;
  correlation_cap_note: string;
  extra_rules: string[];
}
interface Analysis {
  portfolio_fit: PortfolioFit;
  entry_exit_alerts: EntryExit;
  altcoin_deep_dive: DeepDive;
  signal_strength: SignalStrength;
  defi_yield_angle: DefiYield;
  risk_framework: RiskFramework;
}

type Tab = "portfolio" | "alerts" | "deepdive" | "signal" | "defi" | "risk";

const TABS: { id: Tab; label: string; icon: typeof Briefcase }[] = [
  { id: "portfolio", label: "Portfolio Fit", icon: Briefcase },
  { id: "alerts", label: "Entry/Exit", icon: Bell },
  { id: "deepdive", label: "Deep Dive", icon: Microscope },
  { id: "signal", label: "Signal", icon: Zap },
  { id: "defi", label: "DeFi Yield", icon: Coins },
  { id: "risk", label: "Risk Framework", icon: Shield },
];

interface Props {
  setup: ProAnalysisSetup;
}

/** Tabbed panel rendering 6 AI-generated sections (lazy-loaded on first click). */
export function ProAnalysisPanel({ setup }: Props) {
  const [tab, setTab] = useState<Tab>("portfolio");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const port = loadPortfolio();
      const { data, error } = await supabase.functions.invoke("pro-analysis", {
        body: { setup, portfolio: portfolioContext(port) },
      });
      if (error) throw new Error(error.message || "Pro analysis failed");
      if (data?.error) throw new Error(data.error);
      if (!data?.analysis) throw new Error("Empty analysis returned");
      setAnalysis(data.analysis as Analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [setup]);

  return (
    <div className="panel p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Sparkles className="size-3.5 text-primary" />
        <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">
          Pro Analysis
        </h3>
        <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary">
          Portfolio · DeFi · Risk
        </span>
        <div className="ml-auto flex items-center gap-2">
          {analysis && (
            <button
              onClick={run}
              disabled={loading}
              className="flex items-center gap-1 rounded border border-border bg-surface-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-primary disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3", loading && "animate-spin")} />
              Refresh
            </button>
          )}
          {!analysis && !loading && (
            <button
              onClick={run}
              className="flex items-center gap-1.5 rounded border border-primary/50 bg-primary/10 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-primary hover:bg-primary/20"
            >
              <Sparkles className="size-3" /> Run Pro Analysis
            </button>
          )}
        </div>
      </div>

      {!analysis && !loading && !error && (
        <p className="font-mono text-[11px] text-muted-foreground">
          Click <span className="text-primary">Run Pro Analysis</span> to get portfolio fit,
          entry/exit alerts, altcoin deep-dive, DeFi yield angles, and a tailored risk framework
          against your current portfolio.
        </p>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-4 font-mono text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" />
          Running pro analysis…
        </div>
      )}

      {error && (
        <div className="rounded border border-bear/40 bg-bear/10 p-2 font-mono text-[11px] text-bear">
          {error}
          <button onClick={run} className="ml-2 underline hover:text-foreground">retry</button>
        </div>
      )}

      {analysis && (
        <>
          {/* Tabs */}
          <div className="mb-2 flex flex-wrap gap-1 border-b border-border">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  "flex items-center gap-1 border-b-2 px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                  tab === id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-3" /> {label}
              </button>
            ))}
          </div>

          {tab === "portfolio" && <PortfolioFitView fit={analysis.portfolio_fit} />}
          {tab === "alerts" && <EntryExitView e={analysis.entry_exit_alerts} />}
          {tab === "deepdive" && <DeepDiveView d={analysis.altcoin_deep_dive} symbol={setup.symbol} />}
          {tab === "signal" && <SignalView s={analysis.signal_strength} />}
          {tab === "defi" && <DefiView d={analysis.defi_yield_angle} />}
          {tab === "risk" && <RiskView r={analysis.risk_framework} />}
        </>
      )}
    </div>
  );
}

function VerdictPill({ verdict }: { verdict: "GO" | "WAIT" | "SKIP" }) {
  const meta = {
    GO: { Icon: CheckCircle2, cls: "border-bull/50 bg-bull/10 text-bull" },
    WAIT: { Icon: AlertTriangle, cls: "border-warning/50 bg-warning/10 text-warning" },
    SKIP: { Icon: XCircle, cls: "border-bear/50 bg-bear/10 text-bear" },
  }[verdict];
  const { Icon } = meta;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider", meta.cls)}>
      <Icon className="size-3" /> {verdict}
    </span>
  );
}

function PortfolioFitView({ fit }: { fit: PortfolioFit }) {
  const verdictTone =
    fit.verdict === "fits_well" ? "text-bull"
    : fit.verdict === "no_portfolio" ? "text-muted-foreground"
    : "text-warning";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("font-mono text-xs font-bold uppercase tracking-wider", verdictTone)}>
          {fit.verdict.replace(/_/g, " ")}
        </span>
        <span className="ml-auto rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-bold text-primary">
          Recommended alloc: {fit.recommended_alloc_pct}%
        </span>
      </div>
      <p className="font-mono text-xs leading-relaxed text-foreground/85">{fit.summary}</p>
      {fit.concerns.length > 0 && (
        <ul className="space-y-1">
          {fit.concerns.map((c, i) => (
            <li key={i} className="flex items-start gap-1.5 rounded border-l-2 border-warning/60 bg-surface-elevated/50 px-2 py-1 font-mono text-[11px] text-warning">
              <span>!</span><span>{c}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EntryExitView({ e }: { e: EntryExit }) {
  return (
    <div className="space-y-2">
      <Block label="Entry trigger" tone="primary">{e.entry_trigger}</Block>
      <ListBlock label="Scale-in zones" tone="bull" items={e.scale_ins} />
      <ListBlock label="Partial exits" tone="bull" items={e.partial_exits} />
      <Block label="Hard invalidation" tone="bear">{e.hard_invalidation}</Block>
    </div>
  );
}

function DeepDiveView({ d, symbol }: { d: DeepDive; symbol: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-bold">{symbol.replace("USDT", "/USDT")}</span>
        <span className="rounded border border-border bg-surface-elevated px-1.5 py-px font-mono text-[10px] uppercase text-muted-foreground">
          {d.kind.replace("_", " ")}
        </span>
      </div>
      <p className="font-mono text-xs leading-relaxed text-foreground/85">{d.narrative}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <ListBlock label="Green flags" tone="bull" items={d.green_flags} />
        <ListBlock label="Red flags" tone="bear" items={d.red_flags} />
      </div>
    </div>
  );
}

function SignalView({ s }: { s: SignalStrength }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <VerdictPill verdict={s.verdict} />
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Conviction</span>
        <span className="font-mono text-base font-bold tabular-nums">{s.conviction}<span className="text-xs text-muted-foreground">/100</span></span>
      </div>
      <p className="font-mono text-xs leading-relaxed text-foreground/85">{s.reason}</p>
    </div>
  );
}

function DefiView({ d }: { d: DefiYield }) {
  if (!d.available || d.opportunities.length === 0) {
    return (
      <p className="font-mono text-xs leading-relaxed text-foreground/80">
        {d.note || "No notable DeFi yield opportunities for this asset right now."}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="font-mono text-[11px] text-muted-foreground">{d.note}</p>
      <div className="space-y-1.5">
        {d.opportunities.map((o, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-border bg-surface-elevated p-2 sm:grid-cols-[140px_1fr_80px]">
            <div>
              <div className="font-mono text-xs font-bold text-primary">{o.protocol}</div>
              <div className="font-mono text-[10px] text-muted-foreground">{o.strategy}</div>
            </div>
            <div className="font-mono text-[11px] leading-snug text-foreground/80">
              <span className="text-bear">Risk: </span>{o.main_risk}
            </div>
            <div className="text-right font-mono text-sm font-bold text-bull tabular-nums">{o.apr_range}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RiskView({ r }: { r: RiskFramework }) {
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <RiskCell label="Risk / trade" value={`${r.max_risk_per_trade_pct}%`} tone="bear" />
        <RiskCell label="Sector cap" value={`${r.max_sector_concentration_pct}%`} tone="warning" />
        <RiskCell label="Total open risk" value={`${r.max_total_open_risk_pct}%`} tone="bear" />
        <RiskCell label="DD circuit-breaker" value={`-${r.drawdown_circuit_breaker_pct}%`} tone="bear" />
      </div>
      <Block label="Correlation cap" tone="primary">{r.correlation_cap_note}</Block>
      {r.extra_rules.length > 0 && (
        <ListBlock label="Extra rules" tone="primary" items={r.extra_rules} />
      )}
    </div>
  );
}

function RiskCell({ label, value, tone }: { label: string; value: string; tone: "bear" | "warning" | "primary" }) {
  const cls = tone === "bear" ? "text-bear" : tone === "warning" ? "text-warning" : "text-primary";
  return (
    <div className="rounded-md border border-border bg-surface-elevated p-2">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 font-mono text-base font-bold tabular-nums", cls)}>{value}</div>
    </div>
  );
}

function Block({ label, tone, children }: { label: string; tone: "bull" | "bear" | "primary" | "warning"; children: React.ReactNode }) {
  const cls = tone === "bull" ? "border-bull/40 text-bull" : tone === "bear" ? "border-bear/40 text-bear" : tone === "warning" ? "border-warning/40 text-warning" : "border-primary/40 text-primary";
  return (
    <div className={cn("rounded border-l-2 bg-surface-elevated/50 px-2 py-1.5", cls)}>
      <div className="font-mono text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="mt-0.5 font-mono text-xs leading-snug text-foreground/85">{children}</div>
    </div>
  );
}

function ListBlock({ label, tone, items }: { label: string; tone: "bull" | "bear" | "primary"; items: string[] }) {
  if (!items || items.length === 0) return null;
  const cls = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-primary";
  return (
    <div>
      <div className={cn("mb-1 font-mono text-[10px] uppercase tracking-wider", cls)}>{label}</div>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-1.5 rounded border-l-2 border-border bg-surface-elevated/50 px-2 py-1 font-mono text-[11px] leading-snug text-foreground/85">
            <span className={cls}>•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
