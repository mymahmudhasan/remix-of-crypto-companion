import { Shield, AlertTriangle, Wallet, Scale, Timer } from "lucide-react";
import { formatPrice } from "@/lib/binance";
import { cn } from "@/lib/utils";

interface Props {
  side: "long" | "short" | "neutral";
  conviction: number;
  entryLow: number;
  entryHigh: number;
  stop: number;
  firstTarget?: number;
  riskPct: number;
  leverage?: number; // futures only
  timeHorizon?: "intraday" | "swing" | "position";
  /** Optional account size (USD) — defaults to $1,000 illustrative */
  accountSize?: number;
}

/**
 * Risk Management Guidance — shown under every trade analysis.
 * Derives position size, max loss, liquidation buffer, and rules from the plan.
 */
export function RiskGuidance({
  side,
  conviction,
  entryLow,
  entryHigh,
  stop,
  firstTarget,
  riskPct,
  leverage,
  timeHorizon = "swing",
  accountSize = 1000,
}: Props) {
  const entryMid = (entryLow + entryHigh) / 2;
  const stopDistPct = entryMid > 0 ? Math.abs((entryMid - stop) / entryMid) * 100 : 0;
  const risk = Math.abs(entryMid - stop);
  const reward = firstTarget ? Math.abs(firstTarget - entryMid) : 0;
  const rr = risk > 0 ? reward / risk : 0;

  // Recommended risk%: scale by conviction (low conviction → smaller risk).
  // Cap at provided riskPct from the plan.
  const convictionScale =
    conviction >= 80 ? 1 : conviction >= 65 ? 0.75 : conviction >= 50 ? 0.5 : 0.3;
  const recRiskPct = Math.max(0.25, Math.min(riskPct, riskPct * convictionScale));
  const dollarRisk = (accountSize * recRiskPct) / 100;
  const positionUsd = stopDistPct > 0 ? dollarRisk / (stopDistPct / 100) : 0;
  const lev = leverage && leverage > 0 ? leverage : 1;
  const margin = positionUsd / lev;
  const liqPct = lev > 1 ? (100 / lev) * 0.85 : 0; // approx isolated liq buffer

  const stopTooTight = stopDistPct > 0 && stopDistPct < 0.4;
  const stopTooWide = stopDistPct > 8;
  const liqDanger = lev > 1 && stopDistPct >= liqPct * 0.7;

  // Time-stop suggestion
  const timeStop =
    timeHorizon === "intraday"
      ? "Exit if thesis hasn't played out within 4–8 hours"
      : timeHorizon === "swing"
      ? "Re-evaluate if no progress in 3–5 days"
      : "Re-evaluate weekly; trail stop on each higher TF structure shift";

  const rules: { tone: "good" | "warn" | "bad"; text: string }[] = [];

  if (side !== "neutral") {
    rules.push({
      tone: "good",
      text: `Risk only ${recRiskPct.toFixed(2)}% of account per trade — never average down into the stop.`,
    });
    rules.push({
      tone: "good",
      text: `Move stop to entry once price reaches +${(rr * 0.6).toFixed(1)}R, then trail behind structure.`,
    });
    if (firstTarget) {
      rules.push({
        tone: "good",
        text: `Take 50% off at TP1, leave runners with stop at break-even.`,
      });
    }
    rules.push({ tone: "good", text: timeStop });
  }

  if (stopTooTight) {
    rules.push({
      tone: "warn",
      text: `Stop is very tight (${stopDistPct.toFixed(2)}%) — high chance of noise stop-out. Consider widening or skipping.`,
    });
  }
  if (stopTooWide) {
    rules.push({
      tone: "warn",
      text: `Stop is wide (${stopDistPct.toFixed(2)}%) — reduce position size further or wait for tighter entry.`,
    });
  }
  if (liqDanger) {
    rules.push({
      tone: "bad",
      text: `⚠ Stop distance is close to liquidation buffer at ${lev}× — drop leverage to ${Math.max(2, Math.floor(lev / 2))}× or use isolated margin.`,
    });
  }
  if (rr > 0 && rr < 1.5) {
    rules.push({
      tone: "warn",
      text: `R:R only ${rr.toFixed(2)} — needs >55% win-rate to be profitable. Consider passing.`,
    });
  }

  if (side === "neutral") {
    return (
      <div className="panel p-3">
        <div className="mb-1.5 flex items-center gap-2">
          <Shield className="size-3.5 text-warning" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-warning">
            Risk Management
          </h3>
        </div>
        <p className="font-mono text-xs leading-relaxed text-foreground/80">
          Setup is mixed — best action is to <span className="font-bold text-warning">stay flat</span> and
          wait for a clean break of the key level. Do not force a trade against unclear structure.
        </p>
      </div>
    );
  }

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center gap-2">
        <Shield className="size-3.5 text-primary" />
        <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">
          Risk Management Guidance
        </h3>
        <span className="ml-auto rounded border border-border bg-surface-elevated px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          Example · ${accountSize.toLocaleString()} account
        </span>
      </div>

      {/* Position-sizing grid */}
      <div className="mb-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <SizingCell
          icon={Scale}
          label="Risk / trade"
          value={`${recRiskPct.toFixed(2)}%`}
          sub={`$${dollarRisk.toFixed(0)} max loss`}
          tone="bear"
        />
        <SizingCell
          icon={Wallet}
          label="Position size"
          value={`$${positionUsd.toFixed(0)}`}
          sub={lev > 1 ? `Margin $${margin.toFixed(0)} @ ${lev}×` : "Spot notional"}
          tone="primary"
        />
        <SizingCell
          icon={AlertTriangle}
          label="Stop distance"
          value={`${stopDistPct.toFixed(2)}%`}
          sub={`SL @ $${formatPrice(stop)}`}
          tone={stopTooTight || stopTooWide ? "warning" : "muted"}
        />
        <SizingCell
          icon={Timer}
          label="R : R (TP1)"
          value={rr > 0 ? `${rr.toFixed(2)}R` : "—"}
          sub={rr >= 2 ? "Favorable" : rr >= 1.5 ? "Acceptable" : "Marginal"}
          tone={rr >= 2 ? "bull" : rr >= 1.5 ? "warning" : "bear"}
        />
      </div>

      {/* Rules */}
      <ul className="space-y-1">
        {rules.map((r, i) => (
          <li
            key={i}
            className={cn(
              "flex items-start gap-1.5 rounded-sm border-l-2 bg-surface-elevated/50 px-2 py-1 font-mono text-[11px] leading-snug",
              r.tone === "good" && "border-bull/60 text-foreground/85",
              r.tone === "warn" && "border-warning/70 text-warning",
              r.tone === "bad" && "border-bear/70 text-bear",
            )}
          >
            <span className="mt-0.5 shrink-0">
              {r.tone === "good" ? "✓" : r.tone === "warn" ? "!" : "✕"}
            </span>
            <span>{r.text}</span>
          </li>
        ))}
      </ul>

      <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Educational guidance · not financial advice
      </p>
    </div>
  );
}

function SizingCell({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Shield;
  label: string;
  value: string;
  sub: string;
  tone: "primary" | "bull" | "bear" | "warning" | "muted";
}) {
  const toneCls = {
    primary: "text-primary",
    bull: "text-bull",
    bear: "text-bear",
    warning: "text-warning",
    muted: "text-foreground",
  }[tone];
  return (
    <div className="rounded-md border border-border bg-surface-elevated p-2">
      <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <div className={cn("mt-0.5 font-mono text-sm font-bold tabular-nums", toneCls)}>{value}</div>
      <div className="font-mono text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}
