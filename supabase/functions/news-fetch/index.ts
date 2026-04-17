// Aggregates crypto news from public RSS feeds, tags symbols, and scores sentiment.
// No external libs — RSS is parsed with regex (XML is well-formed for these feeds).
import { corsHeaders } from "@supabase/supabase-js/cors";

const FEEDS: { source: string; url: string }[] = [
  { source: "CoinDesk",       url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "Cointelegraph",  url: "https://cointelegraph.com/rss" },
  { source: "Decrypt",        url: "https://decrypt.co/feed" },
  { source: "The Block",      url: "https://www.theblock.co/rss.xml" },
  { source: "Bitcoin Magazine", url: "https://bitcoinmagazine.com/.rss/full/" },
];

// Token universe — base symbol → list of keywords (case-insensitive, word-boundary matched).
// Keep the keyword list tight to reduce false positives.
const TOKEN_MAP: Record<string, string[]> = {
  BTC: ["bitcoin", "btc"],
  ETH: ["ethereum", "ether ", " eth "],
  SOL: ["solana", " sol "],
  XRP: ["ripple", "xrp"],
  BNB: ["binance coin", " bnb "],
  ADA: ["cardano", " ada "],
  DOGE: ["dogecoin", "doge"],
  AVAX: ["avalanche", "avax"],
  LINK: ["chainlink", " link "],
  MATIC: ["polygon", "matic"],
  POL: [" pol token", " pol "],
  DOT: ["polkadot", " dot "],
  LTC: ["litecoin", "ltc"],
  TRX: ["tron", " trx "],
  HBAR: ["hedera", "hbar"],
  ATOM: ["cosmos", "atom"],
  NEAR: ["near protocol", " near "],
  APT: ["aptos", " apt "],
  SUI: [" sui ", "sui network"],
  ARB: ["arbitrum", " arb "],
  OP: ["optimism", " op "],
  TON: ["toncoin", " ton "],
  SHIB: ["shiba inu", "shib"],
  PEPE: ["pepe coin", " pepe"],
  WIF: ["dogwifhat", " wif "],
  BONK: ["bonk"],
  INJ: ["injective", " inj "],
  TIA: ["celestia", " tia "],
  SEI: [" sei "],
  RNDR: ["render network", " rndr "],
  FET: ["fetch.ai", " fet "],
  AAVE: ["aave"],
  UNI: ["uniswap", " uni "],
  LDO: ["lido", " ldo "],
  ENA: ["ethena", " ena "],
  PYTH: ["pyth network", " pyth "],
  JUP: ["jupiter", " jup "],
  ORDI: ["ordinals", " ordi "],
};

const BULL_KW = [
  "approval", "approved", "approves", "etf", "spot etf", "rally", "rallies", "surge", "surges",
  "soar", "soars", "all-time high", "ath", "breakout", "bullish", "buy", "buying", "accumulate",
  "accumulation", "adoption", "partnership", "integrates", "integration", "launch", "launches",
  "listed on", "listing", "upgrade", "upgrades", "burn", "burns", "deflation", "halving",
  "institutional", "blackrock", "fidelity", "treasury buys", "raises", "raised", "funding",
  "ceasefire", "rate cut", "cuts rates", "dovish",
];

const BEAR_KW = [
  "hack", "hacked", "exploit", "exploited", "stolen", "drained", "rug", "scam",
  "lawsuit", "sued", "sues", "sec charges", "indicted", "fraud", "ban", "bans", "banned",
  "delisted", "delisting", "bankrupt", "bankruptcy", "insolvent", "liquidated", "liquidation",
  "crash", "plunge", "plunges", "tumble", "tumbles", "selloff", "sell-off", "dump", "dumps",
  "bearish", "outflow", "outflows", "warning", "fud", "halts", "halted", "outage",
  "regulation", "crackdown", "tariff", "rate hike", "hawkish", "war ", "conflict",
];

interface NewsItem {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: number; // unix ms
  symbols: string[];   // base symbols, e.g. ["BTC","ETH"]
  sentiment: "bullish" | "bearish" | "neutral";
  sentimentScore: number; // -100..100
  matchedKeywords: { bull: string[]; bear: string[] };
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/<[^>]+>/g, " ") // strip nested HTML
    .replace(/\s+/g, " ").trim();
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = re.exec(xml);
  return m ? decodeEntities(m[1]) : null;
}

function parseRss(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  // Match both <item>…</item> (RSS) and <entry>…</entry> (Atom)
  const blockRe = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(xml)) !== null) {
    const block = match[0];
    const title = extractTag(block, "title") ?? "";
    if (!title) continue;
    const link = extractTag(block, "link") ?? (
      // Atom: <link href="…"/>
      /<link[^>]*href=["']([^"']+)["']/i.exec(block)?.[1] ?? ""
    );
    const description = extractTag(block, "description")
      ?? extractTag(block, "summary")
      ?? extractTag(block, "content")
      ?? "";
    const pubDateRaw = extractTag(block, "pubDate")
      ?? extractTag(block, "published")
      ?? extractTag(block, "updated")
      ?? "";
    const ts = pubDateRaw ? Date.parse(pubDateRaw) : Date.now();

    const haystack = `${title} ${description}`.toLowerCase();
    // Symbol match
    const symbols: string[] = [];
    for (const [sym, kws] of Object.entries(TOKEN_MAP)) {
      if (kws.some((kw) => haystack.includes(kw.toLowerCase()))) symbols.push(sym);
    }
    // Sentiment
    const bullHits: string[] = [];
    const bearHits: string[] = [];
    for (const kw of BULL_KW) if (haystack.includes(kw)) bullHits.push(kw);
    for (const kw of BEAR_KW) if (haystack.includes(kw)) bearHits.push(kw);
    const raw = bullHits.length - bearHits.length;
    const score = Math.max(-100, Math.min(100, raw * 25));
    const sentiment: NewsItem["sentiment"] = score > 15 ? "bullish" : score < -15 ? "bearish" : "neutral";

    items.push({
      id: `${source}:${link || title}`,
      source,
      title,
      summary: description.slice(0, 280),
      url: link,
      publishedAt: isNaN(ts) ? Date.now() : ts,
      symbols,
      sentiment,
      sentimentScore: score,
      matchedKeywords: { bull: bullHits.slice(0, 5), bear: bearHits.slice(0, 5) },
    });
  }
  return items;
}

async function fetchFeed(source: string, url: string, signal: AbortSignal): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, {
      signal,
      headers: { "User-Agent": "CryptoDeskNewsBot/1.0 (+https://lovable.dev)" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml, source);
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const symbolFilter = url.searchParams.get("symbol")?.toUpperCase().replace(/USDT$/, "") ?? null;
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "60", 10) || 60, 150);

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    const all = (await Promise.all(FEEDS.map((f) => fetchFeed(f.source, f.url, ctrl.signal)))).flat();
    clearTimeout(t);

    // Sort newest first, then dedupe by URL (some feeds repost)
    const seen = new Set<string>();
    const sorted = all
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .filter((it) => {
        const k = it.url || it.title;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

    const filtered = symbolFilter
      ? sorted.filter((it) => it.symbols.includes(symbolFilter))
      : sorted;

    return new Response(
      JSON.stringify({ items: filtered.slice(0, limit), fetchedAt: Date.now() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
