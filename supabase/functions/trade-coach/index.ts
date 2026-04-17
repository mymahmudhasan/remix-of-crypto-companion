// Winning Trade Coach — checklist scorecard + step-by-step playbook
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Snap {
  price: number;
  rsi14: number | null;
  ema20: number | null; ema50: number | null; ema200: number | null;
  macd: number | null; macdSignal: number | null;
  bbPercentB?: number | null;
  atr14?: number | null; atrPct?: number | null;
  stochK?: number | null; stochD?: number | null;
  volRatio?: number | null;
  recentHigh: number; recentLow: number;
}

interface Footprint {
  type: string; label: string; detail: string;
  weight: number; implication: "bull" | "bear" | "neutral";
}

interface TFSnap { interval: string; bias: "bull" | "bear" | "neutral"; score: number; }

interface Body {
  symbol: string;
  interval: string;
  mode: "spot" | "futures";
  snapshot: Snap;
  multiTf: TFSnap[];
  footprints: Footprint[];
  fundingRate?: number | null;
  accountSize?: number;
  maxLev?: number;
}

const SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["GO", "WAIT", "SKIP"] },
    side: { type: "string", enum: ["long", "short", "neutral"] },
    confidence: { type: "number", minimum: 0, maximum: 100 },
    headline: { type: "string", minLength: 20, maxLength: 200 },
    checklist: {
      type: "array",
      minItems: 8, maxItems: 12,
      items: {
        type: "object",
        properties: {
          item: { type: "string" },
          status: { type: "string", enum: ["pass", "fail", "warn"] },
          weight: { type: "number", minimum: 1, maximum: 5 },
          note: { type: "string" },
        },
        required: ["item", "status", "weight", "note"],
        additionalProperties: false,
      },
    },
    playbook: {
      type: "array",
      minItems: 4, maxItems: 8,
      items: {
        type: "object",
        properties: {
          step: { type: "number" },
          title: { type: "string" },
          action: { type: "string" },
          price: { type: "number" },
        },
        required: ["step", "title", "action"],
        additionalProperties: false,
      },
    },
    levels: {
      type: "object",
      properties: {
        entryLow: { type: "number" },
        entryHigh: { type: "number" },
        stop: { type: "number" },
        targets: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 4 },
        leverage: { type: "number", minimum: 1, maximum: 50 },
        riskPct: { type: "number", minimum: 0.1, maximum: 5 },
      },
      required: ["entryLow", "entryHigh", "stop", "targets", "riskPct"],
      additionalProperties: false,
    },
    invalidation: { type: "string", minLength: 20 },
    skipReasons: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5 },
  },
  required: ["verdict", "side", "confidence", "headline", "checklist", "playbook", "levels", "invalidation", "skipReasons"],
  additionalProperties: false,
};

