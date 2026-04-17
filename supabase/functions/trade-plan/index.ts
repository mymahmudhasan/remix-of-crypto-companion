// CORS headers (deno edge runtime)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface IndicatorSnapshot {
  price: number;
  rsi14: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  bbUpper?: number | null;
  bbMid?: number | null;
  bbLower?: number | null;
  bbPercentB?: number | null;
  atr14?: number | null;
  atrPct?: number | null;
  stochK?: number | null;
  stochD?: number | null;
  volRatio?: number | null;
  recentHigh: number;
  recentLow: number;
  changePct: number;
}

interface ScoredSignal { bias: "bull" | "bear" | "neutral"; score: number; reasons: string[] }

interface TFSnap {
  interval: string;
  snapshot: IndicatorSnapshot;
  signal: ScoredSignal;
}

interface Body {
  mode: "spot" | "futures";
  symbol: string;
  interval: string;
  snapshot: IndicatorSnapshot;
  signal: ScoredSignal;
  /** Optional: extra timeframes for confluence analysis. */
  multiTf?: TFSnap[];
  accountSize?: number;
  maxLev?: number;
}

const INDICATOR_BREAKDOWN_SCHEMA = {
  type: "array",
  minItems: 4,
  maxItems: 8,
  items: {
    type: "object",
    properties: {
      name: { type: "string" },
      reading: { type: "string" },
      verdict: { type: "string", enum: ["bullish", "bearish", "neutral"] },
      weight: { type: "number", minimum: 1, maximum: 5 },
      note: { type: "string" },
    },
    required: ["name", "reading", "verdict", "weight", "note"],
    additionalProperties: false,
  },
};

const MTF_CONFLUENCE_SCHEMA = {
  type: "array",
  minItems: 0,
  maxItems: 4,
  items: {
    type: "object",
    properties: {
      timeframe: { type: "string" },
      bias: { type: "string", enum: ["bull", "bear", "neutral"] },
      summary: { type: "string" },
    },
    required: ["timeframe", "bias", "summary"],
    additionalProperties: false,
  },
};

const SCENARIO_SCHEMA = {
  type: "object",
  properties: {
    bullCase: { type: "string" },
    bearCase: { type: "string" },
    keyLevel: { type: "number" },
    keyLevelNote: { type: "string" },
  },
  required: ["bullCase", "bearCase", "keyLevel", "keyLevelNote"],
  additionalProperties: false,
};

const SPOT_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["buy", "hold", "sell", "wait"] },
    conviction: { type: "number", minimum: 0, maximum: 100 },
    entry: {
      type: "object",
      properties: { low: { type: "number" }, high: { type: "number" } },
      required: ["low", "high"],
      additionalProperties: false,
    },
    stop: { type: "number" },
    targets: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 4 },
    riskPct: { type: "number", minimum: 0.1, maximum: 5 },
    rationale: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
    invalidations: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
    summary: { type: "string", minLength: 40, maxLength: 600 },
    indicatorBreakdown: INDICATOR_BREAKDOWN_SCHEMA,
    multiTimeframe: MTF_CONFLUENCE_SCHEMA,
    scenarios: SCENARIO_SCHEMA,
    timeHorizon: { type: "string", enum: ["intraday", "swing", "position"] },
  },
  required: [
    "action", "conviction", "entry", "stop", "targets", "riskPct",
    "rationale", "invalidations", "summary", "indicatorBreakdown",
    "multiTimeframe", "scenarios", "timeHorizon",
  ],
  additionalProperties: false,
};

const FUTURES_SCHEMA = {
  type: "object",
  properties: {
    side: { type: "string", enum: ["long", "short", "neutral"] },
    conviction: { type: "number", minimum: 0, maximum: 100 },
    leverage: { type: "number", minimum: 1, maximum: 50 },
    entry: {
      type: "object",
      properties: { low: { type: "number" }, high: { type: "number" } },
      required: ["low", "high"],
      additionalProperties: false,
    },
    stop: { type: "number" },
    targets: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 4 },
    riskPct: { type: "number", minimum: 0.1, maximum: 3 },
    rationale: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
    invalidations: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
    summary: { type: "string", minLength: 40, maxLength: 600 },
    indicatorBreakdown: INDICATOR_BREAKDOWN_SCHEMA,
    multiTimeframe: MTF_CONFLUENCE_SCHEMA,
    scenarios: SCENARIO_SCHEMA,
    timeHorizon: { type: "string", enum: ["intraday", "swing", "position"] },
    fundingNote: { type: "string" },
  },
  required: [
    "side", "conviction", "leverage", "entry", "stop", "targets", "riskPct",
    "rationale", "invalidations", "summary", "indicatorBreakdown",
    "multiTimeframe", "scenarios", "timeHorizon", "fundingNote",
  ],
  additionalProperties: false,
};

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !isFinite(n)) return "n/a";
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  return n.toFixed(digits);
}

