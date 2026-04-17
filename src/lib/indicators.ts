// Pure-function technical indicators

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    if (prev === null) {
      const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
      prev = seed;
      out.push(seed);
      continue;
    }
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = [null];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (i <= period) {
      avgGain += gain; avgLoss += loss;
      if (i === period) {
        avgGain /= period; avgLoss /= period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        out.push(100 - 100 / (1 + rs));
      } else {
        out.push(null);
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      out.push(100 - 100 / (1 + rs));
    }
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signalP = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? (emaFast[i] as number) - (emaSlow[i] as number) : null
  );
  const macdNumeric = macdLine.map((v) => v ?? 0);
  const signal = ema(macdNumeric, signalP).map((v, i) => (macdLine[i] === null ? null : v));
  const histogram = macdLine.map((v, i) =>
    v !== null && signal[i] !== null ? v - (signal[i] as number) : null
  );
  return { macd: macdLine, signal, histogram };
}

/** Bollinger Bands using SMA + std dev. */
export function bollinger(values: number[], period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { upper.push(null); lower.push(null); continue; }
    const slice = values.slice(i - period + 1, i + 1);
    const m = mid[i] as number;
    const variance = slice.reduce((a, b) => a + (b - m) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
  }
  return { upper, mid, lower };
}

/** Average True Range — needs OHLC, but we approximate from closes when only closes are available. */
export function atrFromOHLC(highs: number[], lows: number[], closes: number[], period = 14): (number | null)[] {
  const tr: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ));
  }
  // Wilder smoothing
  const out: (number | null)[] = [];
  let prev: number | null = null;
  for (let i = 0; i < tr.length; i++) {
    if (i < period) { out.push(null); continue; }
    if (prev === null) {
      prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
    } else {
      prev = (prev * (period - 1) + tr[i]) / period;
    }
    out.push(prev);
  }
  return out;
}

/** Stochastic %K (fast). */
export function stochastic(highs: number[], lows: number[], closes: number[], period = 14, smoothK = 3, smoothD = 3) {
  const k: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { k.push(null); continue; }
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    k.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
  }
  const kSmoothed = sma(k.map((v) => v ?? 0), smoothK).map((v, i) => (k[i] === null ? null : v));
  const d = sma(kSmoothed.map((v) => v ?? 0), smoothD).map((v, i) => (kSmoothed[i] === null ? null : v));
  return { k: kSmoothed, d };
}

/** Average volume ratio (current bar volume vs N-bar average). */
export function volumeRatio(volumes: number[], period = 20): number | null {
  if (volumes.length < period) return null;
  const recent = volumes.slice(-period);
  const avg = recent.reduce((a, b) => a + b, 0) / period;
  return avg > 0 ? volumes[volumes.length - 1] / avg : null;
}

export interface IndicatorSnapshot {
  price: number;
  rsi14: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  bbUpper: number | null;
  bbMid: number | null;
  bbLower: number | null;
  /** Position within Bollinger bands: 0 = lower band, 1 = upper band. */
  bbPercentB: number | null;
  atr14: number | null;
  /** ATR as % of price — volatility gauge. */
  atrPct: number | null;
  stochK: number | null;
  stochD: number | null;
  volRatio: number | null;
  recentHigh: number;
  recentLow: number;
  changePct: number;
}

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function snapshotFromCandles(candles: Candle[]): IndicatorSnapshot {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const vols = candles.map((c) => c.volume);
  const n = closes.length;
  const last = closes[n - 1];
  const e20 = ema(closes, 20)[n - 1];
  const e50 = ema(closes, 50)[n - 1];
  const e200 = ema(closes, 200)[n - 1];
  const r = rsi(closes, 14)[n - 1];
  const m = macd(closes);
  const bb = bollinger(closes, 20, 2);
  const atr = atrFromOHLC(highs, lows, closes, 14)[n - 1];
  const stoch = stochastic(highs, lows, closes, 14, 3, 3);
  const window = closes.slice(-50);
  const upper = bb.upper[n - 1];
  const lower = bb.lower[n - 1];
  const pctB = upper !== null && lower !== null && upper > lower
    ? (last - lower) / (upper - lower)
    : null;
  return {
    price: last,
    rsi14: r,
    ema20: e20,
    ema50: e50,
    ema200: e200,
    macd: m.macd[n - 1],
    macdSignal: m.signal[n - 1],
    macdHist: m.histogram[n - 1],
    bbUpper: upper,
    bbMid: bb.mid[n - 1],
    bbLower: lower,
    bbPercentB: pctB,
    atr14: atr,
    atrPct: atr !== null ? (atr / last) * 100 : null,
    stochK: stoch.k[n - 1],
    stochD: stoch.d[n - 1],
    volRatio: volumeRatio(vols, 20),
    recentHigh: Math.max(...window),
    recentLow: Math.min(...window),
    changePct: ((last - closes[Math.max(0, n - 50)]) / closes[Math.max(0, n - 50)]) * 100,
  };
}

