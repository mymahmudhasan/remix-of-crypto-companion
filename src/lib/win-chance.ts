/**
 * Heuristic "win probability" estimate for a trade setup.
 * Combines AI conviction (primary, ~85%) with risk:reward (secondary, up to +12).
 * NOT a guarantee — purely a UI ranking aid.
 */

export interface WinChanceInput {
  /** AI conviction 0–100 */
  conviction: number;
  /** Risk:reward ratio (target distance / stop distance) */
  risk_reward: number;
}

export function estimateWinChance(input: WinChanceInput): number {
  const conviction = Math.max(0, Math.min(100, input.conviction || 0));
  const convictionPart = conviction * 0.85;

  // R:R bonus: 1.0 → 0, 2.0 → +4, 3.0 → +8, 5.0 → +12 (capped)
  const rr = Math.max(0, input.risk_reward || 0);
  const rrPart = Math.min(12, Math.max(0, (rr - 1) * 4));

  const raw = convictionPart + rrPart;
  return Math.round(Math.max(20, Math.min(95, raw)));
}

/**
 * Convenience: compute win chance from raw plan levels (entry zone, stop, first target).
 * Used for AI plans / saved plans where R:R isn't pre-computed.
 */
export function estimateWinChanceFromLevels(args: {
  conviction: number;
  entryLow: number;
  entryHigh: number;
  stop: number;
  firstTarget: number;
}): number {
  const entryMid = (args.entryLow + args.entryHigh) / 2;
  const risk = Math.abs(entryMid - args.stop);
  const reward = Math.abs(args.firstTarget - entryMid);
  const rr = risk > 0 ? reward / risk : 0;
  return estimateWinChance({ conviction: args.conviction, risk_reward: rr });
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
