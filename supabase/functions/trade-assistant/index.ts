import { corsHeaders } from "npm:@supabase/supabase-js/cors";

interface Msg { role: "user" | "assistant" | "system"; content: string }

interface Body {
  messages: Msg[];
  context?: {
    symbol: string;
    interval: string;
    snapshot: Record<string, number | null | string>;
    bias: string;
    score: number;
    reasons: string[];
  };
}

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
      ? `\nCURRENT MARKET CONTEXT (live, from Binance):
- Pair: ${body.context.symbol}
- Timeframe: ${body.context.interval}
- Composite bias: ${body.context.bias.toUpperCase()} (score ${body.context.score})
- Snapshot: ${JSON.stringify(body.context.snapshot)}
- Reasons: ${body.context.reasons.join("; ")}
Use this context when relevant. Quote specific numbers (price, RSI, EMAs, MACD, S/R levels).`
      : "";

    const system = `You are CryptoDesk, a sharp, honest crypto trading assistant for an experienced trader.
Style: concise, structured, terminal-flavored. Use bullet points and short sections (Setup / Plan / Risk).
Always discuss: entry zone, invalidation (stop), targets, and position sizing in % risk terms.
Never guarantee outcomes. Always remind that this is educational analysis, not financial advice.
Refuse to give tax, legal, or personal financial advice.${ctxText}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: system }, ...body.messages],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in Lovable workspace settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("trade-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
