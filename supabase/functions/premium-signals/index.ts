// Premium Signals — scans top 30 USDT perps, prefilters by confluence,
// then asks the AI to pick top 5 highest-conviction setups with full plans.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Multiple Binance hosts — some are geo-blocked from Supabase edge regions, so we fail over.
const FAPI_HOSTS = [
  "https://fapi.binance.com",
  "https://www.binance.com",          // serves /fapi via reverse proxy in many regions
];
const SPOT_HOSTS = [
  "https://api.binance.com",
  "https://data-api.binance.vision",   // Binance's read-only data mirror, rarely geo-blocked
  "https://api1.binance.com",
  "https://api2.binance.com",
];

async function fetchWithFailover(hosts: string[], path: string): Promise<Response | null> {
  for (const host of hosts) {
    try {
      const r = await fetch(`${host}${path}`, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (r.ok) return r;
    } catch { /* try next */ }
  }
  return null;
}

// ---------------- math ----------------
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
function atr(highs: number[], lows: number[], closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ));
  }
  // Wilder
  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
  }
  return prev;
}

// ---------------- universe ----------------
async function fetchTopTickers(limit = 30): Promise<any[]> {
  // Try futures first; if blocked, fall back to spot 24hr ticker (still ranks by volume well).
  const r = await fetchWithFailover(FAPI_HOSTS, "/fapi/v1/ticker/24hr");
  if (r) {
    const arr: any[] = await r.json();
    return arr
      .filter((t) => t.symbol.endsWith("USDT") && !t.symbol.includes("_"))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, limit);
  }
  const r2 = await fetchWithFailover(SPOT_HOSTS, "/api/v3/ticker/24hr");
  if (!r2) throw new Error("All Binance hosts blocked (futures + spot)");
  const arr: any[] = await r2.json();
  return arr
    .filter((t) => t.symbol.endsWith("USDT") && !t.symbol.includes("UPUSDT") && !t.symbol.includes("DOWNUSDT") && !t.symbol.includes("BULLUSDT") && !t.symbol.includes("BEARUSDT"))
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, limit);
}

// ---------------- per-symbol metrics ----------------
async function fetchKlines(symbol: string, interval: string, limit = 200) {
  // Prefer futures klines, fall back to spot.
  let r = await fetchWithFailover(FAPI_HOSTS, `/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!r) r = await fetchWithFailover(SPOT_HOSTS, `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!r) throw new Error(`klines blocked ${symbol} ${interval}`);
  const raw: any[][] = await r.json();
  return raw.map((k) => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]),
    close: parseFloat(k[4]), volume: parseFloat(k[5]),
  }));
}
async function fetchFunding(symbol: string): Promise<number | null> {
  const r = await fetchWithFailover(FAPI_HOSTS, `/fapi/v1/premiumIndex?symbol=${symbol}`);
  if (!r) return null;
  try {
    const d = await r.json();
    return parseFloat(d.lastFundingRate);
  } catch { return null; }
}
async function fetchOIChange(symbol: string): Promise<number | null> {
  const r = await fetchWithFailover(FAPI_HOSTS, `/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=24`);
  if (!r) return null;
  try {
    const arr: any[] = await r.json();
    if (arr.length < 2) return null;
    const first = parseFloat(arr[0].sumOpenInterest);
    const last = parseFloat(arr[arr.length - 1].sumOpenInterest);
    if (!first) return null;
    return ((last - first) / first) * 100;
  } catch { return null; }
}
async function fetchCVD(symbol: string): Promise<{ cvd: number; lastBuyRatio: number } | null> {
  const r = await fetchWithFailover(SPOT_HOSTS, `/api/v3/klines?symbol=${symbol}&interval=5m&limit=48`);
  if (!r) return null;
  try {
    const arr: any[][] = await r.json();
    let cvd = 0;
    let buy = 0, total = 0;
    for (const k of arr) {
      const vol = parseFloat(k[5]);
      const takerBuy = parseFloat(k[9]);
      cvd += takerBuy - (vol - takerBuy);
      buy += takerBuy; total += vol;
    }
    return { cvd, lastBuyRatio: total > 0 ? buy / total : 0.5 };
  } catch { return null; }
}

interface Candidate {
  symbol: string;
  price: number;
  changePct24h: number;
  rsi14: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  atrPct: number | null;
  fundingPct: number | null;
  oiChange24hPct: number | null;
  cvdSlope: number | null;
  buyPressure: number | null;
  recentHigh50: number;
  recentLow50: number;
  bias: "bull" | "bear" | "neutral";
  prelimScore: number;
  reasons: string[];
}

