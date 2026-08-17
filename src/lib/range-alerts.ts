/**
 * Range-extreme alert engine.
 *
 * Scans a universe of USDT pairs and flags tokens that are AT / NEAR a major
 * high or low, plus the statistical chance of tagging that extreme.
 *
 * Scopes: 30D and 90D (daily candles), 1Y (daily), and ALL-TIME (weekly candles,
 * full listing history) — so the all-time support / resistance zone is included,
 * not just the last few weeks.
 *
 * Each hit carries an actionable playbook:
 *  - at / near HIGH  → fade it (short the extreme) or trim longs
 *  - at / near LOW   → buy the point and hold it tight (stop just under the low)
 */

import { fetchKlines, formatPrice, type Kline } from "@/lib/binance";
import { atrFromOHLC, rsi } from "@/lib/indicators";

export type RangeKind = "high" | "low";
export type RangeStage = "at" | "near" | "approaching";

export interface RangeAlert {
  symbol: string;
  kind: RangeKind;
  stage: RangeStage;
  price: number;
  level: number;          // the range high / low
  zoneLow: number;        // support/resistance ZONE bounds (levels cluster, not a line)
  zoneHigh: number;
  distancePct: number;    // absolute distance to the zone edge, %
  touchChance: number;    // 5–95, probability of tagging the level soon
  lookbackDays: number;
  scope: string;          // "30D" | "90D" | "1Y" | "ALL"
  scopeLabel: string;     // human label, e.g. "all-time"
  rsi: number | null;
  atrPct: number | null;
  rangePos: number;       // 0 = at range low, 1 = at range high
  // Playbook
  bias: "long" | "short";
  action: string;
  entry: number;
  stop: number;
  targets: number[];
  rr: number;
  reasons: string[];
}

export const RANGE_UNIVERSE = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT",
  "AVAXUSDT", "LINKUSDT", "TONUSDT", "TRXUSDT", "DOTUSDT", "NEARUSDT", "APTUSDT",
  "ARBUSDT", "OPUSDT", "SUIUSDT", "INJUSDT", "ATOMUSDT", "LTCUSDT", "TIAUSDT",
  "SEIUSDT", "FETUSDT", "JUPUSDT", "WLDUSDT", "ETCUSDT", "FILUSDT", "AAVEUSDT",
  "UNIUSDT", "PEPEUSDT", "WIFUSDT", "SHIBUSDT", "BONKUSDT", "ORDIUSDT", "RUNEUSDT",
];

interface Scope {
  key: string;
  label: string;
  days: number;      // approximate calendar days covered
  tf: "1d" | "1w";
  bars: number | null; // null = use every bar available (all-time)
  tol: number;       // distance tolerance multiplier (wider for macro levels)
  zoneAtrMult: number; // zone thickness in ATR units
}

const SCOPES: Scope[] = [
  { key: "30D", label: "30-day", days: 30, tf: "1d", bars: 30, tol: 1, zoneAtrMult: 0.5 },
  { key: "90D", label: "90-day", days: 90, tf: "1d", bars: 90, tol: 1.3, zoneAtrMult: 0.8 },
  { key: "1Y", label: "1-year", days: 365, tf: "1d", bars: 365, tol: 2.2, zoneAtrMult: 1.2 },
  { key: "ALL", label: "all-time", days: 9999, tf: "1w", bars: null, tol: 4, zoneAtrMult: 2 },
];

export const LOOKBACKS = SCOPES.map((s) => s.key);

function pct(a: number, b: number) {
  return ((a - b) / b) * 100;
}

/** Chance of tagging `level` given the distance in ATR units (rough, monotonic). */
function chanceFromAtr(distance: number, atr: number, momentumAligned: boolean): number {
  if (atr <= 0) return 50;
  const d = distance / atr; // sessions of range needed
  let p = 95 * Math.exp(-0.34 * d);
  if (momentumAligned) p += 8;
  else p -= 6;
  return Math.max(5, Math.min(95, Math.round(p)));
}

function stageFor(distancePct: number, tol: number): RangeStage | null {
  if (distancePct <= 1.2 * tol) return "at";
  if (distancePct <= 3.5 * tol) return "near";
  if (distancePct <= 7 * tol) return "approaching";
  return null;
}

/**
 * Build the zone edge from clustered extremes: instead of a single wick price,
 * take the mean of the most extreme N bars so the level is a ZONE.
 */
function zoneFromExtremes(values: number[], kind: RangeKind, count: number) {
  const sorted = [...values].sort((a, b) => (kind === "high" ? b - a : a - b));
  const take = sorted.slice(0, Math.max(1, Math.min(count, sorted.length)));
  const extreme = take[0];
  const mean = take.reduce((s, v) => s + v, 0) / take.length;
  return { extreme, mean };
}

