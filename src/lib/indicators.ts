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
      // seed with SMA
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

export interface IndicatorSnapshot {
  price: number;
  rsi14: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  recentHigh: number;
  recentLow: number;
  changePct: number;
}

export function snapshot(closes: number[]): IndicatorSnapshot {
  const n = closes.length;
  const last = closes[n - 1];
  const e20 = ema(closes, 20)[n - 1];
  const e50 = ema(closes, 50)[n - 1];
  const e200 = ema(closes, 200)[n - 1];
  const r = rsi(closes, 14)[n - 1];
  const m = macd(closes);
  const window = closes.slice(-50);
  return {
    price: last,
    rsi14: r,
    ema20: e20,
    ema50: e50,
    ema200: e200,
    macd: m.macd[n - 1],
    macdSignal: m.signal[n - 1],
    macdHist: m.histogram[n - 1],
    recentHigh: Math.max(...window),
    recentLow: Math.min(...window),
    changePct: ((last - closes[Math.max(0, n - 50)]) / closes[Math.max(0, n - 50)]) * 100,
  };
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

  score = Math.max(-100, Math.min(100, score));
  const bias: SignalBias = score >= 20 ? "bull" : score <= -20 ? "bear" : "neutral";
  return { bias, score, reasons };
}
