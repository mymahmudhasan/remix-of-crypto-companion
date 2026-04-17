// Institutional footprint detection. Pure functions on candle arrays + futures metrics.
import type { Kline } from "@/lib/binance";

export type FootprintType =
  | "volume_spike"        // Bar volume >> recent average
  | "absorption"          // Heavy volume but tiny body — large player absorbing
  | "liquidity_sweep_high"// Wick took out N-bar high then closed back inside
  | "liquidity_sweep_low" // Wick took out N-bar low then closed back inside
  | "wick_reject_top"     // Long upper wick, small body, near recent high
  | "wick_reject_bot"     // Long lower wick, small body, near recent low
  | "obv_divergence_bull" // Price lower-low, OBV higher-low
  | "obv_divergence_bear" // Price higher-high, OBV lower-high
  | "oi_long_squeeze"     // OI rising + price falling = trapped longs (futures)
  | "oi_short_squeeze"    // OI rising + price rising = potential short squeeze
  | "funding_extreme_long"// Funding very positive (overcrowded longs)
  | "funding_extreme_short"; // Funding very negative (overcrowded shorts)

export interface Footprint {
  type: FootprintType;
  /** Bar index in the candles array. */
  index: number;
  /** UNIX seconds (bar time). */
  time: number;
  /** Price location of the footprint. */
  price: number;
  /** 1-5 confidence weight. */
  weight: number;
  /** Bull / bear / neutral implication for next move. */
  implication: "bull" | "bear" | "neutral";
  /** Short human label. */
  label: string;
  /** Extra context. */
  detail: string;
}

const FOOTPRINT_META: Record<FootprintType, { label: string; tone: "bull" | "bear" | "neutral" }> = {
  volume_spike:           { label: "Volume Spike",        tone: "neutral" },
  absorption:             { label: "Absorption",          tone: "neutral" },
  liquidity_sweep_high:   { label: "Sweep of Highs",      tone: "bear" },
  liquidity_sweep_low:    { label: "Sweep of Lows",       tone: "bull" },
  wick_reject_top:        { label: "Upper Wick Rejection",tone: "bear" },
  wick_reject_bot:        { label: "Lower Wick Rejection",tone: "bull" },
  obv_divergence_bull:    { label: "Bullish OBV Divergence", tone: "bull" },
  obv_divergence_bear:    { label: "Bearish OBV Divergence", tone: "bear" },
  oi_long_squeeze:        { label: "Long Squeeze (OI ↑ price ↓)", tone: "bear" },
  oi_short_squeeze:       { label: "Short Squeeze (OI ↑ price ↑)", tone: "bull" },
  funding_extreme_long:   { label: "Crowded Longs (high funding)", tone: "bear" },
  funding_extreme_short:  { label: "Crowded Shorts (negative funding)", tone: "bull" },
};

export function footprintMeta(t: FootprintType) {
  return FOOTPRINT_META[t];
}

/** On-balance volume series. */
export function obv(closes: number[], volumes: number[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const dir = closes[i] > closes[i - 1] ? 1 : closes[i] < closes[i - 1] ? -1 : 0;
    out.push(out[i - 1] + dir * volumes[i]);
  }
  return out;
}

