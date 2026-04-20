// Generates a Binance-Square-style post (200+ words, 5 hashtags, coin tag) for a premium signal.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { signal } = await req.json();
    if (!signal?.symbol) return json({ error: "signal is required" }, 400);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    const base = signal.symbol.replace(/USDT$|USD$|BUSD$/, "");
    const sideEmoji = signal.side === "long" ? "🟢" : "🔴";
    const sideLabel = signal.side === "long" ? "LONG" : "SHORT";

    const sysPrompt =
      "You write professional, engaging Binance Square posts about crypto trade setups. Posts must read like a confident trader sharing analysis — not marketing. Use short paragraphs, emojis sparingly (2-4 max), and concrete price levels. Mandatory length: 200-260 words. End with exactly 5 relevant hashtags on a single final line. Always tag the coin with $TICKER format inside the body at least once. Never include disclaimers like 'not financial advice' — keep it clean.";

    const userPrompt = `Write a Binance Square post for this premium signal:

Coin: $${base}
Direction: ${sideLabel} ${sideEmoji}
Setup: ${signal.setup_name}
Conviction: ${signal.conviction}/100
Timeframe: ${signal.timeframe}
Leverage: ${signal.leverage}x
Entry zone: ${signal.entry_low} – ${signal.entry_high}
Stop loss: ${signal.stop}
Targets: T1 ${signal.targets?.[0]} · T2 ${signal.targets?.[1]} · T3 ${signal.targets?.[2]}
Risk/Reward: ${signal.risk_reward}
Trigger / catalysts: ${signal.catalysts}
Why this setup:
${(signal.reasoning || []).map((r: string) => `- ${r}`).join("\n")}
Invalidation: ${signal.invalidation}

Structure:
1. Hook line with $${base} and ${sideLabel} bias.
2. Market context paragraph (3-4 sentences) referencing the catalysts.
3. The plan: spell out entry, stop, targets, R:R clearly.
4. Why I'm taking it: bullet 2-3 reasons from the reasoning above.
5. Risk note: one sentence with the invalidation.
6. Final line: 5 hashtags (mix #${base}, #Crypto, #Binance, #Trading, plus one setup-specific).`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) return json({ error: "Rate limited, please wait." }, 429);
      if (aiResp.status === 402) return json({ error: "AI credits exhausted. Add credits in Workspace > Usage." }, 402);
      const t = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, t);
      return json({ error: "AI gateway error" }, 500);
    }

    const data = await aiResp.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    if (!text) return json({ error: "Empty AI response" }, 500);

    // Extract hashtags from final line
    const lines = text.trim().split("\n").filter(Boolean);
    const lastLine = lines[lines.length - 1] ?? "";
    const hashtags = (lastLine.match(/#[A-Za-z0-9_]+/g) ?? []).slice(0, 5);
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    return json({
      post: text.trim(),
      hashtags,
      wordCount,
      coinTag: `$${base}`,
      symbol: signal.symbol,
      side: signal.side,
    });
  } catch (e) {
    console.error("square-post error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
