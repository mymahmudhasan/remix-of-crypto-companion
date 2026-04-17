// Tool-using crypto trading assistant.
// The model can call: get_price, get_indicators, get_gas, get_news_sentiment, get_token_security.
// We loop until the model returns a final text answer (max 4 tool rounds).
import { corsHeaders } from "npm:@supabase/supabase-js/cors";

interface Msg { role: "user" | "assistant" | "system" | "tool"; content: string; tool_call_id?: string; name?: string; tool_calls?: any[] }

interface Body {
  messages: { role: "user" | "assistant"; content: string }[];
  context?: {
    symbol: string;
    interval: string;
    snapshot: Record<string, number | null | string>;
    bias: string;
    score: number;
    reasons: string[];
  };
}

const BINANCE = "https://api.binance.com";

// ---------- TOOL IMPLEMENTATIONS ----------

function pairOf(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.endsWith("USDT") || s.endsWith("USDC") || s.endsWith("BUSD")) return s;
  return `${s}USDT`;
}

async function tool_get_price(args: { symbol: string }) {
  const sym = pairOf(args.symbol);
  const r = await fetch(`${BINANCE}/api/v3/ticker/24hr?symbol=${sym}`);
  if (!r.ok) return { error: `No data for ${sym}` };
  const d = await r.json();
  return {
    symbol: sym,
    price: parseFloat(d.lastPrice),
    change24hPct: parseFloat(d.priceChangePercent),
    high24h: parseFloat(d.highPrice),
    low24h: parseFloat(d.lowPrice),
    volume24hQuote: parseFloat(d.quoteVolume),
  };
}

// Lightweight EMA/RSI/MACD computation on the edge (avoid importing heavy libs)
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
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

async function tool_get_indicators(args: { symbol: string; interval?: string }) {
  const sym = pairOf(args.symbol);
  const tf = args.interval ?? "1h";
  const r = await fetch(`${BINANCE}/api/v3/klines?symbol=${sym}&interval=${tf}&limit=300`);
  if (!r.ok) return { error: `No klines for ${sym} ${tf}` };
  const k: any[][] = await r.json();
  const closes = k.map((c) => parseFloat(c[4]));
  const price = closes[closes.length - 1];
  const e20 = ema(closes, 20).at(-1) ?? null;
  const e50 = ema(closes, 50).at(-1) ?? null;
  const e200 = ema(closes, 200).at(-1) ?? null;
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const macdLine = closes.map((_, i) => (e12[i] !== undefined && e26[i] !== undefined ? e12[i] - e26[i] : null)).filter((v) => v !== null) as number[];
  const sigLine = ema(macdLine, 9);
  const macd = macdLine.at(-1) ?? null;
  const macdSig = sigLine.at(-1) ?? null;
  const macdHist = macd !== null && macdSig !== null ? macd - macdSig : null;
  const r14 = rsi(closes, 14);
  const recentHigh = Math.max(...closes.slice(-50));
  const recentLow = Math.min(...closes.slice(-50));
  // Bias verdict
  const above200 = e200 !== null && price > e200;
  const above50 = e50 !== null && price > e50;
  let verdict = "neutral";
  if (above200 && above50 && (r14 ?? 50) > 50 && (macdHist ?? 0) > 0) verdict = "bullish";
  else if (!above200 && !above50 && (r14 ?? 50) < 50 && (macdHist ?? 0) < 0) verdict = "bearish";
  let zone = "neutral";
  if ((r14 ?? 50) > 70) zone = "overbought";
  else if ((r14 ?? 50) < 30) zone = "oversold";
  return {
    symbol: sym, interval: tf, price,
    rsi14: r14 !== null ? +r14.toFixed(2) : null,
    ema20: e20, ema50: e50, ema200: e200,
    macd, macdSignal: macdSig, macdHist,
    recentHigh, recentLow,
    verdict, zone,
  };
}

