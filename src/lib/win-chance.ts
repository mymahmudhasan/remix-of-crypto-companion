import type { PremiumSignal } from "@/lib/premium-signals";

/**
 * Heuristic "win probability" estimate for a signal.
 * Combines AI conviction (primary) with risk:reward (secondary).
 * NOT a guarantee — purely a UI ranking aid.
 *
 * - Conviction contributes 80% of the weight (mapped roughly to historical hit rate)
 * - R:R contributes 20% (better R:R needs a lower hit rate to be +EV, but here we
 *   reward it slightly because higher R:R setups are typically better-defined)
 */
export function estimateWinChance(signal: PremiumSignal): number {
  // Conviction is 0–100. Map so that 50 conviction ≈ 50% win chance, 90 ≈ ~78%.
  const convictionPart = signal.conviction * 0.85;

  // R:R bonus: 1.0 → 0, 2.0 → +4, 3.0 → +8, 5.0 → +12 (capped)
  const rr = Math.max(0, signal.risk_reward);
  const rrPart = Math.min(12, Math.max(0, (rr - 1) * 4));

  const raw = convictionPart + rrPart;
  return Math.round(Math.max(20, Math.min(95, raw)));
}

export type WinTier = "elite" | "strong" | "decent" | "speculative";

export function winTier(pct: number): WinTier {
  if (pct >= 80) return "elite";
  if (pct >= 70) return "strong";
  if (pct >= 60) return "decent";
  return "speculative";
}

export function winTierLabel(tier: WinTier): string {
  switch (tier) {
    case "elite": return "Elite";
    case "strong": return "Strong";
    case "decent": return "Decent";
    case "speculative": return "Speculative";
  }
}
