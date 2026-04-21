// Build a single trade-signal for a user-supplied symbol (USDT perp/spot).
// Mirrors premium-signals logic but for one symbol on demand.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FAPI_HOSTS = ["https://fapi.binance.com", "https://www.binance.com"];
const SPOT_HOSTS = [
  "https://api.binance.com",
  "https://data-api.binance.vision",
  "https://api1.binance.com",
  "https://api2.binance.com",
];

async function fetchWithFailover(hosts: string[], path: string): Promise<Response | null> {
  for (const host of hosts) {
    try {
      const r = await fetch(`${host}${path}`, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (r.ok) return r;
    } catch { /* next */ }
  }
  return null;
}

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
  return 100 - 100 / (1 + avgG / avgL);
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
  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
  }
  return prev;
}

async function fetchKlines(symbol: string, interval: string, limit = 220) {
  let r = await fetchWithFailover(FAPI_HOSTS, `/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!r) r = await fetchWithFailover(SPOT_HOSTS, `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!r) throw new Error(`Could not load klines for ${symbol} (Binance blocked or symbol unknown)`);
  const raw: any[][] = await r.json();
  return raw.map((k) => ({
    open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]),
    close: parseFloat(k[4]), volume: parseFloat(k[5]),
  }));
}
async function fetch24h(symbol: string) {
  let r = await fetchWithFailover(FAPI_HOSTS, `/fapi/v1/ticker/24hr?symbol=${symbol}`);
  if (!r) r = await fetchWithFailover(SPOT_HOSTS, `/api/v3/ticker/24hr?symbol=${symbol}`);
  if (!r) return null;
  try { return await r.json(); } catch { return null; }
}
async function fetchFunding(symbol: string): Promise<number | null> {
  const r = await fetchWithFailover(FAPI_HOSTS, `/fapi/v1/premiumIndex?symbol=${symbol}`);
  if (!r) return null;
  try { return parseFloat((await r.json()).lastFundingRate); } catch { return null; }
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
async function fetchCVD(symbol: string) {
  const r = await fetchWithFailover(SPOT_HOSTS, `/api/v3/klines?symbol=${symbol}&interval=5m&limit=48`);
  if (!r) return null;
  try {
    const arr: any[][] = await r.json();
    let buy = 0, total = 0;
    for (const k of arr) {
      const vol = parseFloat(k[5]);
      const takerBuy = parseFloat(k[9]);
      buy += takerBuy; total += vol;
    }
    return { lastBuyRatio: total > 0 ? buy / total : 0.5 };
  } catch { return null; }
}

async function buildSnapshot(symbol: string) {
  const [k1h, ticker, funding, oi, cvd] = await Promise.all([
    fetchKlines(symbol, "1h", 220),
    fetch24h(symbol),
    fetchFunding(symbol),
    fetchOIChange(symbol),
    fetchCVD(symbol),
  ]);
  if (k1h.length < 50) throw new Error(`Not enough history for ${symbol}`);
  const closes = k1h.map((c) => c.close);
  const highs = k1h.map((c) => c.high);
  const lows = k1h.map((c) => c.low);
  const price = closes[closes.length - 1];
  const e20 = ema(closes, 20).at(-1) ?? null;
  const e50 = ema(closes, 50).at(-1) ?? null;
  const e200 = ema(closes, 200).at(-1) ?? null;
  const r14 = rsi(closes, 14);
  const a14 = atr(highs, lows, closes, 14);
  const atrPct = a14 != null ? (a14 / price) * 100 : null;
  const win = closes.slice(-50);
  const recentHigh = Math.max(...win);
  const recentLow = Math.min(...win);

  const reasons: string[] = [];
  let score = 0;
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
    if (oi > 5) { score += 5; reasons.push(`OI +${oi.toFixed(1)}% 24h`); }
    else if (oi < -5) { score -= 5; reasons.push(`OI ${oi.toFixed(1)}% 24h`); }
  }
  if (cvd) {
    if (cvd.lastBuyRatio > 0.55) { score += 8; reasons.push(`Aggressive buying ${(cvd.lastBuyRatio*100).toFixed(0)}%`); }
    else if (cvd.lastBuyRatio < 0.45) { score -= 8; reasons.push(`Aggressive selling ${(cvd.lastBuyRatio*100).toFixed(0)}%`); }
  }
  const bias: "bull" | "bear" | "neutral" = score >= 14 ? "bull" : score <= -14 ? "bear" : "neutral";

  return {
    symbol, price,
    chg24h: ticker ? parseFloat(ticker.priceChangePercent) : null,
    rsi: r14, ema20: e20, ema50: e50, ema200: e200, atrPct,
    fundingPct: funding != null ? funding * 100 : null,
    oi24hPct: oi,
    buyPressure: cvd?.lastBuyRatio ?? null,
    recentHigh50: recentHigh, recentLow50: recentLow,
    bias, prelimScore: score, reasons,
  };
}

async function aiSignal(snap: any) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not set");

  const tool = {
    type: "function",
    function: {
      name: "publish_signal",
      description: "Publish ONE trade setup for the supplied symbol",
      parameters: {
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
          setup_name: { type: "string" },
          reasoning: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 6 },
          invalidation: { type: "string" },
          catalysts: { type: "string" },
        },
        required: ["symbol","side","conviction","timeframe","leverage","entry_low","entry_high","stop","targets","risk_reward","setup_name","reasoning","invalidation","catalysts"],
        additionalProperties: false,
      },
    },
  };

  const sys = `You are a senior crypto derivatives analyst. Build ONE clean trade setup for the supplied symbol using the provided market snapshot.
Rules:
- Pick LONG or SHORT based on the data — don't force a side. If signals contradict, pick the dominant edge but reflect it in conviction.
- Use ATR for realistic stops (1.0–1.5× ATR distance from entry) and 3 staged targets (1R / 2R / 3R minimum).
- Conservative leverage: 3-5x swing, 5-10x intraday, never above 15x.
- Conviction 1-100 reflects setup cleanliness.
- Return ONLY via the publish_signal tool.`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Snapshot:\n${JSON.stringify(snap, null, 2)}\n\nBuild the best setup right now.` },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "publish_signal" } },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 429) throw new Error("Rate limit hit. Try again shortly.");
    if (res.status === 402) throw new Error("AI credits exhausted.");
    throw new Error(`AI gateway ${res.status}: ${t}`);
  }
  const data = await res.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error("AI returned no tool call");
  return JSON.parse(call.function.arguments);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { symbol: raw } = await req.json();
    if (!raw || typeof raw !== "string") {
      return new Response(JSON.stringify({ error: "symbol is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let symbol = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!symbol.endsWith("USDT")) symbol = `${symbol}USDT`;

    const snap = await buildSnapshot(symbol);
    const signal = await aiSignal(snap);

    return new Response(JSON.stringify({ signal, snapshot: snap }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[signal-for-symbol]", e);
    return new Response(JSON.stringify({ error: e.message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
