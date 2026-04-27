// Tool-using crypto trading assistant.
// The model can call: get_price, get_indicators, get_gas, get_news_sentiment, get_token_security.
// We loop until the model returns a final text answer (max 4 tool rounds).
import { corsHeaders } from "npm:@supabase/supabase-js/cors";

interface Msg { role: "user" | "assistant" | "system" | "tool"; content: string; tool_call_id?: string; name?: string; tool_calls?: any[] }

interface Body {
  messages: { role: "user" | "assistant"; content: string }[];
  context?: {
    symbol: string;
    interval: string;
    snapshot: Record<string, number | null | string>;
    bias: string;
    score: number;
    reasons: string[];
  };
}

const BINANCE = "https://api.binance.com";

// ---------- TOOL IMPLEMENTATIONS ----------

function pairOf(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.endsWith("USDT") || s.endsWith("USDC") || s.endsWith("BUSD")) return s;
  return `${s}USDT`;
}

async function tool_get_price(args: { symbol: string }) {
  const sym = pairOf(args.symbol);
  const r = await fetch(`${BINANCE}/api/v3/ticker/24hr?symbol=${sym}`);
  if (!r.ok) return { error: `No data for ${sym}` };
  const d = await r.json();
  return {
    symbol: sym,
    price: parseFloat(d.lastPrice),
    change24hPct: parseFloat(d.priceChangePercent),
    high24h: parseFloat(d.highPrice),
    low24h: parseFloat(d.lowPrice),
    volume24hQuote: parseFloat(d.quoteVolume),
  };
}

// Lightweight EMA/RSI/MACD computation on the edge (avoid importing heavy libs)
function ema(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = e;
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}
function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

/**
 * RFD — Rate of Force Development. Acceleration of volume-weighted momentum.
 * Returns a -100..+100 oscillator and divergence flag. See src/lib/indicators.ts
 * for the full spec; this is a server-side mirror.
 */
function rfd(closes: number[], volumes: number[], fast = 5, slow = 13) {
  const n = closes.length;
  if (n < slow + 6 || volumes.length !== n) return { value: null, prev: null, delta: null, crossUp: false, crossDown: false, divergence: null as null | "bull" | "bear" };
  const force: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) force[i] = (closes[i] - closes[i - 1]) * volumes[i];
  const series: (number | null)[] = new Array(n).fill(null);
  for (let i = slow; i < n; i++) {
    const fastWin = force.slice(i - fast + 1, i + 1);
    const slowWin = force.slice(i - slow + 1, i + 1);
    const meanFast = fastWin.reduce((s, v) => s + v, 0) / fast;
    const meanSlow = slowWin.reduce((s, v) => s + v, 0) / slow;
    const absMean = slowWin.reduce((s, v) => s + Math.abs(v), 0) / slow;
    const variance = slowWin.reduce((s, v) => s + (Math.abs(v) - absMean) ** 2, 0) / slow;
    const sigma = Math.sqrt(variance);
    const denom = sigma + absMean * 0.5;
    const raw = denom > 0 ? (meanFast - meanSlow) / denom : 0;
    series[i] = Math.max(-100, Math.min(100, raw * 35));
  }
  const value = series[n - 1];
  const prev = series[n - 2] ?? null;
  const delta = value !== null && prev !== null ? value - prev : null;
  const crossUp = value !== null && prev !== null && prev <= 0 && value > 0;
  const crossDown = value !== null && prev !== null && prev >= 0 && value < 0;
  let divergence: null | "bull" | "bear" = null;
  if (value !== null && n >= 25) {
    const priceWin = closes.slice(-20);
    const rfdWin = series.slice(-20).map((v) => v ?? 0);
    const priceMaxIdx = priceWin.indexOf(Math.max(...priceWin));
    const priceMinIdx = priceWin.indexOf(Math.min(...priceWin));
    const rfdMax = Math.max(...rfdWin);
    const rfdMin = Math.min(...rfdWin);
    if (priceMaxIdx >= 15 && value < rfdMax - 25 && value < 30) divergence = "bear";
    else if (priceMinIdx >= 15 && value > rfdMin + 25 && value > -30) divergence = "bull";
  }
  return { value, prev, delta, crossUp, crossDown, divergence };
}

async function tool_get_indicators(args: { symbol: string; interval?: string }) {
  const sym = pairOf(args.symbol);
  const tf = args.interval ?? "1h";
  const r = await fetch(`${BINANCE}/api/v3/klines?symbol=${sym}&interval=${tf}&limit=300`);
  if (!r.ok) return { error: `No klines for ${sym} ${tf}` };
  const k: any[][] = await r.json();
  const closes = k.map((c) => parseFloat(c[4]));
  const volumes = k.map((c) => parseFloat(c[5]));
  const price = closes[closes.length - 1];
  const e20 = ema(closes, 20).at(-1) ?? null;
  const e50 = ema(closes, 50).at(-1) ?? null;
  const e200 = ema(closes, 200).at(-1) ?? null;
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const macdLine = closes.map((_, i) => (e12[i] !== undefined && e26[i] !== undefined ? e12[i] - e26[i] : null)).filter((v) => v !== null) as number[];
  const sigLine = ema(macdLine, 9);
  const macd = macdLine.at(-1) ?? null;
  const macdSig = sigLine.at(-1) ?? null;
  const macdHist = macd !== null && macdSig !== null ? macd - macdSig : null;
  const r14 = rsi(closes, 14);
  const recentHigh = Math.max(...closes.slice(-50));
  const recentLow = Math.min(...closes.slice(-50));
  const rfdData = rfd(closes, volumes, 5, 13);
  // Bias verdict — RFD now contributes alongside MACD
  const above200 = e200 !== null && price > e200;
  const above50 = e50 !== null && price > e50;
  const rfdBull = (rfdData.value ?? 0) > 25 || rfdData.crossUp;
  const rfdBear = (rfdData.value ?? 0) < -25 || rfdData.crossDown;
  let verdict = "neutral";
  if (above200 && above50 && (r14 ?? 50) > 50 && (macdHist ?? 0) > 0 && !rfdBear) verdict = "bullish";
  else if (!above200 && !above50 && (r14 ?? 50) < 50 && (macdHist ?? 0) < 0 && !rfdBull) verdict = "bearish";
  let zone = "neutral";
  if ((r14 ?? 50) > 70) zone = "overbought";
  else if ((r14 ?? 50) < 30) zone = "oversold";
  return {
    symbol: sym, interval: tf, price,
    rsi14: r14 !== null ? +r14.toFixed(2) : null,
    ema20: e20, ema50: e50, ema200: e200,
    macd, macdSignal: macdSig, macdHist,
    rfd: rfdData.value !== null ? +rfdData.value.toFixed(1) : null,
    rfdDelta: rfdData.delta !== null ? +rfdData.delta.toFixed(1) : null,
    rfdCrossUp: rfdData.crossUp,
    rfdCrossDown: rfdData.crossDown,
    rfdDivergence: rfdData.divergence,
    recentHigh, recentLow,
    verdict, zone,
  };
}

