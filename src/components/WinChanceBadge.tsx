import { cn } from "@/lib/utils";
import { estimateWinChance, winTier, winTierLabel, type WinChanceInput } from "@/lib/win-chance";

interface Props {
  conviction: number;
  risk_reward: number;
  /** Compact mode: hides tier label, shorter bar. Useful for tight spaces (cards, headers). */
  size?: "sm" | "md";
  className?: string;
}

/**
 * Reusable win-chance badge. Renders a colored pill with %, tier label, and a mini-bar.
 * Shared across Signals, Plans, Spot, Futures, AI Coach views — anywhere a setup is shown.
 */
export function WinChanceBadge({ conviction, risk_reward, size = "sm", className }: Props) {
  const input: WinChanceInput = { conviction, risk_reward };
  const pct = estimateWinChance(input);
  const tier = winTier(pct);

  const styles =
    tier === "elite" ? "border-bull/60 bg-bull/15 text-bull"
    : tier === "strong" ? "border-primary/60 bg-primary/15 text-primary"
    : tier === "decent" ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
    : "border-border bg-surface/40 text-muted-foreground";
  const barColor =
    tier === "elite" ? "bg-bull"
    : tier === "strong" ? "bg-primary"
    : tier === "decent" ? "bg-amber-400"
    : "bg-muted-foreground";

  const isMd = size === "md";

  return (
    <span
      title={`Estimated win chance based on AI conviction (${conviction}) and R:R (${risk_reward.toFixed(2)}). Educational only — not a guarantee.`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-mono font-bold uppercase tracking-wider",
        isMd ? "px-2 py-0.5 text-[10px]" : "px-1.5 py-0.5 text-[9px]",
        styles,
        className
      )}
    >
      <span>Win {pct}%</span>
      <span className={cn("opacity-70", isMd ? "inline" : "hidden sm:inline")}>· {winTierLabel(tier)}</span>
      <span className={cn("ml-0.5 overflow-hidden rounded-full bg-background/40", isMd ? "h-1.5 w-12" : "h-1 w-8")}>
        <span className={cn("block h-full transition-all", barColor)} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}
