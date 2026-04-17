// News-aware trade plan: combines a news headline with current chart context
// (price + RSI + recent levels) and produces a directional plan via Lovable AI.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

interface Body {
  symbol: string;
  mode: "spot" | "futures";
  interval: string;
  news: {
    title: string;
    summary: string;
    source: string;
    sentiment: "bullish" | "bearish" | "neutral";
    publishedAt: number;
  };
  snapshot: {
    price: number;
    rsi14: number | null;
    ema20: number | null; ema50: number | null; ema200: number | null;
    atr14?: number | null;
    recentHigh: number;
    recentLow: number;
  };
}

const SCHEMA = {
  type: "object",
  properties: {
    bias: { type: "string", enum: ["long", "short", "neutral"] },
    verdict: { type: "string", enum: ["GO", "WAIT", "SKIP"] },
    confidence: { type: "number", minimum: 0, maximum: 100 },
    headline: { type: "string", minLength: 10, maxLength: 200 },
    thesis: { type: "string", minLength: 40, maxLength: 600 },
    catalystImpact: { type: "string", enum: ["high", "medium", "low"] },
    timeHorizon: { type: "string", enum: ["scalp", "intraday", "swing"] },
    levels: {
      type: "object",
      properties: {
        entryLow: { type: "number" },
        entryHigh: { type: "number" },
        stop: { type: "number" },
        targets: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 3 },
        leverage: { type: "number", minimum: 1, maximum: 10 },
        riskPct: { type: "number", minimum: 0.25, maximum: 5 },
      },
      required: ["entryLow", "entryHigh", "stop", "targets", "riskPct"],
      additionalProperties: false,
    },
    invalidation: { type: "string", minLength: 10, maxLength: 300 },
    risks: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
  },
  required: ["bias", "verdict", "confidence", "headline", "thesis", "catalystImpact",
             "timeHorizon", "levels", "invalidation", "risks"],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const body: Body = await req.json();
    if (!body?.symbol || !body?.news?.title || !body?.snapshot?.price) {
      return new Response(JSON.stringify({ error: "Invalid body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ageHours = ((Date.now() - body.news.publishedAt) / 3600_000).toFixed(1);
    const sys = `You are a disciplined crypto trader generating a news-driven trade plan.
RULES:
- Use ONLY the provided news + market snapshot. Do not invent indicators.
- If the news is stale (>24h) OR the market has likely already priced it in (>5% move in news direction), reduce confidence and consider SKIP / WAIT.
- For ${body.mode === "futures" ? "FUTURES" : "SPOT"}: ${body.mode === "futures" ? "leverage 2-5x typical, never above 10x" : "leverage 1 (spot)"}.
- Stop must invalidate the thesis (beyond a swing low for longs / swing high for shorts).
- Risk per trade: 0.5-2% by default. R:R must be at least 1.5 for GO.
- "catalystImpact": high = market-moving (ETF, hack, regulator action). medium = partnership/listing. low = opinion/analysis.
- All prices must be near current price (entry within ±3% of last; stop within ±10%).
Return JSON only matching the schema.`;

    const user = `SYMBOL: ${body.symbol} (${body.mode})
TIMEFRAME: ${body.interval}
CURRENT PRICE: ${body.snapshot.price}
RSI(14): ${body.snapshot.rsi14 ?? "n/a"}
EMA20/50/200: ${body.snapshot.ema20 ?? "n/a"} / ${body.snapshot.ema50 ?? "n/a"} / ${body.snapshot.ema200 ?? "n/a"}
ATR(14): ${body.snapshot.atr14 ?? "n/a"}
24h-ish range: low ${body.snapshot.recentLow} / high ${body.snapshot.recentHigh}

NEWS (${body.news.source} · ${ageHours}h old · sentiment: ${body.news.sentiment}):
TITLE: ${body.news.title}
SUMMARY: ${body.news.summary}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        tools: [{
          type: "function",
          function: {
            name: "submit_news_plan",
            description: "Submit the structured news-driven plan",
            parameters: SCHEMA,
          },
        }],
        tool_choice: { type: "function", function: { name: "submit_news_plan" } },
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return new Response(JSON.stringify({ error: `AI gateway ${resp.status}: ${txt}` }),
        { status: resp.status === 429 ? 429 : 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) {
      return new Response(JSON.stringify({ error: "No tool call returned by AI" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const plan = JSON.parse(call.function.arguments);
    return new Response(JSON.stringify({ plan }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
