/**
 * Range-extreme alert engine.
 *
 * Scans a universe of USDT pairs on the daily timeframe and flags tokens that are
 * AT / NEAR a multi-week high or low, plus the statistical chance of tagging that
 * extreme within the next few sessions (distance measured in ATR units).
 *
 * Each hit carries an actionable playbook:
 *  - at / near HIGH  → fade it (short the extreme) or trim longs
 *  - at / near LOW   → buy the point and hold it tight (stop just under the low)
 */

import { fetchKlines, type Kline } from "@/lib/binance";
import { atrFromOHLC, rsi } from "@/lib/indicators";

export type RangeKind = "high" | "low";
export type RangeStage = "at" | "near" | "approaching";

export interface RangeAlert {
  symbol: string;
  kind: RangeKind;
  stage: RangeStage;
  price: number;
  level: number;          // the range high / low
  distancePct: number;    // absolute distance to the level, %
  touchChance: number;    // 5–95, probability of tagging the level soon
  lookbackDays: number;
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

export const LOOKBACKS = [30, 90] as const;

function pct(a: number, b: number) {
  return ((a - b) / b) * 100;
}

/** Chance of tagging `level` given the distance in ATR units (rough, monotonic). */
function chanceFromAtr(distance: number, atr: number, momentumAligned: boolean): number {
  if (atr <= 0) return 50;
  const d = distance / atr; // sessions of range needed
  // 0 ATR away → ~95%, 1 ATR → ~72%, 2 ATR → ~50%, 4 ATR → ~25%
  let p = 95 * Math.exp(-0.34 * d);
  if (momentumAligned) p += 8;
  else p -= 6;
  return Math.max(5, Math.min(95, Math.round(p)));
}

function stageFor(distancePct: number): RangeStage | null {
  if (distancePct <= 1.2) return "at";
  if (distancePct <= 3.5) return "near";
  if (distancePct <= 7) return "approaching";
  return null;
}

function build(symbol: string, klines: Kline[], lookback: number): RangeAlert[] {
  const win = klines.slice(-lookback);
  if (win.length < Math.min(20, lookback)) return [];

  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);
  const closes = klines.map((k) => k.close);
  const price = closes[closes.length - 1];

  const atrSeries = atrFromOHLC(highs, lows, closes, 14);
  const atr = (atrSeries[atrSeries.length - 1] as number | null) ?? price * 0.03;
  const atrPct = (atr / price) * 100;
  const r = rsi(closes, 14);
  const rsiNow = (r[r.length - 1] as number | null) ?? null;

  const hi = Math.max(...win.map((k) => k.high));
  const lo = Math.min(...win.map((k) => k.low));
  const rangePos = hi > lo ? (price - lo) / (hi - lo) : 0.5;

  const last5 = closes.slice(-6);
  const mom = last5.length > 1 ? pct(price, last5[0]) : 0;

  const out: RangeAlert[] = [];

  // ── Near the HIGH → fade / take profit
  const dHighPct = Math.abs(pct(hi, price));
  const stHigh = price <= hi * 1.005 ? stageFor(dHighPct) : null;
  if (stHigh) {
    const chance = chanceFromAtr(Math.max(0, hi - price), atr, mom > 0);
    const stop = hi + atr * 0.9;
    const entry = stHigh === "at" ? price : hi;
    const t1 = entry - atr * 1.5;
    const t2 = entry - atr * 3;
    const risk = stop - entry;
    out.push({
      symbol, kind: "high", stage: stHigh, price, level: hi,
      distancePct: dHighPct, touchChance: chance, lookbackDays: lookback,
      rsi: rsiNow, atrPct, rangePos,
      bias: "short",
      action: stHigh === "at"
        ? `At the ${lookback}D high — fade the extreme (short) or take profit on longs`
        : `${dHighPct.toFixed(1)}% under the ${lookback}D high — set a short ambush at $${hi}`,
      entry, stop, targets: [t1, t2],
      rr: risk > 0 ? (entry - t2) / risk : 0,
      reasons: [
        `${lookback}D high $${hi} · price ${dHighPct.toFixed(1)}% away`,
        `Range position ${(rangePos * 100).toFixed(0)}% (top of range)`,
        rsiNow !== null ? `RSI ${rsiNow.toFixed(0)}${rsiNow > 70 ? " overbought" : ""}` : "",
        `${chance}% chance of tagging the level (${(Math.max(0, hi - price) / atr).toFixed(1)} ATR away)`,
      ].filter(Boolean),
    });
  }

