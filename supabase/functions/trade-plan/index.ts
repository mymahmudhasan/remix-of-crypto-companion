import { corsHeaders } from "npm:@supabase/supabase-js/cors";

interface IndicatorSnapshot {
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

interface ScoredSignal { bias: "bull" | "bear" | "neutral"; score: number; reasons: string[] }

interface Body {
  mode: "spot" | "futures";
  symbol: string;
  interval: string;
  snapshot: IndicatorSnapshot;
  signal: ScoredSignal;
  accountSize?: number;
  maxLev?: number;
}

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
    riskPct: { type: "number", minimum: 0.25, maximum: 5 },
    rationale: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
    invalidations: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
  },
  required: ["action", "conviction", "entry", "stop", "targets", "riskPct", "rationale", "invalidations"],
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
    riskPct: { type: "number", minimum: 0.25, maximum: 3 },
    rationale: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
    invalidations: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
  },
  required: ["side", "conviction", "leverage", "entry", "stop", "targets", "riskPct", "rationale", "invalidations"],
  additionalProperties: false,
};

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
      ? { name: "futures_plan", description: "Return a structured futures trade plan.", parameters: FUTURES_SCHEMA }
      : { name: "spot_plan", description: "Return a structured spot trade plan.", parameters: SPOT_SCHEMA };

    const sysCommon = `You are CryptoDesk's master trading planner. Be disciplined, risk-first, and concrete.
RULES:
- Use ONLY the provided live indicators; do not invent prices.
- All prices in your plan must be plausible relative to the current price.
- Keep risk between 0.5% and 2% (max 3% for futures, max 5% for spot if very high conviction).
- Stop must be on the wrong side of price (below for long/buy, above for short/sell).
- Targets must be on the right side of price.
- Provide 2-4 short bullet rationales (specific to the indicators).
- Provide 1-3 invalidation conditions.`;

    const sysFutures = `${sysCommon}
FUTURES SPECIFIC:
- Pick leverage between 2× and ${body.maxLev ?? 10}×. Use lower leverage when volatility/RSI is extreme.
- side="neutral" only if signal is genuinely mixed (|score| < 15) — in that case set leverage=1, riskPct=0.5, entry=current price ±0.1%, stop & targets near current.
- Higher leverage demands tighter stop and lower riskPct.`;

    const sysSpot = `${sysCommon}
SPOT SPECIFIC:
- action="buy" if bull bias and price not extended; "wait" if bull bias but at resistance/overbought; "hold" if neutral; "sell" if bear bias and price near resistance.
- For sell, treat stop as above current price and targets below.
- Provide entry zone (low/high). For "buy", a pullback zone is preferred over chasing.`;

    const userMsg = `Plan a ${body.mode.toUpperCase()} trade for ${body.symbol} on the ${body.interval} timeframe.

LIVE INDICATORS (from Binance):
- Current price: ${body.snapshot.price}
- RSI(14): ${body.snapshot.rsi14}
- EMA20: ${body.snapshot.ema20}
- EMA50: ${body.snapshot.ema50}
- EMA200: ${body.snapshot.ema200}
- MACD: ${body.snapshot.macd}
- MACD Signal: ${body.snapshot.macdSignal}
- MACD Histogram: ${body.snapshot.macdHist}
- 50-bar high (resistance): ${body.snapshot.recentHigh}
- 50-bar low (support): ${body.snapshot.recentLow}
- 50-bar change %: ${body.snapshot.changePct}

COMPOSITE SIGNAL: ${body.signal.bias.toUpperCase()} (score ${body.signal.score})
REASONS: ${body.signal.reasons.join("; ")}

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
      console.error("No tool call returned", JSON.stringify(data).slice(0, 500));
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