function build(
  symbol: string,
  scope: Scope,
  window: Kline[],
  daily: Kline[],
): RangeAlert[] {
  if (window.length < 10) return [];

  const dHighs = daily.map((k) => k.high);
  const dLows = daily.map((k) => k.low);
  const dCloses = daily.map((k) => k.close);
  const price = dCloses[dCloses.length - 1];
  if (!isFinite(price) || price <= 0) return [];

  const atrSeries = atrFromOHLC(dHighs, dLows, dCloses, 14);
  const atr = (atrSeries[atrSeries.length - 1] as number | null) ?? price * 0.03;
  const atrPct = (atr / price) * 100;
  const r = rsi(dCloses, 14);
  const rsiNow = (r[r.length - 1] as number | null) ?? null;

  const hiZone = zoneFromExtremes(window.map((k) => k.high), "high", Math.max(2, Math.round(window.length * 0.05)));
  const loZone = zoneFromExtremes(window.map((k) => k.low), "low", Math.max(2, Math.round(window.length * 0.05)));
  const hi = hiZone.extreme;
  const lo = loZone.extreme;
  const rangePos = hi > lo ? (price - lo) / (hi - lo) : 0.5;

  const last6 = dCloses.slice(-6);
  const mom = last6.length > 1 ? pct(price, last6[0]) : 0;
  const zoneT = atr * scope.zoneAtrMult;

  const out: RangeAlert[] = [];

  // ── Resistance zone (range high) → fade / take profit
  const resTop = hi;
  const resBottom = Math.min(hiZone.mean, hi - zoneT);
  const dHighPct = price >= resBottom ? 0 : Math.abs(pct(resBottom, price));
  const stHigh = price <= resTop * 1.02 ? stageFor(dHighPct, scope.tol) : null;
  if (stHigh) {
    const chance = chanceFromAtr(Math.max(0, resBottom - price), atr, mom > 0);
    const stop = resTop + atr * 0.9;
    const entry = stHigh === "at" ? Math.max(price, resBottom) : resBottom;
    const t1 = entry - atr * 1.5;
    const t2 = entry - atr * 3;
    const risk = stop - entry;
    out.push({
      symbol, kind: "high", stage: stHigh, price, level: hi,
      zoneLow: resBottom, zoneHigh: resTop,
      distancePct: dHighPct, touchChance: chance, lookbackDays: scope.days,
      scope: scope.key, scopeLabel: scope.label,
      rsi: rsiNow, atrPct, rangePos,
      bias: "short",
      action: stHigh === "at"
        ? `Inside the ${scope.label} resistance zone $${formatPrice(resBottom)}–$${formatPrice(resTop)} — fade the extreme (short) or take profit on longs`
        : `${dHighPct.toFixed(1)}% below the ${scope.label} resistance zone — stage a short ambush at $${formatPrice(resBottom)}–$${formatPrice(resTop)}`,
      entry, stop, targets: [t1, t2],
      rr: risk > 0 ? (entry - t2) / risk : 0,
      reasons: [
        `${scope.label} resistance zone $${formatPrice(resBottom)}–$${formatPrice(resTop)} · price ${dHighPct.toFixed(1)}% away`,
        `Range position ${(rangePos * 100).toFixed(0)}% of the ${scope.label} range`,
        rsiNow !== null ? `RSI ${rsiNow.toFixed(0)}${rsiNow > 70 ? " overbought" : ""}` : "",
        `${chance}% chance of tagging the zone (${(Math.max(0, resBottom - price) / atr).toFixed(1)} ATR away)`,
      ].filter(Boolean),
    });
  }

  // ── Support zone (range low) → buy the point and hold it tight
  const supBottom = lo;
  const supTop = Math.max(loZone.mean, lo + zoneT);
  const dLowPct = price <= supTop ? 0 : Math.abs(pct(price, supTop));
  const stLow = price >= supBottom * 0.98 ? stageFor(dLowPct, scope.tol) : null;
  if (stLow) {
    const chance = chanceFromAtr(Math.max(0, price - supTop), atr, mom < 0);
    const stop = supBottom - atr * 0.9;
    const entry = stLow === "at" ? Math.min(price, supTop) : supTop;
    const t1 = entry + atr * 2;
    const t2 = entry + atr * 4;
    const risk = entry - stop;
    out.push({
      symbol, kind: "low", stage: stLow, price, level: lo,
      zoneLow: supBottom, zoneHigh: supTop,
      distancePct: dLowPct, touchChance: chance, lookbackDays: scope.days,
      scope: scope.key, scopeLabel: scope.label,
      rsi: rsiNow, atrPct, rangePos,
      bias: "long",
      action: stLow === "at"
        ? `Inside the ${scope.label} support zone $${formatPrice(supBottom)}–$${formatPrice(supTop)} — buy this point and hold it tight (stop under $${formatPrice(supBottom)})`
        : `${dLowPct.toFixed(1)}% above the ${scope.label} support zone — stage bids into $${formatPrice(supBottom)}–$${formatPrice(supTop)}`,
      entry, stop, targets: [t1, t2],
      rr: risk > 0 ? (t2 - entry) / risk : 0,
      reasons: [
        `${scope.label} support zone $${formatPrice(supBottom)}–$${formatPrice(supTop)} · price ${dLowPct.toFixed(1)}% away`,
        `Range position ${(rangePos * 100).toFixed(0)}% of the ${scope.label} range`,
        rsiNow !== null ? `RSI ${rsiNow.toFixed(0)}${rsiNow < 30 ? " oversold" : ""}` : "",
        `${chance}% chance of tagging the zone (${(Math.max(0, price - supTop) / atr).toFixed(1)} ATR away)`,
      ].filter(Boolean),
    });
  }

  return out;
}

