// AI-simulated Binance Square post sentiment + AI trending rank.
// Uses Lovable AI Gateway to estimate community sentiment based on symbol + recent context.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Simple in-memory cache (per isolate) — 5 min TTL keeps cost low
const CACHE = new Map<string, { ts: number; data: unknown }>();
const TTL = 5 * 60 * 1000;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { symbol, side, entry, stop, targets } = await req.json();
    if (!symbol || typeof symbol !== "string") {
      return json({ error: "symbol is required" }, 400);
    }

    const cacheKey = `${symbol}:${side ?? "neutral"}`;
    const cached = CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < TTL) {
      return json({ sentiment: cached.data, cached: true });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    const base = symbol.replace(/USDT$|USD$|BUSD$/, "");
    const setupCtx =
      side && entry
        ? `Trader setup: ${side.toUpperCase()} ${base} | Entry ${entry?.low}-${entry?.high} | Stop ${stop} | Targets ${(targets ?? []).join(", ")}.`
        : "";

    const sysPrompt =
      "You are a crypto social-sentiment analyst. Estimate realistic Binance Square community sentiment and Binance AI trending data for a given coin based on its current market profile, recent narrative, market cap tier, and the trader's setup. Be realistic — mid-cap coins typically have 50-300 posts, large caps 300-1500, micro caps 10-100. Match bullish/bearish split to current market conditions for that asset.";

    const userPrompt = `Estimate Binance Square community sentiment for ${base} right now.
${setupCtx}

Provide:
- total_posts (last 24h estimate)
- bullish_posts and bearish_posts (must sum near total_posts; rest are neutral)
- bullish_pct, bearish_pct, neutral_pct
- top_themes: 3-5 short bullet themes traders are discussing (e.g. "ETF inflows", "Whale accumulation", "Resistance retest")
- sample_posts: 3 short representative post snippets (one bullish, one bearish, one neutral) — keep each under 120 chars, mimic real Binance Square style with emojis & cashtags
- ai_trending: { rank (1-50, lower=hotter, or null if not trending), trend_direction "rising"|"falling"|"stable", momentum_score 0-100 }
- verdict: "crowd_bullish" | "crowd_bearish" | "mixed" | "low_signal"
- alignment_with_setup: "aligned" | "contrarian" | "neutral" — how community sentiment aligns with the trader's ${side ?? "neutral"} setup
- one_liner: a single 140-char takeaway for the trader.`;

    const tool = {
      type: "function",
      function: {
        name: "report_sentiment",
        description: "Report Binance Square + AI trending sentiment.",
        parameters: {
          type: "object",
          properties: {
            total_posts: { type: "number" },
            bullish_posts: { type: "number" },
            bearish_posts: { type: "number" },
            neutral_posts: { type: "number" },
            bullish_pct: { type: "number" },
            bearish_pct: { type: "number" },
            neutral_pct: { type: "number" },
            top_themes: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 },
            sample_posts: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: {
                type: "object",
                properties: {
                  stance: { type: "string", enum: ["bullish", "bearish", "neutral"] },
                  text: { type: "string" },
                  author_handle: { type: "string" },
                },
                required: ["stance", "text", "author_handle"],
                additionalProperties: false,
              },
            },
            ai_trending: {
              type: "object",
              properties: {
                rank: { type: ["number", "null"] },
                trend_direction: { type: "string", enum: ["rising", "falling", "stable"] },
                momentum_score: { type: "number" },
              },
              required: ["rank", "trend_direction", "momentum_score"],
              additionalProperties: false,
            },
            verdict: {
              type: "string",
              enum: ["crowd_bullish", "crowd_bearish", "mixed", "low_signal"],
            },
            alignment_with_setup: {
              type: "string",
              enum: ["aligned", "contrarian", "neutral"],
            },
            one_liner: { type: "string" },
          },
          required: [
            "total_posts",
            "bullish_posts",
            "bearish_posts",
            "neutral_posts",
            "bullish_pct",
            "bearish_pct",
            "neutral_pct",
            "top_themes",
            "sample_posts",
            "ai_trending",
            "verdict",
            "alignment_with_setup",
            "one_liner",
          ],
          additionalProperties: false,
        },
      },
    };

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "report_sentiment" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429)
        return json({ error: "Rate limited, please try again later." }, 429);
      if (aiResp.status === 402)
        return json({ error: "AI credits exhausted. Add credits in Workspace > Usage." }, 402);
      const t = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, t);
      return json({ error: "AI gateway error" }, 500);
    }

    const data = await aiResp.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) return json({ error: "No structured response" }, 500);

    const sentiment = JSON.parse(call.function.arguments);
    CACHE.set(cacheKey, { ts: Date.now(), data: sentiment });

    return json({ sentiment, cached: false });
  } catch (e) {
    console.error("social-sentiment error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