function snapshotBlock(s: IndicatorSnapshot): string {
  return [
    `  Price: ${s.price}`,
    `  RSI(14): ${fmtNum(s.rsi14, 1)}`,
    `  EMA20/50/200: ${fmtNum(s.ema20)} / ${fmtNum(s.ema50)} / ${fmtNum(s.ema200)}`,
    `  MACD line / signal / hist: ${fmtNum(s.macd, 4)} / ${fmtNum(s.macdSignal, 4)} / ${fmtNum(s.macdHist, 4)}`,
    `  Bollinger upper/mid/lower: ${fmtNum(s.bbUpper)} / ${fmtNum(s.bbMid)} / ${fmtNum(s.bbLower)} (%B=${fmtNum(s.bbPercentB, 2)})`,
    `  ATR(14): ${fmtNum(s.atr14, 4)} (${fmtNum(s.atrPct, 2)}% of price)`,
    `  Stochastic %K/%D: ${fmtNum(s.stochK, 1)} / ${fmtNum(s.stochD, 1)}`,
    `  Volume ratio (vs 20-bar avg): ${fmtNum(s.volRatio, 2)}×`,
    `  50-bar high / low: ${s.recentHigh} / ${s.recentLow}`,
    `  50-bar change: ${fmtNum(s.changePct, 2)}%`,
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const body = (await req.json()) as Body;
    if (!body?.snapshot || !body?.signal || !body?.symbol || !body?.mode) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isFutures = body.mode === "futures";
    const tool = isFutures
      ? { name: "futures_plan", description: "Return a structured, in-depth futures trade plan.", parameters: FUTURES_SCHEMA }
      : { name: "spot_plan", description: "Return a structured, in-depth spot trade plan.", parameters: SPOT_SCHEMA };

    const sysCommon = `You are CryptoDesk's master trading planner. You produce institutional-grade, risk-first trade plans grounded in the live indicator data the user provides.

DISCIPLINE:
- Use ONLY the provided live indicators. NEVER invent prices or readings.
- All prices in your plan must be plausible relative to the current price (within ±15% unless explicitly justified).
- Stop must be on the wrong side of price (below for long/buy, above for short/sell). Targets on the right side, in increasing distance.
- Risk: 0.5%–2% baseline (max 3% futures, max 5% spot if very high conviction).

DEPTH (mandatory):
- "summary" (2–4 sentences): plain-English thesis and what tips you to act now (or wait).
- "indicatorBreakdown" (4–8 entries): one row per indicator (RSI, EMA structure, MACD, Bollinger %B, Stochastic, ATR/volatility, Volume, S/R levels). Each row needs: name, the actual reading (cite numbers), verdict (bullish/bearish/neutral), weight 1–5, and a short note.
- "multiTimeframe": one entry per provided extra timeframe describing its bias (NEVER fabricate timeframes the user didn't send).
- "scenarios": one bullCase + one bearCase paragraph each, plus the single most important keyLevel (price) and a note explaining why.
- "timeHorizon": intraday (<24h), swing (1–10d), or position (>10d) — pick based on the primary timeframe and ATR.`;

    const sysFutures = `${sysCommon}
FUTURES SPECIFIC:
- Pick leverage between 2× and ${body.maxLev ?? 10}×. Use lower leverage when ATR% > 3 or RSI is extreme.
- side="neutral" only if the signal is genuinely mixed (|score| < 15). When neutral: leverage=1, riskPct=0.5, entry=current price ±0.1%, stop & targets near current.
- Higher leverage demands tighter stop (smaller % distance) and lower riskPct.
- "fundingNote": one short sentence on funding/positioning risk (e.g. "Crowded longs — watch for funding flip").`;

    const sysSpot = `${sysCommon}
SPOT SPECIFIC:
- action="buy" if bull bias and price not extended; "wait" if bull bias but at resistance/overbought; "hold" if neutral; "sell" if bear bias and price near resistance.
- For "sell", treat stop as above current price and targets below.
- Provide entry zone (low/high). For "buy", a pullback zone is preferred over chasing breakouts.`;

    const mtfBlock = (body.multiTf ?? [])
      .map((tf) => `--- ${tf.interval} ---
${snapshotBlock(tf.snapshot)}
  Composite signal: ${tf.signal.bias.toUpperCase()} (score ${tf.signal.score})`)
      .join("\n\n");

    const userMsg = `Plan a ${body.mode.toUpperCase()} trade for ${body.symbol} on the ${body.interval} timeframe.

PRIMARY TIMEFRAME (${body.interval}):
${snapshotBlock(body.snapshot)}

COMPOSITE SIGNAL: ${body.signal.bias.toUpperCase()} (score ${body.signal.score})
COMPOSITE REASONS: ${body.signal.reasons.join("; ")}

${mtfBlock ? `EXTRA TIMEFRAMES (for confluence):\n${mtfBlock}\n` : ""}
Account size: $${body.accountSize ?? 10000}.
Return your plan via the ${tool.name} function only.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: isFutures ? sysFutures : sysSpot },
          { role: "user", content: userMsg },
        ],
        tools: [{ type: "function", function: tool }],
        tool_choice: { type: "function", function: { name: tool.name } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await response.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) {
      console.error("No tool call returned", JSON.stringify(data).slice(0, 800));
      return new Response(JSON.stringify({ error: "Model did not return a structured plan" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    let plan: any;
    try { plan = JSON.parse(call.function.arguments); }
    catch { return new Response(JSON.stringify({ error: "Could not parse plan JSON" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

    return new Response(JSON.stringify({ plan }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("trade-plan error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