/** Scan one symbol across every scope (30D → all-time); keeps the tightest and the most macro hit per side. */
export async function scanRangeExtremes(symbol: string): Promise<RangeAlert[]> {
  try {
    const [daily, weekly] = await Promise.all([
      fetchKlines(symbol, "1d", 400),
      fetchKlines(symbol, "1w", 1000), // full listing history for all-time levels
    ]);
    if (daily.length < 30) return [];

    const all: RangeAlert[] = [];
    for (const scope of SCOPES) {
      const src = scope.tf === "1w" ? weekly : daily;
      if (!src.length) continue;
      const window = scope.bars === null ? src : src.slice(-scope.bars);
      all.push(...build(symbol, scope, window, daily));
    }

    // Per side: keep the closest level plus the most macro level (all-time matters
    // even when a 30D level is nearer).
    const out: RangeAlert[] = [];
    for (const kind of ["high", "low"] as RangeKind[]) {
      const hits = all.filter((a) => a.kind === kind);
      if (!hits.length) continue;
      const closest = [...hits].sort((a, b) => a.distancePct - b.distancePct)[0];
      const macro = [...hits].sort((a, b) => b.lookbackDays - a.lookbackDays)[0];
      out.push(closest);
      if (macro !== closest) out.push(macro);
    }
    return out;
  } catch {
    return [];
  }
}

export async function scanUniverse(
  symbols: string[] = RANGE_UNIVERSE,
  onProgress?: (done: number, total: number) => void,
): Promise<RangeAlert[]> {
  const out: RangeAlert[] = [];
  const batch = 5;
  for (let i = 0; i < symbols.length; i += batch) {
    const chunk = symbols.slice(i, i + batch);
    const res = await Promise.all(chunk.map(scanRangeExtremes));
    res.forEach((r) => out.push(...r));
    onProgress?.(Math.min(i + batch, symbols.length), symbols.length);
  }
  const rank = { at: 0, near: 1, approaching: 2 } as const;
  return out.sort((a, b) =>
    rank[a.stage] - rank[b.stage] || b.lookbackDays - a.lookbackDays ||
    b.touchChance - a.touchChance || a.distancePct - b.distancePct);
}

/* ── Notification plumbing ───────────────────────────────────────── */

const ENABLED_KEY = "cryptodesk:range-alerts-enabled";
const SEEN_KEY = "cryptodesk:range-alerts-seen";

export function rangeAlertsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(ENABLED_KEY) === "1";
}

export function setRangeAlertsEnabled(v: boolean) {
  localStorage.setItem(ENABLED_KEY, v ? "1" : "0");
}

export function alertKey(a: RangeAlert): string {
  return `${a.symbol}:${a.kind}:${a.scope}:${a.stage}:${a.level.toPrecision(6)}`;
}

function loadSeen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"); } catch { return {}; }
}

/** True the first time this exact alert is seen within 12h. */
export function markUnseen(a: RangeAlert): boolean {
  const key = alertKey(a);
  const seen = loadSeen();
  const now = Date.now();
  for (const k of Object.keys(seen)) if (now - seen[k] > 12 * 3600_000) delete seen[k];
  if (seen[key]) { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); return false; }
  seen[key] = now;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* quota */ }
  return true;
}

export function notifyRangeAlert(a: RangeAlert) {
  const pretty = a.symbol.replace("USDT", "/USDT");
  const title = a.kind === "high"
    ? `${pretty} · ${a.scopeLabel} RESISTANCE — fade / take profit`
    : `${pretty} · ${a.scopeLabel} SUPPORT — buy & hold tight`;
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body: a.action, tag: alertKey(a), icon: "/placeholder.svg" });
    }
  } catch { /* ignore */ }
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine";
    o.frequency.value = a.kind === "high" ? 880 : 520;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    o.start(); o.stop(ctx.currentTime + 0.45);
  } catch { /* ignore */ }
}