async function buildCandidate(symbol: string, ticker: any): Promise<Candidate | null> {
  try {
    const [k1h, funding, oi, cvd] = await Promise.all([
      fetchKlines(symbol, "1h", 220),
      fetchFunding(symbol),
      fetchOIChange(symbol),
      fetchCVD(symbol),
    ]);
    if (k1h.length < 50) return null;
    const closes = k1h.map((c) => c.close);
    const highs = k1h.map((c) => c.high);
    const lows = k1h.map((c) => c.low);
    const price = closes[closes.length - 1];
    const e20arr = ema(closes, 20);
    const e50arr = ema(closes, 50);
    const e200arr = ema(closes, 200);
    const e20 = e20arr[e20arr.length - 1] ?? null;
    const e50 = e50arr[e50arr.length - 1] ?? null;
    const e200 = e200arr[e200arr.length - 1] ?? null;
    const r14 = rsi(closes, 14);
    const a14 = atr(highs, lows, closes, 14);
    const atrPct = a14 != null ? (a14 / price) * 100 : null;
    const window = closes.slice(-50);
    const recentHigh = Math.max(...window);
    const recentLow = Math.min(...window);

    let score = 0;
    const reasons: string[] = [];
    if (r14 != null) {
      if (r14 < 30) { score += 20; reasons.push(`RSI oversold ${r14.toFixed(1)}`); }
      else if (r14 > 70) { score -= 20; reasons.push(`RSI overbought ${r14.toFixed(1)}`); }
      else if (r14 > 55) { score += 8; reasons.push(`RSI bullish ${r14.toFixed(1)}`); }
      else if (r14 < 45) { score -= 8; reasons.push(`RSI bearish ${r14.toFixed(1)}`); }
    }
    if (e20 && e50) {
      if (e20 > e50) { score += 12; reasons.push("EMA20 > EMA50 (uptrend)"); }
      else { score -= 12; reasons.push("EMA20 < EMA50 (downtrend)"); }
    }
    if (e50 && e200) {
      if (e50 > e200) { score += 10; reasons.push("EMA50 > EMA200 (long-term up)"); }
      else { score -= 10; reasons.push("EMA50 < EMA200 (long-term down)"); }
    }
    if (funding != null) {
      const fpct = funding * 100;
      if (fpct > 0.05) { score -= 10; reasons.push(`High funding ${fpct.toFixed(3)}% (long squeeze risk)`); }
      else if (fpct < -0.03) { score += 10; reasons.push(`Negative funding ${fpct.toFixed(3)}% (short squeeze fuel)`); }
    }
    if (oi != null) {
      if (oi > 5) { score += 5; reasons.push(`OI +${oi.toFixed(1)}% 24h (new positions)`); }
      else if (oi < -5) { score -= 5; reasons.push(`OI ${oi.toFixed(1)}% 24h (positions closing)`); }
    }
    if (cvd) {
      if (cvd.lastBuyRatio > 0.55) { score += 8; reasons.push(`Aggressive buying ${(cvd.lastBuyRatio*100).toFixed(0)}%`); }
      else if (cvd.lastBuyRatio < 0.45) { score -= 8; reasons.push(`Aggressive selling ${(cvd.lastBuyRatio*100).toFixed(0)}%`); }
    }

    const bias: "bull" | "bear" | "neutral" = score >= 18 ? "bull" : score <= -18 ? "bear" : "neutral";

    return {
      symbol, price,
      changePct24h: parseFloat(ticker.priceChangePercent),
      rsi14: r14, ema20: e20, ema50: e50, ema200: e200, atrPct,
      fundingPct: funding != null ? funding * 100 : null,
      oiChange24hPct: oi,
      cvdSlope: cvd ? cvd.cvd : null,
      buyPressure: cvd ? cvd.lastBuyRatio : null,
      recentHigh50: recentHigh, recentLow50: recentLow,
      bias, prelimScore: score, reasons,
    };
  } catch {
    return null;
  }
}