function fmt(n: number | null | undefined, d = 2) {
  if (n === null || n === undefined || !isFinite(n)) return "n/a";
  return n.toFixed(d);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!KEY) throw new Error("LOVABLE_API_KEY missing");
    const body = await req.json() as Body;
    if (!body?.snapshot || !body?.symbol) {
      return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const s = body.snapshot;
    const mtf = body.multiTf?.length
      ? body.multiTf.map((t) => `  ${t.interval}: ${t.bias.toUpperCase()} (${t.score})`).join("\n")
      : "  none provided";
    const fps = body.footprints?.length
      ? body.footprints.map((f) => `  • [${f.implication.toUpperCase()} ×${f.weight}] ${f.label} — ${f.detail}`).join("\n")
      : "  none detected";

    const sys = `You are CryptoDesk's "Winning Trade" coach. Your job is to (a) score the setup against a strict checklist and (b) give the trader a step-by-step playbook to execute, all grounded ONLY in the data provided.

DISCIPLINE:
- Use ONLY the provided indicators, footprints, and timeframes — never invent data.
- "verdict": GO only when trend, MTF confluence, footprints, and risk:reward all align (≥6 of the checklist pass and weighted score is strongly directional). WAIT when the setup is forming but missing a trigger. SKIP when conflicting or low-quality.
- "side" must match the verdict: GO -> long or short, WAIT -> the bias forming, SKIP -> neutral.
- All prices must be plausible (within ±10% of current price unless ATR justifies wider).
- Stop on the wrong side of price; targets on the right side, increasing distance, with R:R ≥ 1.5 for the first target, ≥ 2.5 for the last.
- For SKIP, levels can be the current price ±0.5% as placeholders.

CHECKLIST (8–12 items, each with status pass/warn/fail and weight 1–5). Cover at minimum:
  1. Higher-timeframe trend alignment (MTF confluence)
  2. Primary timeframe trend (EMA20/50/200 stack)
  3. Momentum (RSI / MACD / Stochastic)
  4. Volatility & risk (ATR%, position sizing)
  5. Volume confirmation (volRatio)
  6. Institutional footprint(s) — cite the strongest one(s)
  7. Liquidity sweep / structure (recent high/low context)
  8. Risk:Reward ≥ 1.5
Plus optional items as relevant (funding, key level proximity, BB %B extremes, etc.).

PLAYBOOK (4–8 numbered steps): concrete instructions like "Wait for 1h close back above $X", "Enter limit at $Y", "Set stop at $Z (below sweep low)", "Take 50% off at $T1, trail rest", "Cancel if price breaks $K before triggering".

"invalidation": the single most important condition that voids the setup.
"skipReasons": if verdict=SKIP, list the disqualifiers; otherwise leave empty array.`;

    const userMsg = `Symbol: ${body.symbol} (${body.mode.toUpperCase()})
Primary timeframe: ${body.interval}
Account size: $${body.accountSize ?? 10000}${body.mode === "futures" ? `, max leverage ${body.maxLev ?? 10}×` : ""}
${body.fundingRate !== undefined && body.fundingRate !== null ? `Funding rate: ${(body.fundingRate * 100).toFixed(4)}% / 8h\n` : ""}

PRIMARY SNAPSHOT (${body.interval}):
  Price: ${s.price}
  RSI(14): ${fmt(s.rsi14, 1)}
  EMA 20/50/200: ${fmt(s.ema20)} / ${fmt(s.ema50)} / ${fmt(s.ema200)}
  MACD / signal: ${fmt(s.macd, 4)} / ${fmt(s.macdSignal, 4)}
  Stoch %K/%D: ${fmt(s.stochK, 1)} / ${fmt(s.stochD, 1)}
  BB %B: ${fmt(s.bbPercentB, 2)}
  ATR(14) / ATR%: ${fmt(s.atr14, 4)} / ${fmt(s.atrPct, 2)}%
  Volume ratio: ${fmt(s.volRatio, 2)}×
  50-bar high / low: ${s.recentHigh} / ${s.recentLow}

MULTI-TIMEFRAME COMPOSITE:
${mtf}

INSTITUTIONAL FOOTPRINTS DETECTED (most recent first):
${fps}

Build the checklist and playbook now. Reply via the trade_coach function only.`;

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userMsg },
        ],
        tools: [{ type: "function", function: { name: "trade_coach", description: "Return a winning-trade scorecard + step-by-step playbook.", parameters: SCHEMA } }],
        tool_choice: { type: "function", function: { name: "trade_coach" } },
      }),
    });

    if (!r.ok) {
      if (r.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (r.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const t = await r.text();
      console.error("AI gateway error:", r.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await r.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) {
      return new Response(JSON.stringify({ error: "No structured response" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    let coach: any;
    try { coach = JSON.parse(call.function.arguments); }
    catch { return new Response(JSON.stringify({ error: "Could not parse coach JSON" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

    return new Response(JSON.stringify({ coach }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("trade-coach error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
