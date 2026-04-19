// Streaming AI analyst chat — proxies Lovable AI Gateway with a trading-desk system prompt.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are "Desk Analyst", a senior crypto trading analyst chatting live with a retail trader on the Cryptodesk terminal.

Style:
- Direct, professional, concise (≤6 short paragraphs unless asked for depth).
- Use markdown: **bold** levels, bullet lists for plans, fenced code blocks for math/levels.
- When discussing a setup, ALWAYS structure: bias (long/short/flat) → entry zone → invalidation (SL) → 2–3 targets → R:R → conviction (0–100) → catalysts to watch.
- Quote Binance USDT pairs in BASE/USDT format (e.g. BTC/USDT).
- If you don't know live price data, say so and ask the user to share the timeframe / current price.

Disclaimers:
- This is educational analysis, not financial advice. Remind once per conversation, not every message.
- Never promise outcomes. Always frame in probabilities.

Hard rules:
- No shilling, no referral links, no leverage > 25× recommendations.
- If the user asks for non-trading topics, politely redirect.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, context } = await req.json();
    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages[] required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const sysMessages = [{ role: "system", content: SYSTEM_PROMPT }];
    if (context && typeof context === "string" && context.trim().length > 0) {
      sysMessages.push({
        role: "system",
        content: `Live terminal context the user is viewing right now:\n${context.slice(0, 4000)}`,
      });
    }

    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [...sysMessages, ...messages],
        stream: true,
      }),
    });

    if (!upstream.ok) {
      if (upstream.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit hit on the analyst desk. Try again in a minute." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (upstream.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Top up in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await upstream.text();
      console.error("AI gateway error", upstream.status, t);
      return new Response(JSON.stringify({ error: "Upstream AI error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(upstream.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("analyst-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