/** Backwards-compatible: build a snapshot from closes only (no volume / OHLC-dependent fields). */
export function snapshot(closes: number[]): IndicatorSnapshot {
  const fake: Candle[] = closes.map((c) => ({ open: c, high: c, low: c, close: c, volume: 0 }));
  return snapshotFromCandles(fake);
}

export type SignalBias = "bull" | "bear" | "neutral";

export interface ScoredSignal {
  bias: SignalBias;
  score: number; // -100 ... 100
  reasons: string[];
}

export function scoreSignal(s: IndicatorSnapshot): ScoredSignal {
  let score = 0;
  const reasons: string[] = [];

  if (s.rsi14 !== null) {
    if (s.rsi14 < 30) { score += 25; reasons.push(`RSI oversold (${s.rsi14.toFixed(1)})`); }
    else if (s.rsi14 > 70) { score -= 25; reasons.push(`RSI overbought (${s.rsi14.toFixed(1)})`); }
    else if (s.rsi14 > 55) { score += 8; reasons.push(`RSI bullish (${s.rsi14.toFixed(1)})`); }
    else if (s.rsi14 < 45) { score -= 8; reasons.push(`RSI bearish (${s.rsi14.toFixed(1)})`); }
  }

  if (s.ema20 && s.ema50) {
    if (s.ema20 > s.ema50) { score += 15; reasons.push("EMA20 > EMA50 (uptrend)"); }
    else { score -= 15; reasons.push("EMA20 < EMA50 (downtrend)"); }
  }

  if (s.ema50 && s.ema200) {
    if (s.ema50 > s.ema200) { score += 15; reasons.push("EMA50 > EMA200 (long-term up)"); }
    else { score -= 15; reasons.push("EMA50 < EMA200 (long-term down)"); }
  }

  if (s.macd !== null && s.macdSignal !== null) {
    if (s.macd > s.macdSignal) { score += 12; reasons.push("MACD above signal"); }
    else { score -= 12; reasons.push("MACD below signal"); }
  }

  if (s.ema20 && s.price > s.ema20) { score += 8; reasons.push("Price above EMA20"); }
  else if (s.ema20) { score -= 8; reasons.push("Price below EMA20"); }

  if (s.bbPercentB !== null) {
    if (s.bbPercentB < 0.1) { score += 6; reasons.push("Hugging lower BB (mean-revert long)"); }
    else if (s.bbPercentB > 0.9) { score -= 6; reasons.push("Hugging upper BB (mean-revert short)"); }
  }

  if (s.stochK !== null && s.stochD !== null) {
    if (s.stochK < 20 && s.stochK > s.stochD) { score += 6; reasons.push("Stochastic oversold + cross up"); }
    else if (s.stochK > 80 && s.stochK < s.stochD) { score -= 6; reasons.push("Stochastic overbought + cross down"); }
  }

  if (s.volRatio !== null && s.volRatio > 1.5) {
    reasons.push(`Volume ${s.volRatio.toFixed(2)}× the 20-bar average (confirmation)`);
  }

  score = Math.max(-100, Math.min(100, score));
  const bias: SignalBias = score >= 20 ? "bull" : score <= -20 ? "bear" : "neutral";
  return { bias, score, reasons };
}
