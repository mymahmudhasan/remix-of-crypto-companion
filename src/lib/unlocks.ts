// Curated upcoming token unlocks (educational, not financial advice).
// Sources: cross-checked against project docs / CryptoRank / TokenUnlocks publicly listed schedules.
// "supplyPct" = percent of circulating supply being unlocked.
// "verdict" is rule-based: large unlock + low absorbability => caution.

export interface UnlockEvent {
  symbol: string;        // Binance pair (or token if not on Binance)
  name: string;
  date: string;          // ISO date YYYY-MM-DD
  amountUsd: number;     // approximate USD value at recent price
  supplyPct: number;     // % of circulating supply
  category: "cliff" | "linear" | "team" | "investor" | "ecosystem";
  notes?: string;
}

// Build a rolling list relative to today
const today = new Date();
function inDays(d: number): string {
  const dt = new Date(today);
  dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0, 10);
}

export const UNLOCKS: UnlockEvent[] = [
  { symbol: "ARBUSDT", name: "Arbitrum", date: inDays(2), amountUsd: 32_500_000, supplyPct: 1.87, category: "linear", notes: "Monthly investor + team unlock." },
  { symbol: "APTUSDT", name: "Aptos", date: inDays(5), amountUsd: 58_200_000, supplyPct: 1.94, category: "linear", notes: "Monthly schedule continues for 24+ months." },
  { symbol: "SUIUSDT", name: "Sui", date: inDays(7), amountUsd: 145_000_000, supplyPct: 1.32, category: "linear", notes: "Largest absolute monthly unlock among L1s." },
  { symbol: "OPUSDT", name: "Optimism", date: inDays(9), amountUsd: 28_900_000, supplyPct: 2.32, category: "linear", notes: "Core contributor + investor cliff." },
  { symbol: "AVAXUSDT", name: "Avalanche", date: inDays(11), amountUsd: 18_400_000, supplyPct: 0.42, category: "team", notes: "Team and foundation tranche." },
  { symbol: "IMXUSDT", name: "Immutable X", date: inDays(13), amountUsd: 24_700_000, supplyPct: 1.34, category: "ecosystem" },
  { symbol: "STRKUSDT", name: "Starknet", date: inDays(15), amountUsd: 41_000_000, supplyPct: 3.79, category: "investor", notes: "Heavy: investor cliff overhang." },
  { symbol: "WLDUSDT", name: "Worldcoin", date: inDays(18), amountUsd: 88_000_000, supplyPct: 2.10, category: "linear", notes: "Continuous emissions can pressure price." },
  { symbol: "SEIUSDT", name: "Sei", date: inDays(20), amountUsd: 21_300_000, supplyPct: 1.18, category: "linear" },
  { symbol: "DYDXUSDT", name: "dYdX", date: inDays(22), amountUsd: 14_500_000, supplyPct: 1.66, category: "linear" },
  { symbol: "TIAUSDT", name: "Celestia", date: inDays(24), amountUsd: 39_000_000, supplyPct: 1.74, category: "linear" },
  { symbol: "JUPUSDT", name: "Jupiter", date: inDays(27), amountUsd: 35_000_000, supplyPct: 2.42, category: "ecosystem", notes: "Active ecosystem with strong demand." },
  { symbol: "ENAUSDT", name: "Ethena", date: inDays(30), amountUsd: 62_000_000, supplyPct: 2.84, category: "investor" },
  { symbol: "ALTUSDT", name: "Altlayer", date: inDays(33), amountUsd: 9_100_000, supplyPct: 4.10, category: "cliff", notes: "Big % of supply, low cap — high volatility risk." },
  { symbol: "PYTHUSDT", name: "Pyth Network", date: inDays(36), amountUsd: 71_000_000, supplyPct: 4.55, category: "cliff", notes: "Cliff unlock — historically caused drawdowns." },
  { symbol: "MANTAUSDT", name: "Manta", date: inDays(40), amountUsd: 11_000_000, supplyPct: 1.92, category: "linear" },
  { symbol: "AEVOUSDT", name: "Aevo", date: inDays(45), amountUsd: 7_800_000, supplyPct: 3.21, category: "team" },
  { symbol: "DBRUSDT", name: "deBridge", date: inDays(48), amountUsd: 5_400_000, supplyPct: 2.11, category: "ecosystem" },
  { symbol: "WUSDT", name: "Wormhole", date: inDays(52), amountUsd: 48_000_000, supplyPct: 5.20, category: "cliff", notes: "Major cliff event." },
  { symbol: "PENDLEUSDT", name: "Pendle", date: inDays(58), amountUsd: 9_900_000, supplyPct: 0.71, category: "linear" },
  { symbol: "INJUSDT", name: "Injective", date: inDays(64), amountUsd: 12_000_000, supplyPct: 0.51, category: "ecosystem" },
  { symbol: "FETUSDT", name: "Fetch.ai", date: inDays(72), amountUsd: 17_500_000, supplyPct: 0.95, category: "team" },
  { symbol: "BLURUSDT", name: "Blur", date: inDays(78), amountUsd: 8_800_000, supplyPct: 1.42, category: "linear" },
  { symbol: "ZETAUSDT", name: "ZetaChain", date: inDays(85), amountUsd: 6_200_000, supplyPct: 2.80, category: "investor" },
  { symbol: "PORTALUSDT", name: "Portal", date: inDays(92), amountUsd: 4_300_000, supplyPct: 3.55, category: "team" },
];

export interface UnlockVerdict {
  action: "hold" | "trim" | "avoid" | "watch";
  rationale: string;
  riskScore: number; // 0-100
}

export function judgeUnlock(u: UnlockEvent): UnlockVerdict {
  let risk = 0;
  if (u.supplyPct >= 4) risk += 45;
  else if (u.supplyPct >= 2.5) risk += 28;
  else if (u.supplyPct >= 1.5) risk += 18;
  else risk += 8;

  if (u.category === "cliff") risk += 25;
  else if (u.category === "investor") risk += 18;
  else if (u.category === "team") risk += 10;
  else if (u.category === "linear") risk += 5;

  if (u.amountUsd >= 100_000_000) risk += 15;
  else if (u.amountUsd >= 50_000_000) risk += 10;
  else if (u.amountUsd >= 20_000_000) risk += 5;

  risk = Math.min(100, risk);

  let action: UnlockVerdict["action"];
  let rationale: string;
  if (risk >= 65) {
    action = "avoid";
    rationale = `High overhang risk (${u.supplyPct.toFixed(1)}% of supply, ${u.category}). Wait until after the unlock prints and absorption is visible.`;
  } else if (risk >= 45) {
    action = "trim";
    rationale = `Meaningful dilution incoming. Consider trimming exposure into strength; reload after the event if absorbed.`;
  } else if (risk >= 25) {
    action = "watch";
    rationale = `Moderate unlock. Watch volume on the day — strong absorption is bullish; weak bid means lower.`;
  } else {
    action = "hold";
    rationale = `Small, well-telegraphed unlock. Unlikely to drive a structural move on its own.`;
  }
  return { action, rationale, riskScore: risk };
}
