// Pro Analysis edge function — Lovable AI Gateway, returns 6-section structured
// analysis (portfolio fit, entry/exit alerts, altcoin deep-dive, signal strength,
// defi/yield angle, risk framework) using OpenAI tool calling.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are "Pro Desk", a senior crypto strategist combining the work of a portfolio manager, an on-chain analyst, a DeFi yield specialist, and a risk officer.

You will receive:
- A trade setup (symbol, side, entry zone, stop, targets, conviction, timeframe, leverage if futures).
- The user's manual portfolio (holdings + USD sizes + sectors).

Return a single tool call to "pro_analysis" with these sections:

1. portfolio_fit — How does this setup fit the existing portfolio? Flag concentration risk, correlation with current holdings, sector overlap. Recommend max % of portfolio to allocate to this trade.
2. entry_exit_alerts — Specific price levels to watch (entry trigger, scale-in zones, partial exit ladder, hard invalidation). Be numeric.
3. altcoin_deep_dive — If the symbol is BTC or ETH, do a macro read instead. For altcoins: tokenomics red/green flags, recent catalysts, BTC correlation, market-structure note. 2–4 sentences.
4. signal_strength — Verdict GO / WAIT / SKIP with one-line reason and a 0–100 conviction score (must be coherent with the trade's own conviction).
5. defi_yield_angle — Realistic ways to earn yield on this asset (LSTs, money markets, LP pools) — name 1–3 protocols with rough APR ranges and main risk. If no good options exist, say so.
6. risk_framework — Rules table: max % of account per trade, max sector concentration, max total open risk, drawdown circuit-breaker, correlation cap. Tailor numbers to the user's account size.

Be terse, numeric, professional. No fluff, no hedging "consult a financial advisor" lines (the UI already shows a disclaimer).`;

const TOOL = {
  type: "function",
  function: {
    name: "pro_analysis",
    description: "Return a structured 6-section pro analysis of a trade setup vs the user's portfolio.",
    parameters: {
      type: "object",
      properties: {
        portfolio_fit: {
          type: "object",
          properties: {
            verdict: { type: "string", enum: ["fits_well", "concentration_risk", "redundant", "too_correlated", "no_portfolio"] },
            summary: { type: "string", description: "2–3 sentence read of how this setup fits the portfolio" },
            recommended_alloc_pct: { type: "number", description: "Max % of total account to allocate (0–25)" },
            concerns: { type: "array", items: { type: "string" }, maxItems: 4 },
          },
          required: ["verdict", "summary", "recommended_alloc_pct", "concerns"],
          additionalProperties: false,
        },
        entry_exit_alerts: {
          type: "object",
          properties: {
            entry_trigger: { type: "string", description: "Specific price/condition to confirm entry" },
            scale_ins: { type: "array", items: { type: "string" }, maxItems: 4 },
            partial_exits: { type: "array", items: { type: "string" }, maxItems: 4 },
            hard_invalidation: { type: "string" },
          },
          required: ["entry_trigger", "scale_ins", "partial_exits", "hard_invalidation"],
          additionalProperties: false,
        },
        altcoin_deep_dive: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["btc_macro", "eth_macro", "altcoin"] },
            green_flags: { type: "array", items: { type: "string" }, maxItems: 4 },
            red_flags: { type: "array", items: { type: "string" }, maxItems: 4 },
            narrative: { type: "string", description: "One short paragraph on the asset's current narrative" },
          },
          required: ["kind", "green_flags", "red_flags", "narrative"],
          additionalProperties: false,
        },
        signal_strength: {
          type: "object",
          properties: {
            verdict: { type: "string", enum: ["GO", "WAIT", "SKIP"] },
            conviction: { type: "number", minimum: 0, maximum: 100 },
            reason: { type: "string" },
          },
          required: ["verdict", "conviction", "reason"],
          additionalProperties: false,
        },
        defi_yield_angle: {
          type: "object",
          properties: {
            available: { type: "boolean" },
            opportunities: {
              type: "array",
              maxItems: 4,
              items: {
                type: "object",
                properties: {
                  protocol: { type: "string" },
                  strategy: { type: "string", description: "e.g. 'Stake on Lido', 'Supply on Aave', 'ETH/USDC LP'" },
                  apr_range: { type: "string", description: "e.g. '3–4%'" },
                  main_risk: { type: "string" },
                },
                required: ["protocol", "strategy", "apr_range", "main_risk"],
                additionalProperties: false,
              },
            },
            note: { type: "string" },
          },
          required: ["available", "opportunities", "note"],
          additionalProperties: false,
        },
        risk_framework: {
          type: "object",
          properties: {
            max_risk_per_trade_pct: { type: "number" },
            max_sector_concentration_pct: { type: "number" },
            max_total_open_risk_pct: { type: "number" },
            drawdown_circuit_breaker_pct: { type: "number" },
            correlation_cap_note: { type: "string" },
            extra_rules: { type: "array", items: { type: "string" }, maxItems: 4 },
          },
          required: [
            "max_risk_per_trade_pct", "max_sector_concentration_pct",
            "max_total_open_risk_pct", "drawdown_circuit_breaker_pct",
            "correlation_cap_note", "extra_rules",
          ],
          additionalProperties: false,
        },
      },
      required: [
        "portfolio_fit", "entry_exit_alerts", "altcoin_deep_dive",
        "signal_strength", "defi_yield_angle", "risk_framework",
      ],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { setup, portfolio } = body || {};
    if (!setup || typeof setup !== "object") {
      return new Response(JSON.stringify({ error: "setup{} required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const userPrompt = `Trade setup:\n${JSON.stringify(setup, null, 2)}\n\nUser portfolio:\n${typeof portfolio === "string" ? portfolio : JSON.stringify(portfolio || {}, null, 2)}`;

    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "pro_analysis" } },
      }),
    });

    if (!upstream.ok) {
      if (upstream.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit hit. Try again in a minute." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (upstream.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Top up in Settings → Workspace → Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await upstream.text();
      console.error("pro-analysis gateway error", upstream.status, t);
      return new Response(JSON.stringify({ error: "Upstream AI error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await upstream.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) {
      return new Response(JSON.stringify({ error: "Model returned no structured analysis" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let parsed: unknown;
    try { parsed = JSON.parse(call.function.arguments); }
    catch {
      return new Response(JSON.stringify({ error: "Model returned invalid JSON" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ analysis: parsed, generated_at: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pro-analysis error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