async function tool_get_gas(args: { chain?: string }) {
  const chain = (args.chain ?? "ethereum").toLowerCase();
  // Owlracle public endpoint (no key needed for low-rate calls)
  const slug = chain === "polygon" || chain === "matic" ? "poly"
    : chain === "arbitrum" || chain === "arb" ? "arb"
    : chain === "bsc" || chain === "bnb" ? "bsc"
    : chain === "optimism" || chain === "op" ? "opt"
    : chain === "avalanche" || chain === "avax" ? "avax"
    : "eth";
  try {
    const r = await fetch(`https://api.owlracle.info/v4/${slug}/gas?apikey=`);
    if (!r.ok) return { error: `Gas API ${r.status}` };
    const d = await r.json();
    const speeds = d.speeds ?? [];
    return {
      chain: slug,
      slow: speeds[0]?.gasPrice ?? null,
      standard: speeds[1]?.gasPrice ?? null,
      fast: speeds[2]?.gasPrice ?? null,
      instant: speeds[3]?.gasPrice ?? null,
      unit: "gwei",
      baseFee: d.baseFee ?? null,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Gas fetch failed" };
  }
}

async function tool_get_news_sentiment(args: { symbol?: string }) {
  // Hit our own news-fetch function for consistency with the News tab.
  const projectUrl = Deno.env.get("SUPABASE_URL");
  const params = new URLSearchParams();
  if (args.symbol) params.set("symbol", args.symbol.replace(/USDT$/i, "").toUpperCase());
  params.set("limit", "20");
  try {
    const r = await fetch(`${projectUrl}/functions/v1/news-fetch?${params}`, {
      headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}` },
    });
    if (!r.ok) return { error: `News ${r.status}` };
    const d = await r.json();
    const items = (d.items ?? []) as any[];
    if (items.length === 0) return { items: [], sentiment: "neutral", score: 0, count: 0 };
    const score = items.reduce((s, it) => s + (it.sentimentScore ?? 0), 0) / items.length;
    const sentiment = score > 10 ? "bullish" : score < -10 ? "bearish" : "neutral";
    const top = items.slice(0, 5).map((it) => ({
      title: it.title, source: it.source, sentiment: it.sentiment, ageMinutes: Math.round((Date.now() - it.publishedAt) / 60000),
    }));
    return { count: items.length, avgScore: +score.toFixed(1), sentiment, topHeadlines: top };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "News fetch failed" };
  }
}

async function tool_get_orderbook_heatmap(args: { symbol: string; depthPct?: number }) {
  const sym = pairOf(args.symbol);
  const depthPct = Math.max(0.1, Math.min(args.depthPct ?? 2, 10)); // % around mid price
  try {
    const r = await fetch(`${BINANCE}/api/v3/depth?symbol=${sym}&limit=1000`);
    if (!r.ok) return { error: `Depth ${r.status} for ${sym}` };
    const d = await r.json();
    const bids: [string, string][] = d.bids ?? [];
    const asks: [string, string][] = d.asks ?? [];
    if (!bids.length || !asks.length) return { error: "Empty book" };
    const bestBid = parseFloat(bids[0][0]);
    const bestAsk = parseFloat(asks[0][0]);
    const mid = (bestBid + bestAsk) / 2;
    const lo = mid * (1 - depthPct / 100);
    const hi = mid * (1 + depthPct / 100);

    type Lvl = { price: number; qty: number; notional: number };
    const bidLvls: Lvl[] = bids
      .map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q), notional: parseFloat(p) * parseFloat(q) }))
      .filter((l) => l.price >= lo);
    const askLvls: Lvl[] = asks
      .map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q), notional: parseFloat(p) * parseFloat(q) }))
      .filter((l) => l.price <= hi);

    const bidNotional = bidLvls.reduce((s, l) => s + l.notional, 0);
    const askNotional = askLvls.reduce((s, l) => s + l.notional, 0);
    const imbalance = bidNotional + askNotional > 0
      ? (bidNotional - askNotional) / (bidNotional + askNotional)
      : 0;

    // Top 5 liquidity "walls" each side by notional
    const topBidWalls = [...bidLvls].sort((a, b) => b.notional - a.notional).slice(0, 5)
      .map((l) => ({ price: l.price, notionalUSD: Math.round(l.notional), distancePct: +(((l.price - mid) / mid) * 100).toFixed(2) }));
    const topAskWalls = [...askLvls].sort((a, b) => b.notional - a.notional).slice(0, 5)
      .map((l) => ({ price: l.price, notionalUSD: Math.round(l.notional), distancePct: +(((l.price - mid) / mid) * 100).toFixed(2) }));

    const verdict = imbalance > 0.2 ? "bid-heavy (support)"
      : imbalance < -0.2 ? "ask-heavy (resistance)"
      : "balanced";

    return {
      symbol: sym,
      mid,
      spreadBps: +(((bestAsk - bestBid) / mid) * 10000).toFixed(2),
      windowPct: depthPct,
      bidLiquidityUSD: Math.round(bidNotional),
      askLiquidityUSD: Math.round(askNotional),
      imbalance: +imbalance.toFixed(3),
      verdict,
      topBidWalls,
      topAskWalls,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Heatmap fetch failed" };
  }
}

async function tool_get_liquidations(args: { symbol: string }) {
  const sym = pairOf(args.symbol);
  const FAPI = "https://fapi.binance.com";
  try {
    // Funding, open interest, long/short ratio, recent forced liquidation orders
    const [premRes, oiRes, lsRes, liqRes, oiHistRes] = await Promise.all([
      fetch(`${FAPI}/fapi/v1/premiumIndex?symbol=${sym}`),
      fetch(`${FAPI}/fapi/v1/openInterest?symbol=${sym}`),
      fetch(`${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=1h&limit=1`),
      fetch(`${FAPI}/fapi/v1/forceOrders?symbol=${sym}&limit=100`).catch(() => null),
      fetch(`${FAPI}/futures/data/openInterestHist?symbol=${sym}&period=1h&limit=24`),
    ]);

    if (!premRes.ok) return { error: `No futures market for ${sym} (perp may not exist)` };

    const prem = await premRes.json();
    const oi = oiRes.ok ? await oiRes.json() : null;
    const ls = lsRes.ok ? await lsRes.json() : [];
    const oiHist = oiHistRes.ok ? await oiHistRes.json() : [];

    const markPrice = parseFloat(prem.markPrice);
    const fundingRate = parseFloat(prem.lastFundingRate);
    const fundingPct8h = +(fundingRate * 100).toFixed(4);
    const fundingAPR = +(fundingRate * 3 * 365 * 100).toFixed(2);

    const oiContracts = oi ? parseFloat(oi.openInterest) : null;
    const oiNotional = oiContracts !== null ? Math.round(oiContracts * markPrice) : null;

    // OI 24h change
    let oiChange24hPct: number | null = null;
    if (Array.isArray(oiHist) && oiHist.length >= 2) {
      const first = parseFloat(oiHist[0].sumOpenInterest);
      const last = parseFloat(oiHist[oiHist.length - 1].sumOpenInterest);
      if (first > 0) oiChange24hPct = +(((last - first) / first) * 100).toFixed(2);
    }

    const lsRatio = Array.isArray(ls) && ls[0] ? +parseFloat(ls[0].longShortRatio).toFixed(2) : null;

    // Recent liquidations (forceOrders requires auth on some endpoints; treat as best-effort)
    let recentLiq: any = { available: false };
    if (liqRes && liqRes.ok) {
      const orders: any[] = await liqRes.json();
      if (Array.isArray(orders) && orders.length) {
        let longLiqUSD = 0, shortLiqUSD = 0;
        const cutoff = Date.now() - 60 * 60 * 1000;
        for (const o of orders) {
          if (o.time < cutoff) continue;
          const notional = parseFloat(o.price) * parseFloat(o.origQty);
          if (o.side === "SELL") longLiqUSD += notional; // long liquidated = forced sell
          else shortLiqUSD += notional;
        }
        recentLiq = {
          available: true,
          windowMinutes: 60,
          longLiqUSD: Math.round(longLiqUSD),
          shortLiqUSD: Math.round(shortLiqUSD),
          dominantSide: longLiqUSD > shortLiqUSD ? "longs getting wrecked" : "shorts getting squeezed",
        };
      }
    }

    // Squeeze / pressure verdict
    const fundingSignal = fundingPct8h > 0.05 ? "longs paying heavily (over-leveraged longs)"
      : fundingPct8h < -0.05 ? "shorts paying heavily (over-leveraged shorts)"
      : "neutral funding";
    const oiSignal = oiChange24hPct === null ? "n/a"
      : oiChange24hPct > 10 ? "OI rising sharply (new positions building)"
      : oiChange24hPct < -10 ? "OI dropping sharply (deleveraging)"
      : "OI stable";
    let squeezeRisk = "low";
    if (Math.abs(fundingPct8h) > 0.05 && (oiChange24hPct ?? 0) > 5) squeezeRisk = "elevated";
    if (Math.abs(fundingPct8h) > 0.1) squeezeRisk = "high";

    return {
      symbol: sym,
      markPrice,
      funding: { rate8h: fundingPct8h, apr: fundingAPR, signal: fundingSignal, unit: "%" },
      openInterest: { contracts: oiContracts, notionalUSD: oiNotional, change24hPct: oiChange24hPct, signal: oiSignal },
      longShortRatio: lsRatio,
      recentLiquidations: recentLiq,
      squeezeRisk,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Liquidation/derivs fetch failed" };
  }
}

// ---------- ADVANCED TOOLS: CVD, FUNDING SKEW, LIQUIDATION HEATMAP, NETFLOW ----------

async function tool_get_cvd(args: { symbol: string; interval?: string }) {
  const sym = pairOf(args.symbol);
  const tf = (args.interval ?? "1h").toLowerCase();
  // Map timeframe -> lookback ms
  const tfMs: Record<string, number> = { "15m": 15 * 60_000, "1h": 60 * 60_000, "4h": 4 * 60 * 60_000, "1d": 24 * 60 * 60_000 };
  const window = tfMs[tf] ?? 60 * 60_000;
  // Use Binance aggTrades (each trade has m=true if buyer is the market maker, i.e. aggressor was a SELLER).
  // We'll page back up to ~3 windows to compute deltas across periods.
  try {
    // Latest trades (no time filter -> last 1000)
    const r = await fetch(`${BINANCE}/api/v3/aggTrades?symbol=${sym}&limit=1000`);
    if (!r.ok) return { error: `aggTrades ${r.status} for ${sym}` };
    const trades: any[] = await r.json();
    if (!Array.isArray(trades) || !trades.length) return { error: "No trades" };
    const now = trades[trades.length - 1].T as number;
    const buckets = [
      { label: "lastWindow", from: now - window, to: now, buy: 0, sell: 0, count: 0 },
      { label: "prevWindow", from: now - 2 * window, to: now - window, buy: 0, sell: 0, count: 0 },
    ];
    let totalBuy = 0, totalSell = 0;
    let priceStart = parseFloat(trades[0].p);
    let priceEnd = parseFloat(trades[trades.length - 1].p);
    for (const t of trades) {
      const px = parseFloat(t.p);
      const qty = parseFloat(t.q);
      const notional = px * qty;
      // m=true => buyer is maker => trade was a market SELL (aggressive sell)
      const isAggressiveSell = t.m === true;
      if (isAggressiveSell) totalSell += notional; else totalBuy += notional;
      for (const b of buckets) {
        if (t.T >= b.from && t.T <= b.to) {
          if (isAggressiveSell) b.sell += notional; else b.buy += notional;
          b.count++;
        }
      }
    }
    const delta = totalBuy - totalSell;
    const total = totalBuy + totalSell;
    const dominance = total > 0 ? (delta / total) * 100 : 0;
    const lastDelta = buckets[0].buy - buckets[0].sell;
    const prevDelta = buckets[1].buy - buckets[1].sell;
    const priceChangePct = priceStart > 0 ? ((priceEnd - priceStart) / priceStart) * 100 : 0;
    // Divergence: price up but CVD down (or vice versa) over the sample
    let divergence = "none";
    if (priceChangePct > 0.2 && lastDelta < 0) divergence = "bearish (price up, aggressive selling)";
    else if (priceChangePct < -0.2 && lastDelta > 0) divergence = "bullish (price down, aggressive buying)";
    return {
      symbol: sym,
      interval: tf,
      tradesAnalyzed: trades.length,
      sampleMinutes: Math.round((now - trades[0].T) / 60000),
      totalBuyUSD: Math.round(totalBuy),
      totalSellUSD: Math.round(totalSell),
      cvdUSD: Math.round(delta),
      buyerDominancePct: +dominance.toFixed(2),
      lastWindow: { deltaUSD: Math.round(lastDelta), buyUSD: Math.round(buckets[0].buy), sellUSD: Math.round(buckets[0].sell) },
      prevWindow: { deltaUSD: Math.round(prevDelta), buyUSD: Math.round(buckets[1].buy), sellUSD: Math.round(buckets[1].sell) },
      priceChangePct: +priceChangePct.toFixed(3),
      divergence,
      verdict: dominance > 10 ? "buyers in control" : dominance < -10 ? "sellers in control" : "balanced",
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "CVD fetch failed" };
  }
}

async function tool_get_funding_skew(args: { symbol: string }) {
  const base = args.symbol.toUpperCase().replace(/USDT$|PERP$|-PERP$/, "");
  const binSym = `${base}USDT`;
  const bybitSym = `${base}USDT`;
  const okxInst = `${base}-USDT-SWAP`;
  try {
    const [binRes, byRes, okRes] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${binSym}`).catch(() => null),
      fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${bybitSym}`).catch(() => null),
      fetch(`https://www.okx.com/api/v5/public/funding-rate?instId=${okxInst}`).catch(() => null),
    ]);
    const out: any = { symbol: base, perPair: binSym, exchanges: {} as Record<string, any> };
    let rates: number[] = [];
    if (binRes && binRes.ok) {
      const d = await binRes.json();
      const rate = parseFloat(d.lastFundingRate);
      out.exchanges.binance = { fundingPct8h: +(rate * 100).toFixed(4), apr: +(rate * 3 * 365 * 100).toFixed(2), markPrice: parseFloat(d.markPrice) };
      rates.push(rate);
    } else out.exchanges.binance = { error: "unavailable" };
    if (byRes && byRes.ok) {
      const d = await byRes.json();
      const t = d?.result?.list?.[0];
      if (t) {
        const rate = parseFloat(t.fundingRate);
        out.exchanges.bybit = { fundingPct8h: +(rate * 100).toFixed(4), apr: +(rate * 3 * 365 * 100).toFixed(2), markPrice: parseFloat(t.markPrice) };
        rates.push(rate);
      } else out.exchanges.bybit = { error: "no data" };
    } else out.exchanges.bybit = { error: "unavailable" };
    if (okRes && okRes.ok) {
      const d = await okRes.json();
      const t = d?.data?.[0];
      if (t) {
        const rate = parseFloat(t.fundingRate);
        out.exchanges.okx = { fundingPct8h: +(rate * 100).toFixed(4), apr: +(rate * 3 * 365 * 100).toFixed(2), nextFundingTime: t.nextFundingTime };
        rates.push(rate);
      } else out.exchanges.okx = { error: "no data" };
    } else out.exchanges.okx = { error: "unavailable" };

    if (rates.length === 0) return { error: "no funding data from any exchange", ...out };
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    const avgPct = +(avg * 100).toFixed(4);
    const apr = +(avg * 3 * 365 * 100).toFixed(2);
    const max = Math.max(...rates);
    const min = Math.min(...rates);
    const dispersionPct = +((max - min) * 100).toFixed(4);

    let skew = "balanced";
    let dangerZone = "none";
    if (avgPct > 0.05) { skew = "longs paying (crowded long)"; dangerZone = avgPct > 0.1 ? "high (long-squeeze risk)" : "elevated"; }
    else if (avgPct < -0.05) { skew = "shorts paying (crowded short)"; dangerZone = avgPct < -0.1 ? "high (short-squeeze setup)" : "elevated"; }

    return {
      ...out,
      aggregate: { avgFundingPct8h: avgPct, avgAPR: apr, dispersionPct, exchangesReporting: rates.length },
      skew,
      dangerZone,
      verdict: dangerZone === "none"
        ? `Funding ${avgPct.toFixed(3)}%/8h — neutral positioning.`
        : `Funding ${avgPct.toFixed(3)}%/8h across ${rates.length} exchanges — ${skew}. Squeeze risk: ${dangerZone}.`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Funding skew fetch failed" };
  }
}

async function tool_get_liquidation_heatmap(args: { symbol: string }) {
  const sym = pairOf(args.symbol);
  const FAPI = "https://fapi.binance.com";
  const COINGLASS_KEY = Deno.env.get("COINGLASS_API_KEY");

  // Try Coinglass first if key present (true heatmap)
  if (COINGLASS_KEY) {
    try {
      const r = await fetch(`https://open-api-v3.coinglass.com/api/futures/liquidation/aggregated-heatmap/model2?symbol=${sym}&range=1d`, {
        headers: { "CG-API-KEY": COINGLASS_KEY },
      });
      if (r.ok) {
        const d = await r.json();
        return { source: "coinglass", symbol: sym, raw: d?.data ?? d };
      }
    } catch { /* fall through */ }
  }

  // Free derivation: use OI + a leverage tier model to estimate where stops cluster.
  try {
    const [oiRes, premRes] = await Promise.all([
      fetch(`${FAPI}/fapi/v1/openInterest?symbol=${sym}`),
      fetch(`${FAPI}/fapi/v1/premiumIndex?symbol=${sym}`),
    ]);
    if (!premRes.ok) return { error: `No futures market for ${sym}` };
    const prem = await premRes.json();
    const oi = oiRes.ok ? await oiRes.json() : null;
    const mark = parseFloat(prem.markPrice);
    const oiContracts = oi ? parseFloat(oi.openInterest) : 0;
    const oiNotional = oiContracts * mark;

    // Common isolated leverage tiers and rough share of OI sitting at each (heuristic).
    // Liquidation distance ≈ (1/lev) * (1 - maintMargin) ~ (1/lev)*0.99 for low MM coins.
    const tiers = [
      { lev: 5, share: 0.20 },
      { lev: 10, share: 0.30 },
      { lev: 25, share: 0.25 },
      { lev: 50, share: 0.15 },
      { lev: 100, share: 0.10 },
    ];
    const longClusters: { price: number; distancePct: number; estUSD: number; lev: number }[] = [];
    const shortClusters: typeof longClusters = [];
    for (const t of tiers) {
      const distPct = (1 / t.lev) * 0.99;
      const longLiqPx = mark * (1 - distPct);
      const shortLiqPx = mark * (1 + distPct);
      // Assume ~half of OI is long, half short, then split by leverage share.
      const estUSD = Math.round(oiNotional * 0.5 * t.share);
      longClusters.push({ price: +longLiqPx.toFixed(6), distancePct: +(distPct * -100).toFixed(2), estUSD, lev: t.lev });
      shortClusters.push({ price: +shortLiqPx.toFixed(6), distancePct: +(distPct * 100).toFixed(2), estUSD, lev: t.lev });
    }
    // Magnetic levels = biggest combined clusters near price (lowest leverage = most $)
    const magnets = [
      { side: "below (long liqs)", price: longClusters[1].price, distancePct: longClusters[1].distancePct, sizeUSD: longClusters[0].estUSD + longClusters[1].estUSD, why: "5×–10× long stops" },
      { side: "above (short liqs)", price: shortClusters[1].price, distancePct: shortClusters[1].distancePct, sizeUSD: shortClusters[0].estUSD + shortClusters[1].estUSD, why: "5×–10× short stops" },
    ];

    return {
      source: "derived (no Coinglass key)",
      note: "Estimated clusters from Binance OI × common leverage tiers. Add COINGLASS_API_KEY secret for true aggregated heatmap.",
      symbol: sym,
      markPrice: mark,
      oiNotionalUSD: Math.round(oiNotional),
      longLiqClusters: longClusters,
      shortLiqClusters: shortClusters,
      magnets,
      verdict: `Nearest magnets: ${magnets[0].price} (${magnets[0].distancePct}%) below and ${magnets[1].price} (+${magnets[1].distancePct}%) above. Price tends to gravitate toward the larger cluster.`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Liquidation heatmap failed" };
  }
}

async function tool_get_exchange_netflow(args: { symbol: string }) {
  const base = args.symbol.toUpperCase().replace(/USDT$/, "");
  // Free proxy: Whale Alert public stream via "io" mirror is paid; instead use blockchain.com (BTC) and Etherscan whale txs (ETH/ERC20).
  // Strategy:
  // - For BTC: use blockchain.com large-tx endpoint as a coarse proxy.
  // - For ETH and ERC-20s: use Etherscan public API to scan recent large transfers to/from known exchange addresses.
  // We keep this best-effort; if upstream rate-limits, return a clear note.
  const KNOWN_EXCHANGE_ETH = new Set([
    "0x28c6c06298d514db089934071355e5743bf21d60", // Binance 14
    "0x21a31ee1afc51d94c2efccaa2092ad1028285549", // Binance 15
    "0xdfd5293d8e347dfe59e90efd55b2956a1343963d", // Binance 16
    "0x56eddb7aa87536c09ccc2793473599fd21a8b17f", // Binance 17
    "0x9696f59e4d72e237be84ffd425dcad154bf96976", // Binance 18
    "0x564286362092d8e7936f0549571a803b203aaced", // Binance 19
    "0x0681d8db095565fe8a346fa0277bffde9c0edbbf", // Binance 20
    "0xf977814e90da44bfa03b6295a0616a897441acec", // Binance 8 (cold)
    "0x5754284f345afc66a98fbb0a0afe71e0f007b949", // Tether treasury (also exchange-like)
    "0x71660c4005ba85c37ccec55d0c4493e66fe775d3", // Coinbase 1
    "0x503828976d22510aad0201ac7ec88293211d23da", // Coinbase 2
    "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740", // Coinbase 3
    "0x3cd751e6b0078be393132286c442345e5dc49699", // Coinbase 4
    "0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511", // Coinbase 5
    "0xeb2629a2734e272bcc07bda959863f316f4bd4cf", // Coinbase 6
    "0xa910f92acdaf488fa6ef02174fb86208ad7722ba", // Kraken
  ]);

  try {
    if (base === "BTC") {
      // Use mempool.space recent large txs as a coarse proxy
      const r = await fetch("https://mempool.space/api/v1/mining/blocks/extras?limit=6");
      // Fall back: use blockchain.info large txs from latest unconfirmed
      const r2 = await fetch("https://blockchain.info/unconfirmed-transactions?format=json&cors=true");
      let largeTxBTC = 0, count = 0;
      if (r2.ok) {
        const d = await r2.json();
        const txs = (d?.txs ?? []) as any[];
        for (const tx of txs.slice(0, 200)) {
          const totalOut = (tx.out ?? []).reduce((s: number, o: any) => s + (o.value ?? 0), 0) / 1e8;
          if (totalOut >= 50) { largeTxBTC += totalOut; count++; }
        }
      }
      return {
        source: "blockchain.info unconfirmed (proxy)",
        symbol: "BTC",
        note: "Free proxy: counts unconfirmed BTC txs >= 50 BTC. True netflow needs CryptoQuant/Glassnode.",
        recentLargeTxBTC: +largeTxBTC.toFixed(2),
        recentLargeTxCount: count,
        verdict: count === 0 ? "no large flows detected in mempool right now"
          : count > 10 ? "elevated whale activity in mempool"
          : "moderate whale activity",
      };
    }

    // ETH or ERC-20: use Etherscan public (rate-limited, no key needed for low rates)
    if (base === "ETH") {
      const url = `https://api.etherscan.io/api?module=account&action=txlist&address=0x28c6c06298d514db089934071355e5743bf21d60&startblock=0&endblock=99999999&page=1&offset=50&sort=desc`;
      const r = await fetch(url);
      if (!r.ok) return { error: `Etherscan ${r.status}` };
      const d = await r.json();
      const txs = (d?.result ?? []) as any[];
      if (!Array.isArray(txs)) return { error: "Etherscan rate-limited (try later)" };
      const cutoff = Math.floor(Date.now() / 1000) - 24 * 3600;
      let inflowETH = 0, outflowETH = 0, inCount = 0, outCount = 0;
      for (const tx of txs) {
        if (Number(tx.timeStamp) < cutoff) continue;
        const value = Number(tx.value) / 1e18;
        if (value < 50) continue; // whale threshold
        const toBinance = tx.to?.toLowerCase() === "0x28c6c06298d514db089934071355e5743bf21d60";
        if (toBinance) { inflowETH += value; inCount++; }
        else { outflowETH += value; outCount++; }
      }
      const net = inflowETH - outflowETH;
      return {
        source: "etherscan (Binance hot wallet proxy)",
        symbol: "ETH",
        note: "Free proxy: tracks one Binance hot wallet only. True netflow needs CryptoQuant/Glassnode.",
        windowHours: 24,
        whaleThresholdETH: 50,
        inflowETH: +inflowETH.toFixed(2),
        outflowETH: +outflowETH.toFixed(2),
        netflowETH: +net.toFixed(2),
        inflowTxs: inCount,
        outflowTxs: outCount,
        verdict: net > 1000 ? "net inflow to exchange — potential sell pressure"
          : net < -1000 ? "net outflow from exchange — accumulation / cold-storage"
          : "roughly balanced flows",
      };
    }

    return {
      symbol: base,
      note: "Free netflow proxy currently supports BTC and ETH. For other tokens, add a CRYPTOQUANT_API_KEY or GLASSNODE_API_KEY secret for true per-asset netflows.",
      supported: ["BTC", "ETH"],
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Netflow fetch failed" };
  }
}

async function tool_get_token_security(args: { contractAddress: string; chain?: string }) {
  const chainId = (args.chain ?? "ethereum").toLowerCase();
  const idMap: Record<string, string> = {
    ethereum: "1", eth: "1",
    bsc: "56", bnb: "56",
    polygon: "137", matic: "137",
    arbitrum: "42161", arb: "42161",
    base: "8453",
    optimism: "10", op: "10",
    avalanche: "43114", avax: "43114",
  };
  const cid = idMap[chainId] ?? "1";
  try {
    const r = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${cid}?contract_addresses=${args.contractAddress.toLowerCase()}`);
    if (!r.ok) return { error: `GoPlus ${r.status}` };
    const d = await r.json();
    const t = d.result?.[args.contractAddress.toLowerCase()];
    if (!t) return { error: "Contract not found in GoPlus database" };
    const flags: string[] = [];
    if (t.is_honeypot === "1") flags.push("HONEYPOT");
    if (t.is_proxy === "1") flags.push("proxy contract");
    if (t.is_mintable === "1") flags.push("mintable");
    if (t.can_take_back_ownership === "1") flags.push("ownership can be taken back");
    if (t.owner_change_balance === "1") flags.push("owner can change balance");
    if (t.hidden_owner === "1") flags.push("hidden owner");
    if (t.selfdestruct === "1") flags.push("selfdestruct enabled");
    if (t.transfer_pausable === "1") flags.push("transfers pausable");
    if (parseFloat(t.buy_tax ?? "0") > 0.1) flags.push(`buy tax ${(parseFloat(t.buy_tax) * 100).toFixed(1)}%`);
    if (parseFloat(t.sell_tax ?? "0") > 0.1) flags.push(`sell tax ${(parseFloat(t.sell_tax) * 100).toFixed(1)}%`);
    const verdict = flags.includes("HONEYPOT") ? "DANGER" : flags.length >= 3 ? "high risk" : flags.length > 0 ? "medium risk" : "looks ok";
    return {
      symbol: t.token_symbol, name: t.token_name,
      verdict, flags,
      buyTax: t.buy_tax, sellTax: t.sell_tax,
      isOpenSource: t.is_open_source === "1",
      holders: t.holder_count, totalSupply: t.total_supply,
      lpHolders: t.lp_holder_count,
      lpLockedPct: t.lp_total_supply ? null : null,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Security check failed" };
  }
}

// ---------- TOOL SCHEMAS ----------

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_price",
      description: "Get the current price, 24h change %, 24h high/low, and 24h volume for a crypto symbol from Binance. Use for any 'what's the price of X' question.",
      parameters: {
        type: "object",
        properties: { symbol: { type: "string", description: "Token symbol or pair (e.g. 'BTC', 'SOL', 'ETHUSDT')." } },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_indicators",
      description: "Compute live technical indicators (RSI-14, EMA 20/50/200, MACD, recent range) for a symbol on a chosen timeframe. Use for 'is X overbought?', 'what's the trend?', 'is MACD bullish?'.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          interval: { type: "string", enum: ["15m", "1h", "4h", "1d"], description: "Default 1h." },
        },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_gas",
      description: "Get live gas prices in gwei for an EVM chain (slow/standard/fast/instant). Use for 'when's a good time to swap on Ethereum?'.",
      parameters: {
        type: "object",
        properties: { chain: { type: "string", enum: ["ethereum", "polygon", "arbitrum", "optimism", "bsc", "avalanche", "base"], description: "Default ethereum." } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_news_sentiment",
      description: "Get aggregated news sentiment (bullish/bearish/neutral) and the top recent headlines, optionally filtered to one token. Use for 'what's the news on X?', 'why is X pumping?'.",
      parameters: {
        type: "object",
        properties: { symbol: { type: "string", description: "Optional token filter (e.g. 'BTC')." } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_orderbook_heatmap",
      description: "Analyze the live order book (depth) for a symbol: total bid vs ask liquidity within ±depthPct of mid, imbalance score, and the top 5 bid/ask 'walls' (largest resting orders that act as support/resistance). Use for 'where's the liquidity?', 'is there a wall above price?', 'show me the heatmap'.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          depthPct: { type: "number", description: "Window around mid in percent (default 2, max 10)." },
        },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_liquidations",
      description: "Get derivatives stress signals from Binance Futures: funding rate (8h & APR), open interest + 24h change, long/short ratio, recent forced-liquidation flow (longs vs shorts wrecked in last hour), and an overall squeeze-risk verdict. Use for 'are longs over-leveraged?', 'short squeeze setup?', 'what's funding on X?', 'liquidation pressure?'.",
      parameters: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_cvd",
      description: "Cumulative Volume Delta from Binance aggregated trades — measures aggressive buyers vs aggressive sellers and detects price/CVD divergence (e.g. price up but selling = fake rally). Use for 'is this rally real?', 'are buyers actually stepping in?', 'CVD on X', 'price/volume divergence'.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          interval: { type: "string", enum: ["15m", "1h", "4h", "1d"], description: "Window for the last/prev delta comparison. Default 1h." },
        },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_funding_skew",
      description: "Aggregate perpetual funding rates across Binance, Bybit, and OKX, compute average + dispersion, and verdict whether the market is in long-squeeze or short-squeeze danger zone. Use for 'funding on X', 'is the market crowded long?', 'short squeeze setup?', 'sentiment skew'.",
      parameters: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_liquidation_heatmap",
      description: "Estimated liquidation level CLUSTERS (magnetic liquidity) above and below price by leverage tier (5×/10×/25×/50×/100×) — shows where leveraged stops sit and which side has the bigger magnet. Auto-uses Coinglass aggregated heatmap if COINGLASS_API_KEY is configured, else free derivation from Binance OI. Use for 'where will price magnet to?', 'liquidation heatmap', 'where are the stops?', 'liquidity above/below'.",
      parameters: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_exchange_netflow",
      description: "24h whale-tx proxy of exchange netflow for BTC or ETH — net inflow = sell pressure, net outflow = accumulation/cold-storage. Free proxy via mempool.space (BTC) and Etherscan Binance hot wallet (ETH). Other tokens not supported without a paid CryptoQuant/Glassnode key. Use for 'are whales depositing X?', 'exchange netflow', 'is supply leaving exchanges?'.",
      parameters: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_token_security",
      description: "Run a smart-contract security check via GoPlus: honeypot risk, buy/sell tax, mintable, ownership flags. Use ONLY when the user gives a contract address.",
      parameters: {
        type: "object",
        properties: {
          contractAddress: { type: "string", description: "0x… EVM contract address." },
          chain: { type: "string", enum: ["ethereum", "bsc", "polygon", "arbitrum", "base", "optimism", "avalanche"], description: "Default ethereum." },
        },
        required: ["contractAddress"],
        additionalProperties: false,
      },
    },
  },
];

async function runTool(name: string, args: any): Promise<any> {
  switch (name) {
    case "get_price": return await tool_get_price(args);
    case "get_indicators": return await tool_get_indicators(args);
    case "get_gas": return await tool_get_gas(args);
    case "get_news_sentiment": return await tool_get_news_sentiment(args);
    case "get_orderbook_heatmap": return await tool_get_orderbook_heatmap(args);
    case "get_liquidations": return await tool_get_liquidations(args);
    case "get_cvd": return await tool_get_cvd(args);
    case "get_funding_skew": return await tool_get_funding_skew(args);
    case "get_liquidation_heatmap": return await tool_get_liquidation_heatmap(args);
    case "get_exchange_netflow": return await tool_get_exchange_netflow(args);
    case "get_token_security": return await tool_get_token_security(args);
    default: return { error: `Unknown tool ${name}` };
  }
}

// ---------- HANDLER ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const body = (await req.json()) as Body;
    if (!body?.messages || !Array.isArray(body.messages)) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ctxText = body.context
      ? `\nCURRENT CHART CONTEXT (the user is looking at this right now):
- Pair: ${body.context.symbol}
- Timeframe: ${body.context.interval}
- Composite bias: ${body.context.bias.toUpperCase()} (score ${body.context.score})
- Snapshot: ${JSON.stringify(body.context.snapshot)}
- Reasons: ${body.context.reasons.join("; ")}
When the user says "this", "it", "the chart" — they mean ${body.context.symbol} on ${body.context.interval}.`
      : "";

    const system = `You are CryptoDesk, a sharp, honest crypto trading assistant for an experienced trader.

Style: concise, structured, terminal-flavored. Use bullet points and short sections (Setup / Plan / Risk).
Always discuss: entry zone, invalidation (stop), targets, position sizing in % risk terms when giving trade ideas.
Never guarantee outcomes. Educational analysis only — not financial advice.

TOOLS — call them whenever you need fresh data:
- get_price for current price / 24h change.
- get_indicators for RSI / EMA / MACD verdict (overbought, trend).
- get_gas for ETH/L2 gas in gwei.
- get_news_sentiment for headlines + bull/bear bias.
- get_orderbook_heatmap for liquidity walls, bid/ask imbalance, and key support/resistance from resting orders.
- get_liquidations for funding rate, open interest, long/short ratio, recent liquidations and squeeze risk (single-exchange Binance).
- get_cvd for Cumulative Volume Delta — aggressive buyers vs sellers and price/volume divergence ("is this rally fake?").
- get_funding_skew for multi-exchange funding (Binance + Bybit + OKX) and squeeze danger zone verdict.
- get_liquidation_heatmap for magnetic liquidity — where leveraged stops cluster above/below price.
- get_exchange_netflow for whale deposits/withdrawals to/from exchanges (BTC + ETH only on free tier).
- get_token_security ONLY when given a 0x contract address.

When the user asks for full analysis, a setup, or "should I long/short X" — combine indicators + heatmap + liquidations + CVD + funding skew to assess:
  • Trend (indicators)
  • Key levels (orderbook walls + liquidation magnets)
  • Real flow (CVD — is the move backed by aggressive orders, or is it fake?)
  • Positioning risk (funding skew across exchanges, OI, recent liquidations)
Cite the actual numbers (e.g. "bid wall at $X worth $Y", "Binance+Bybit+OKX avg funding 0.08%/8h → longs crowded", "CVD diverging bearish: price +1.2% but $4M net selling", "long magnet $58.2k worth ~$45M in 5–10× stops"). Be honest when data is missing or a token isn't supported.

You can chain tool calls. Prefer fewer (1-4) targeted calls over many. After tools return, synthesize into a final answer that quotes the specific numbers.${ctxText}`;

    const conversation: Msg[] = [
      { role: "system", content: system },
      ...body.messages,
    ];

    const toolTrace: { name: string; args: any }[] = [];
    let finalContent = "";

    // Tool-call loop (max 6 rounds to bound cost)
    for (let round = 0; round < 6; round++) {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: conversation,
          tools: TOOLS,
          tool_choice: "auto",
        }),
      });

      if (!resp.ok) {
        if (resp.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again in a moment." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (resp.status === 402) {
          return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in workspace settings." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const t = await resp.text();
        console.error("AI gateway error:", resp.status, t);
        return new Response(JSON.stringify({ error: "AI gateway error" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await resp.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error("No message in AI response");

      const toolCalls = msg.tool_calls as any[] | undefined;

      if (!toolCalls || toolCalls.length === 0) {
        finalContent = msg.content ?? "";
        break;
      }

      // Append assistant turn (must include tool_calls so the gateway accepts our tool replies).
      conversation.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });

      // Run each tool in parallel and append results.
      const results = await Promise.all(toolCalls.map(async (tc: any) => {
        let parsedArgs: any = {};
        try { parsedArgs = JSON.parse(tc.function.arguments || "{}"); } catch {}
        toolTrace.push({ name: tc.function.name, args: parsedArgs });
        const out = await runTool(tc.function.name, parsedArgs);
        return { id: tc.id, name: tc.function.name, out };
      }));

      for (const r of results) {
        conversation.push({
          role: "tool",
          tool_call_id: r.id,
          name: r.name,
          content: JSON.stringify(r.out),
        });
      }
    }

    if (!finalContent) {
      finalContent = "I gathered some data but couldn't form a final answer. Try rephrasing your question.";
    }

    return new Response(JSON.stringify({ content: finalContent, toolTrace }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("trade-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