// ---------------- AI ranking ----------------
async function rankWithAI(candidates: Candidate[]): Promise<any> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not set");

  const compact = candidates.map((c) => ({
    symbol: c.symbol,
    price: c.price,
    bias: c.bias,
    score: c.prelimScore,
    rsi: c.rsi14?.toFixed(1) ?? null,
    ema20: c.ema20?.toFixed(6) ?? null,
    ema50: c.ema50?.toFixed(6) ?? null,
    ema200: c.ema200?.toFixed(6) ?? null,
    atrPct: c.atrPct?.toFixed(2) ?? null,
    fundingPct: c.fundingPct?.toFixed(4) ?? null,
    oi24hPct: c.oiChange24hPct?.toFixed(2) ?? null,
    buyPressure: c.buyPressure?.toFixed(2) ?? null,
    chg24h: c.changePct24h.toFixed(2),
    high50: c.recentHigh50,
    low50: c.recentLow50,
    reasons: c.reasons,
  }));

  const sys = `You are a senior crypto derivatives analyst. From the supplied scan of futures pairs, pick the TOP 5 highest-conviction trade setups RIGHT NOW.

Rules:
- Mix longs and shorts based on the data — do not force one direction.
- Reject setups where signals contradict (e.g., bull EMA stack but extreme overbought RSI + high funding).
- Prefer confluence: trend alignment + momentum + funding/CVD edge.
- Use ATR for realistic stops (1.0–1.5× ATR) and 3 staged targets (1R, 2R, 3R minimum).
- Suggest leverage conservatively: 3-5x for swing, 5-10x for tighter setups, never above 15x.
- Conviction 1-100 reflects how clean the setup is.

Return ONLY a JSON object via the 'publish_signals' tool.`;

  const tool = {
    type: "function",
    function: {
      name: "publish_signals",
      description: "Publish top 5 ranked trade setups",
      parameters: {
        type: "object",
        properties: {
          generated_at: { type: "string", description: "ISO timestamp" },
          market_summary: { type: "string", description: "1-2 sentence read on the broader market right now." },
          signals: {
            type: "array",
            minItems: 3, maxItems: 5,
            items: {
              type: "object",
              properties: {
                symbol: { type: "string" },
                side: { type: "string", enum: ["long", "short"] },
                conviction: { type: "number" },
                timeframe: { type: "string", enum: ["intraday", "swing", "position"] },
                leverage: { type: "number" },
                entry_low: { type: "number" },
                entry_high: { type: "number" },
                stop: { type: "number" },
                targets: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
                risk_reward: { type: "number" },
                setup_name: { type: "string", description: "e.g. 'Trend continuation pullback', 'Short-squeeze reversal'" },
                reasoning: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 6 },
                invalidation: { type: "string" },
                catalysts: { type: "string", description: "What confirms / triggers this setup" },
              },
              required: ["symbol","side","conviction","timeframe","leverage","entry_low","entry_high","stop","targets","risk_reward","setup_name","reasoning","invalidation","catalysts"],
              additionalProperties: false,
            }
          }
        },
        required: ["generated_at","market_summary","signals"],
        additionalProperties: false,
      }
    }
  };

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Scan results (${compact.length} candidates):\n\n${JSON.stringify(compact, null, 2)}\n\nPick the top 5 best setups now.` },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "publish_signals" } },
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    if (res.status === 429) throw new Error("Rate limit hit. Try again shortly.");
    if (res.status === 402) throw new Error("AI credits exhausted.");
    throw new Error(`AI gateway ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error("AI returned no tool call");
  return JSON.parse(call.function.arguments);
}

// ---------------- handler ----------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // 1. Get top 30 symbols by 24h quote volume
    const r = await fetch(`${FAPI}/fapi/v1/ticker/24hr`);
    if (!r.ok) throw new Error("ticker24hr failed");
    const tickers: any[] = await r.json();
    const top = tickers
      .filter((t) => t.symbol.endsWith("USDT") && !t.symbol.includes("_"))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 30);

    // 2. Build candidate metrics in parallel (chunked to avoid hammering)
    const candidates: Candidate[] = [];
    const chunkSize = 6;
    for (let i = 0; i < top.length; i += chunkSize) {
      const slice = top.slice(i, i + chunkSize);
      const results = await Promise.all(slice.map((t) => buildCandidate(t.symbol, t)));
      for (const c of results) if (c) candidates.push(c);
    }

    if (candidates.length === 0) throw new Error("No candidates collected");

    // 3. Pre-filter: keep only directional bias (drop neutrals if we have enough)
    const directional = candidates.filter((c) => c.bias !== "neutral");
    const pool = directional.length >= 8 ? directional : candidates;

    // Sort by absolute prelim score, keep top 15 to send to AI
    pool.sort((a, b) => Math.abs(b.prelimScore) - Math.abs(a.prelimScore));
    const shortlist = pool.slice(0, 15);

    // 4. AI ranks + writes setups
    const ranked = await rankWithAI(shortlist);

    return new Response(JSON.stringify({
      ...ranked,
      universe_size: candidates.length,
      shortlist_size: shortlist.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[premium-signals]", e);
    return new Response(JSON.stringify({ error: e.message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
