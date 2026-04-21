import { cn } from "@/lib/utils";

export interface MomentumTier {
  key: string;
  label: string;
  emoji: string;
  className: string;
  pulse?: boolean;
}

/**
 * Creative momentum tiers based on 24h % change.
 * Goes beyond simple pump/dump — communicates intensity & character.
 */
export function getMomentumTier(change24h: number | null | undefined): MomentumTier | null {
  if (change24h === null || change24h === undefined || !isFinite(change24h)) return null;
  const c = change24h;

  if (c >= 15) return {
    key: "parabolic", label: "Parabolic", emoji: "🚀",
    className: "border-bull/70 bg-bull/20 text-bull shadow-[0_0_8px_hsl(var(--bull)/0.4)]",
    pulse: true,
  };
  if (c >= 7) return {
    key: "pump", label: "Pump", emoji: "🔥",
    className: "border-bull/50 bg-bull/15 text-bull",
  };
  if (c >= 2) return {
    key: "rising", label: "Rising", emoji: "📈",
    className: "border-bull/30 bg-bull/8 text-bull/90",
  };
  if (c > -2) return {
    key: "neutral", label: "Neutral", emoji: "⚖",
    className: "border-border bg-surface-elevated text-muted-foreground",
  };
  if (c > -7) return {
    key: "fading", label: "Fading", emoji: "📉",
    className: "border-bear/30 bg-bear/8 text-bear/90",
  };
  if (c > -15) return {
    key: "dump", label: "Dump", emoji: "💀",
    className: "border-bear/50 bg-bear/15 text-bear",
  };
  return {
    key: "capitulation", label: "Capitulation", emoji: "☠",
    className: "border-bear/70 bg-bear/20 text-bear shadow-[0_0_8px_hsl(var(--bear)/0.4)]",
    pulse: true,
  };
}

interface Props {
  change24h: number | null | undefined;
  size?: "sm" | "md";
  showPct?: boolean;
}

export function MomentumLabel({ change24h, size = "sm", showPct = true }: Props) {
  const tier = getMomentumTier(change24h);
  if (!tier) return null;

  const sizing = size === "md"
    ? "px-2 py-0.5 text-[10px]"
    : "px-1.5 py-[1px] text-[9px]";

  return (
    <span
      title={`24h: ${change24h!.toFixed(2)}% — ${tier.label}`}
      className={cn(
        "inline-flex items-center gap-1 rounded border font-mono font-bold uppercase tracking-wider tabular-nums whitespace-nowrap",
        sizing,
        tier.className,
        tier.pulse && "animate-pulse"
      )}
    >
      <span className="leading-none">{tier.emoji}</span>
      <span>{tier.label}</span>
      {showPct && (
        <span className="opacity-80">
          {change24h! >= 0 ? "+" : ""}{change24h!.toFixed(1)}%
        </span>
      )}
    </span>
  );
}