async function tool_get_gas(args: { chain?: string }) {
  const chain = (args.chain ?? "ethereum").toLowerCase();
  // Owlracle public endpoint (no key needed for low-rate calls)
  const slug = chain === "polygon" || chain === "matic" ? "poly"
    : chain === "arbitrum" || chain === "arb" ? "arb"
    : chain === "bsc" || chain === "bnb" ? "bsc"
    : chain === "optimism" || chain === "op" ? "opt"
    : chain === "avalanche" || chain === "avax" ? "avax"
    : "eth";
  try {
    const r = await fetch(`https://api.owlracle.info/v4/${slug}/gas?apikey=`);
    if (!r.ok) return { error: `Gas API ${r.status}` };
    const d = await r.json();
    const speeds = d.speeds ?? [];
    return {
      chain: slug,
      slow: speeds[0]?.gasPrice ?? null,
      standard: speeds[1]?.gasPrice ?? null,
      fast: speeds[2]?.gasPrice ?? null,
      instant: speeds[3]?.gasPrice ?? null,
      unit: "gwei",
      baseFee: d.baseFee ?? null,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Gas fetch failed" };
  }
}

async function tool_get_news_sentiment(args: { symbol?: string }) {
  // Hit our own news-fetch function for consistency with the News tab.
  const projectUrl = Deno.env.get("SUPABASE_URL");
  const params = new URLSearchParams();
  if (args.symbol) params.set("symbol", args.symbol.replace(/USDT$/i, "").toUpperCase());
  params.set("limit", "20");
  try {
    const r = await fetch(`${projectUrl}/functions/v1/news-fetch?${params}`, {
      headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}` },
    });
    if (!r.ok) return { error: `News ${r.status}` };
    const d = await r.json();
    const items = (d.items ?? []) as any[];
    if (items.length === 0) return { items: [], sentiment: "neutral", score: 0, count: 0 };
    const score = items.reduce((s, it) => s + (it.sentimentScore ?? 0), 0) / items.length;
    const sentiment = score > 10 ? "bullish" : score < -10 ? "bearish" : "neutral";
    const top = items.slice(0, 5).map((it) => ({
      title: it.title, source: it.source, sentiment: it.sentiment, ageMinutes: Math.round((Date.now() - it.publishedAt) / 60000),
    }));
    return { count: items.length, avgScore: +score.toFixed(1), sentiment, topHeadlines: top };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "News fetch failed" };
  }
}

async function tool_get_token_security(args: { contractAddress: string; chain?: string }) {
  const chainId = (args.chain ?? "ethereum").toLowerCase();
  const idMap: Record<string, string> = {
    ethereum: "1", eth: "1",
    bsc: "56", bnb: "56",
    polygon: "137", matic: "137",
    arbitrum: "42161", arb: "42161",
    base: "8453",
    optimism: "10", op: "10",
    avalanche: "43114", avax: "43114",
  };
  const cid = idMap[chainId] ?? "1";
  try {
    const r = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${cid}?contract_addresses=${args.contractAddress.toLowerCase()}`);
    if (!r.ok) return { error: `GoPlus ${r.status}` };
    const d = await r.json();
    const t = d.result?.[args.contractAddress.toLowerCase()];
    if (!t) return { error: "Contract not found in GoPlus database" };
    const flags: string[] = [];
    if (t.is_honeypot === "1") flags.push("HONEYPOT");
    if (t.is_proxy === "1") flags.push("proxy contract");
    if (t.is_mintable === "1") flags.push("mintable");
    if (t.can_take_back_ownership === "1") flags.push("ownership can be taken back");
    if (t.owner_change_balance === "1") flags.push("owner can change balance");
    if (t.hidden_owner === "1") flags.push("hidden owner");
    if (t.selfdestruct === "1") flags.push("selfdestruct enabled");
    if (t.transfer_pausable === "1") flags.push("transfers pausable");
    if (parseFloat(t.buy_tax ?? "0") > 0.1) flags.push(`buy tax ${(parseFloat(t.buy_tax) * 100).toFixed(1)}%`);
    if (parseFloat(t.sell_tax ?? "0") > 0.1) flags.push(`sell tax ${(parseFloat(t.sell_tax) * 100).toFixed(1)}%`);
    const verdict = flags.includes("HONEYPOT") ? "DANGER" : flags.length >= 3 ? "high risk" : flags.length > 0 ? "medium risk" : "looks ok";
    return {
      symbol: t.token_symbol, name: t.token_name,
      verdict, flags,
      buyTax: t.buy_tax, sellTax: t.sell_tax,
      isOpenSource: t.is_open_source === "1",
      holders: t.holder_count, totalSupply: t.total_supply,
      lpHolders: t.lp_holder_count,
      lpLockedPct: t.lp_total_supply ? null : null,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Security check failed" };
  }
}

// ---------- TOOL SCHEMAS ----------

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_price",
      description: "Get the current price, 24h change %, 24h high/low, and 24h volume for a crypto symbol from Binance. Use for any 'what's the price of X' question.",
      parameters: {
        type: "object",
        properties: { symbol: { type: "string", description: "Token symbol or pair (e.g. 'BTC', 'SOL', 'ETHUSDT')." } },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_indicators",
      description: "Compute live technical indicators (RSI-14, EMA 20/50/200, MACD, recent range) for a symbol on a chosen timeframe. Use for 'is X overbought?', 'what's the trend?', 'is MACD bullish?'.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          interval: { type: "string", enum: ["15m", "1h", "4h", "1d"], description: "Default 1h." },
        },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_gas",
      description: "Get live gas prices in gwei for an EVM chain (slow/standard/fast/instant). Use for 'when's a good time to swap on Ethereum?'.",
      parameters: {
        type: "object",
        properties: { chain: { type: "string", enum: ["ethereum", "polygon", "arbitrum", "optimism", "bsc", "avalanche", "base"], description: "Default ethereum." } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_news_sentiment",
      description: "Get aggregated news sentiment (bullish/bearish/neutral) and the top recent headlines, optionally filtered to one token. Use for 'what's the news on X?', 'why is X pumping?'.",
      parameters: {
        type: "object",
        properties: { symbol: { type: "string", description: "Optional token filter (e.g. 'BTC')." } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_token_security",
      description: "Run a smart-contract security check via GoPlus: honeypot risk, buy/sell tax, mintable, ownership flags. Use ONLY when the user gives a contract address.",
      parameters: {
        type: "object",
        properties: {
          contractAddress: { type: "string", description: "0x… EVM contract address." },
          chain: { type: "string", enum: ["ethereum", "bsc", "polygon", "arbitrum", "base", "optimism", "avalanche"], description: "Default ethereum." },
        },
        required: ["contractAddress"],
        additionalProperties: false,
      },
    },
  },
];

async function runTool(name: string, args: any): Promise<any> {
  switch (name) {
    case "get_price": return await tool_get_price(args);
    case "get_indicators": return await tool_get_indicators(args);
    case "get_gas": return await tool_get_gas(args);
    case "get_news_sentiment": return await tool_get_news_sentiment(args);
    case "get_token_security": return await tool_get_token_security(args);
    default: return { error: `Unknown tool ${name}` };
  }
}

// ---------- HANDLER ----------

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
      ? `\nCURRENT CHART CONTEXT (the user is looking at this right now):
- Pair: ${body.context.symbol}
- Timeframe: ${body.context.interval}
- Composite bias: ${body.context.bias.toUpperCase()} (score ${body.context.score})
- Snapshot: ${JSON.stringify(body.context.snapshot)}
- Reasons: ${body.context.reasons.join("; ")}
When the user says "this", "it", "the chart" — they mean ${body.context.symbol} on ${body.context.interval}.`
      : "";

    const system = `You are CryptoDesk, a sharp, honest crypto trading assistant for an experienced trader.

Style: concise, structured, terminal-flavored. Use bullet points and short sections (Setup / Plan / Risk).
Always discuss: entry zone, invalidation (stop), targets, position sizing in % risk terms when giving trade ideas.
Never guarantee outcomes. Educational analysis only — not financial advice.

TOOLS — call them whenever you need fresh data:
- get_price for current price / 24h change.
- get_indicators for RSI / EMA / MACD verdict (overbought, trend).
- get_gas for ETH/L2 gas in gwei.
- get_news_sentiment for headlines + bull/bear bias.
- get_token_security ONLY when given a 0x contract address.

You can chain tool calls. Prefer fewer (1-3) targeted calls over many. After tools return, synthesize into a final answer that quotes the specific numbers.${ctxText}`;

    const conversation: Msg[] = [
      { role: "system", content: system },
      ...body.messages,
    ];

    const toolTrace: { name: string; args: any }[] = [];
    let finalContent = "";

    // Tool-call loop (max 4 rounds to bound cost)
    for (let round = 0; round < 4; round++) {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: conversation,
          tools: TOOLS,
          tool_choice: "auto",
        }),
      });

      if (!resp.ok) {
        if (resp.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again in a moment." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (resp.status === 402) {
          return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in workspace settings." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const t = await resp.text();
        console.error("AI gateway error:", resp.status, t);
        return new Response(JSON.stringify({ error: "AI gateway error" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await resp.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error("No message in AI response");

      const toolCalls = msg.tool_calls as any[] | undefined;

      if (!toolCalls || toolCalls.length === 0) {
        finalContent = msg.content ?? "";
        break;
      }

      // Append assistant turn (must include tool_calls so the gateway accepts our tool replies).
      conversation.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });

      // Run each tool in parallel and append results.
      const results = await Promise.all(toolCalls.map(async (tc: any) => {
        let parsedArgs: any = {};
        try { parsedArgs = JSON.parse(tc.function.arguments || "{}"); } catch {}
        toolTrace.push({ name: tc.function.name, args: parsedArgs });
        const out = await runTool(tc.function.name, parsedArgs);
        return { id: tc.id, name: tc.function.name, out };
      }));

      for (const r of results) {
        conversation.push({
          role: "tool",
          tool_call_id: r.id,
          name: r.name,
          content: JSON.stringify(r.out),
        });
      }
    }

    if (!finalContent) {
      finalContent = "I gathered some data but couldn't form a final answer. Try rephrasing your question.";
    }

    return new Response(JSON.stringify({ content: finalContent, toolTrace }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("trade-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