/** Detect candle-based footprints in the most recent `lookback` bars. */
export function detectCandleFootprints(
  candles: Kline[],
  opts: { lookback?: number; volWindow?: number } = {}
): Footprint[] {
  const { lookback = 50, volWindow = 20 } = opts;
  const n = candles.length;
  if (n < volWindow + 5) return [];

  const out: Footprint[] = [];
  const start = Math.max(volWindow + 1, n - lookback);

  for (let i = start; i < n; i++) {
    const c = candles[i];
    const range = c.high - c.low || 1e-9;
    const body = Math.abs(c.close - c.open);
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const bodyPct = body / range;

    // Volume context
    const volSlice = candles.slice(i - volWindow, i).map((k) => k.volume);
    const volAvg = volSlice.reduce((a, b) => a + b, 0) / volWindow || 1e-9;
    const volR = c.volume / volAvg;

    // 1) Volume spike
    if (volR >= 2.5) {
      out.push({
        type: "volume_spike",
        index: i, time: c.time, price: c.close,
        weight: volR >= 4 ? 5 : volR >= 3 ? 4 : 3,
        implication: c.close >= c.open ? "bull" : "bear",
        label: FOOTPRINT_META.volume_spike.label,
        detail: `${volR.toFixed(2)}× avg volume on a ${c.close >= c.open ? "green" : "red"} bar`,
      });
    }

    // 2) Absorption: 2× volume but body <25% of range — heavy size, no progress
    if (volR >= 2 && bodyPct < 0.25) {
      out.push({
        type: "absorption",
        index: i, time: c.time, price: c.close,
        weight: 4,
        implication: "neutral",
        label: FOOTPRINT_META.absorption.label,
        detail: `Heavy volume (${volR.toFixed(2)}×) absorbed — small body ${(bodyPct * 100).toFixed(0)}% of range`,
      });
    }

    // 3) Liquidity sweeps — wick took out N-bar extreme then closed back inside
    const sweepWindow = 20;
    if (i >= sweepWindow) {
      const prevHighs = candles.slice(i - sweepWindow, i).map((k) => k.high);
      const prevLows = candles.slice(i - sweepWindow, i).map((k) => k.low);
      const prevHigh = Math.max(...prevHighs);
      const prevLow = Math.min(...prevLows);
      if (c.high > prevHigh && c.close < prevHigh) {
        out.push({
          type: "liquidity_sweep_high",
          index: i, time: c.time, price: c.high,
          weight: 5,
          implication: "bear",
          label: FOOTPRINT_META.liquidity_sweep_high.label,
          detail: `Took out ${sweepWindow}-bar high ${prevHigh.toFixed(6)} and closed back below`,
        });
      }
      if (c.low < prevLow && c.close > prevLow) {
        out.push({
          type: "liquidity_sweep_low",
          index: i, time: c.time, price: c.low,
          weight: 5,
          implication: "bull",
          label: FOOTPRINT_META.liquidity_sweep_low.label,
          detail: `Took out ${sweepWindow}-bar low ${prevLow.toFixed(6)} and closed back above`,
        });
      }
    }

    // 4) Wick rejections — pin bars
    if (upperWick >= body * 2 && upperWick / range >= 0.5 && bodyPct < 0.35) {
      out.push({
        type: "wick_reject_top",
        index: i, time: c.time, price: c.high,
        weight: volR >= 1.5 ? 4 : 3,
        implication: "bear",
        label: FOOTPRINT_META.wick_reject_top.label,
        detail: `Long upper wick (${(upperWick / range * 100).toFixed(0)}% of range) — sellers stepped in`,
      });
    }
    if (lowerWick >= body * 2 && lowerWick / range >= 0.5 && bodyPct < 0.35) {
      out.push({
        type: "wick_reject_bot",
        index: i, time: c.time, price: c.low,
        weight: volR >= 1.5 ? 4 : 3,
        implication: "bull",
        label: FOOTPRINT_META.wick_reject_bot.label,
        detail: `Long lower wick (${(lowerWick / range * 100).toFixed(0)}% of range) — buyers defended`,
      });
    }
  }

  // 5) OBV divergence on the most recent ~30 bars
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const obvSeries = obv(closes, volumes);
  const divWindow = 30;
  if (n >= divWindow + 5) {
    const recent = candles.slice(-divWindow);
    const recentObv = obvSeries.slice(-divWindow);
    const lows = recent.map((c, i) => ({ v: c.low, i, obv: recentObv[i] }));
    const highs = recent.map((c, i) => ({ v: c.high, i, obv: recentObv[i] }));
    lows.sort((a, b) => a.v - b.v);
    highs.sort((a, b) => b.v - a.v);
    const [l1, l2] = lows;
    const [h1, h2] = highs;
    if (l1 && l2 && Math.abs(l1.i - l2.i) >= 5) {
      const earlier = l1.i < l2.i ? l1 : l2;
      const later = l1.i < l2.i ? l2 : l1;
      if (later.v < earlier.v && later.obv > earlier.obv) {
        const idx = n - divWindow + later.i;
        out.push({
          type: "obv_divergence_bull",
          index: idx, time: candles[idx].time, price: candles[idx].low,
          weight: 4, implication: "bull",
          label: FOOTPRINT_META.obv_divergence_bull.label,
          detail: "Price lower-low while OBV held a higher-low — accumulation",
        });
      }
    }
    if (h1 && h2 && Math.abs(h1.i - h2.i) >= 5) {
      const earlier = h1.i < h2.i ? h1 : h2;
      const later = h1.i < h2.i ? h2 : h1;
      if (later.v > earlier.v && later.obv < earlier.obv) {
        const idx = n - divWindow + later.i;
        out.push({
          type: "obv_divergence_bear",
          index: idx, time: candles[idx].time, price: candles[idx].high,
          weight: 4, implication: "bear",
          label: FOOTPRINT_META.obv_divergence_bear.label,
          detail: "Price higher-high while OBV made a lower-high — distribution",
        });
      }
    }
  }

  // De-duplicate same type+index
  const seen = new Set<string>();
  return out.filter((f) => {
    const k = `${f.type}:${f.index}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Futures-only: derive footprints from open interest history + funding rate. */
export interface FuturesContext {
  /** Open interest history aligned newest-last. */
  oiHistory?: { time: number; oi: number }[];
  /** Latest funding rate as a fraction per 8h (e.g. 0.0001 = 0.01%). */
  fundingRate?: number | null;
}

export function detectFuturesFootprints(
  candles: Kline[],
  ctx: FuturesContext
): Footprint[] {
  const out: Footprint[] = [];
  const n = candles.length;

  // OI vs price — compare last 10 bars
  if (ctx.oiHistory && ctx.oiHistory.length >= 6 && n >= 10) {
    const oiNow = ctx.oiHistory[ctx.oiHistory.length - 1].oi;
    const oiThen = ctx.oiHistory[Math.max(0, ctx.oiHistory.length - 6)].oi;
    const oiPct = ((oiNow - oiThen) / Math.max(oiThen, 1e-9)) * 100;
    const pNow = candles[n - 1].close;
    const pThen = candles[n - 10].close;
    const pricePct = ((pNow - pThen) / pThen) * 100;

    if (oiPct >= 5 && pricePct <= -1.5) {
      out.push({
        type: "oi_long_squeeze",
        index: n - 1, time: candles[n - 1].time, price: pNow,
        weight: 5, implication: "bear",
        label: FOOTPRINT_META.oi_long_squeeze.label,
        detail: `OI +${oiPct.toFixed(1)}% while price ${pricePct.toFixed(1)}% — late longs trapped`,
      });
    } else if (oiPct >= 5 && pricePct >= 2) {
      out.push({
        type: "oi_short_squeeze",
        index: n - 1, time: candles[n - 1].time, price: pNow,
        weight: 4, implication: "bull",
        label: FOOTPRINT_META.oi_short_squeeze.label,
        detail: `OI +${oiPct.toFixed(1)}% with price +${pricePct.toFixed(1)}% — fresh longs / squeeze fuel`,
      });
    }
  }

  if (ctx.fundingRate !== null && ctx.fundingRate !== undefined && n > 0) {
    const fr = ctx.fundingRate;
    const annualized = fr * 3 * 365 * 100;
    if (fr >= 0.0005) {
      out.push({
        type: "funding_extreme_long",
        index: n - 1, time: candles[n - 1].time, price: candles[n - 1].close,
        weight: 4, implication: "bear",
        label: FOOTPRINT_META.funding_extreme_long.label,
        detail: `Funding ${(fr * 100).toFixed(3)}% / 8h (~${annualized.toFixed(0)}% APR) — longs paying premium`,
      });
    } else if (fr <= -0.0003) {
      out.push({
        type: "funding_extreme_short",
        index: n - 1, time: candles[n - 1].time, price: candles[n - 1].close,
        weight: 4, implication: "bull",
        label: FOOTPRINT_META.funding_extreme_short.label,
        detail: `Funding ${(fr * 100).toFixed(3)}% / 8h (~${annualized.toFixed(0)}% APR) — shorts paying premium`,
      });
    }
  }

  return out;
}

/** Net institutional bias from a footprint list. */
export function footprintBias(fps: Footprint[]): { bias: "bull" | "bear" | "neutral"; bullScore: number; bearScore: number } {
  let bull = 0, bear = 0;
  for (const f of fps) {
    if (f.implication === "bull") bull += f.weight;
    else if (f.implication === "bear") bear += f.weight;
  }
  const diff = bull - bear;
  const bias = diff >= 4 ? "bull" : diff <= -4 ? "bear" : "neutral";
  return { bias, bullScore: bull, bearScore: bear };
}

/** Fetch Binance futures (USDM) open interest history. Returns null if symbol not on futures. */
export async function fetchOIHistory(symbol: string, period = "1h", limit = 30): Promise<{ time: number; oi: number }[] | null> {
  try {
    const url = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${period}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: any[] = await res.json();
    return data.map((d) => ({ time: Math.floor(d.timestamp / 1000), oi: parseFloat(d.sumOpenInterest) }));
  } catch { return null; }
}

/** Fetch latest funding rate for a USDM perp. */
export async function fetchFundingRate(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
    if (!res.ok) return null;
    const data = await res.json();
    const fr = parseFloat(data.lastFundingRate);
    return isFinite(fr) ? fr : null;
  } catch { return null; }
}