  // ── Near the LOW → buy the point and hold it tight
  const dLowPct = Math.abs(pct(price, lo));
  const stLow = price >= lo * 0.995 ? stageFor(dLowPct) : null;
  if (stLow) {
    const chance = chanceFromAtr(Math.max(0, price - lo), atr, mom < 0);
    const stop = lo - atr * 0.9;
    const entry = stLow === "at" ? price : lo;
    const t1 = entry + atr * 2;
    const t2 = entry + atr * 4;
    const risk = entry - stop;
    out.push({
      symbol, kind: "low", stage: stLow, price, level: lo,
      distancePct: dLowPct, touchChance: chance, lookbackDays: lookback,
      rsi: rsiNow, atrPct, rangePos,
      bias: "long",
      action: stLow === "at"
        ? `At the ${lookback}D low — buy this point and hold it tight (stop under $${lo})`
        : `${dLowPct.toFixed(1)}% above the ${lookback}D low — stage bids into $${lo}`,
      entry, stop, targets: [t1, t2],
      rr: risk > 0 ? (t2 - entry) / risk : 0,
      reasons: [
        `${lookback}D low $${lo} · price ${dLowPct.toFixed(1)}% away`,
        `Range position ${(rangePos * 100).toFixed(0)}% (bottom of range)`,
        rsiNow !== null ? `RSI ${rsiNow.toFixed(0)}${rsiNow < 30 ? " oversold" : ""}` : "",
        `${chance}% chance of tagging the level (${(Math.max(0, price - lo) / atr).toFixed(1)} ATR away)`,
      ].filter(Boolean),
    });
  }

  return out;
}

/** Scan one symbol across all lookbacks; keeps the tightest hit per kind. */
export async function scanRangeExtremes(symbol: string): Promise<RangeAlert[]> {
  try {
    const klines = await fetchKlines(symbol, "1d", 130);
    if (klines.length < 30) return [];
    const all = LOOKBACKS.flatMap((lb) => build(symbol, klines, lb));
    const best = new Map<RangeKind, RangeAlert>();
    for (const a of all) {
      const prev = best.get(a.kind);
      // Prefer the longer lookback (more significant level) at equal stage.
      if (!prev || a.distancePct < prev.distancePct - 0.3 ||
        (Math.abs(a.distancePct - prev.distancePct) <= 0.3 && a.lookbackDays > prev.lookbackDays)) {
        best.set(a.kind, a);
      }
    }
    return Array.from(best.values());
  } catch {
    return [];
  }
}

export async function scanUniverse(
  symbols: string[] = RANGE_UNIVERSE,
  onProgress?: (done: number, total: number) => void,
): Promise<RangeAlert[]> {
  const out: RangeAlert[] = [];
  const batch = 6;
  for (let i = 0; i < symbols.length; i += batch) {
    const chunk = symbols.slice(i, i + batch);
    const res = await Promise.all(chunk.map(scanRangeExtremes));
    res.forEach((r) => out.push(...r));
    onProgress?.(Math.min(i + batch, symbols.length), symbols.length);
  }
  const rank = { at: 0, near: 1, approaching: 2 } as const;
  return out.sort((a, b) =>
    rank[a.stage] - rank[b.stage] || b.touchChance - a.touchChance || a.distancePct - b.distancePct);
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
  return `${a.symbol}:${a.kind}:${a.lookbackDays}:${a.stage}:${a.level.toPrecision(6)}`;
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
    ? `${pretty} · at ${a.lookbackDays}D HIGH — fade / take profit`
    : `${pretty} · at ${a.lookbackDays}D LOW — buy & hold tight`;
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
