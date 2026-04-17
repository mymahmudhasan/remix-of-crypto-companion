import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Send, Sparkles, Loader2, AlertCircle, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { snapshot, scoreSignal } from "@/lib/indicators";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface ToolCall { name: string; args: any }
interface Msg {
  role: "user" | "assistant";
  content: string;
  tools?: ToolCall[];
}

interface Props {
  symbol: string;
  interval: string;
  closes: number[];
}

const QUICK_PROMPTS = [
  "What's the current setup?",
  "Is SOL overbought right now?",
  "What's the news on BTC?",
  "How's gas on Ethereum?",
];

const TOOL_LABEL: Record<string, string> = {
  get_price: "📈 Price",
  get_indicators: "📊 Indicators",
  get_gas: "⛽ Gas",
  get_news_sentiment: "📰 News",
  get_token_security: "🛡 Security",
};

export function AIAssistant({ symbol, interval, closes }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    setError(null);
    const userMsg: Msg = { role: "user", content: text.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);

    let context: any = undefined;
    if (closes.length >= 50) {
      const s = snapshot(closes);
      const sig = scoreSignal(s);
      context = {
        symbol, interval,
        snapshot: {
          price: s.price.toFixed(6),
          rsi14: s.rsi14?.toFixed(2) ?? null,
          ema20: s.ema20?.toFixed(6) ?? null,
          ema50: s.ema50?.toFixed(6) ?? null,
          ema200: s.ema200?.toFixed(6) ?? null,
          macd: s.macd?.toFixed(6) ?? null,
          macdSignal: s.macdSignal?.toFixed(6) ?? null,
          macdHist: s.macdHist?.toFixed(6) ?? null,
          recentHigh: s.recentHigh.toFixed(6),
          recentLow: s.recentLow.toFixed(6),
          changePct50: s.changePct.toFixed(2),
        },
        bias: sig.bias, score: sig.score, reasons: sig.reasons,
      };
    }

    try {
      const { data, error: fnError } = await supabase.functions.invoke("trade-assistant", {
        body: {
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          context,
        },
      });

      if (fnError) {
        const msg = fnError.message || "Request failed";
        if (msg.includes("429")) throw new Error("Rate limit hit. Wait a moment and try again.");
        if (msg.includes("402")) throw new Error("AI credits exhausted. Add credits in workspace settings.");
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);

      const assistantMsg: Msg = {
        role: "assistant",
        content: data?.content ?? "(no response)",
        tools: data?.toolTrace ?? [],
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-3.5 text-primary" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI Assistant</h3>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">Context: {symbol} · {interval}</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
            <div className="flex size-12 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
              <Sparkles className="size-5 text-primary" />
            </div>
            <p className="max-w-xs font-mono text-xs leading-relaxed text-muted-foreground">
              Ask me about <span className="text-foreground">{symbol.replace("USDT", "/USDT")}</span> or any token.
              I can fetch live prices, indicators, gas, news & contract security on demand.
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="rounded-md border border-border bg-surface-elevated px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={cn("flex flex-col gap-1", m.role === "user" ? "items-end" : "items-start")}>
              {m.role === "assistant" && m.tools && m.tools.length > 0 && (
                <div className="flex flex-wrap gap-1 px-1">
                  {m.tools.map((t, idx) => (
                    <span
                      key={idx}
                      title={JSON.stringify(t.args)}
                      className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary"
                    >
                      <Wrench className="size-2.5" />
                      {TOOL_LABEL[t.name] ?? t.name}
                      {t.args?.symbol && <span className="text-muted-foreground">· {t.args.symbol}</span>}
                      {t.args?.chain && <span className="text-muted-foreground">· {t.args.chain}</span>}
                    </span>
                  ))}
                </div>
              )}
              <div
                className={cn(
                  "max-w-[90%] rounded-md px-3 py-2 text-sm",
                  m.role === "user"
                    ? "bg-primary/15 border border-primary/30 text-foreground"
                    : "bg-surface-elevated border border-border text-foreground"
                )}
              >
                {m.role === "assistant" ? (
                  <div className="prose prose-sm prose-invert max-w-none font-sans
                    prose-headings:font-mono prose-headings:text-foreground prose-headings:mb-1 prose-headings:mt-2
                    prose-p:my-1 prose-p:leading-relaxed
                    prose-strong:text-primary
                    prose-ul:my-1 prose-li:my-0
                    prose-code:font-mono prose-code:text-xs prose-code:bg-background prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                    <ReactMarkdown>{m.content || "…"}</ReactMarkdown>
                  </div>
                ) : (
                  <span className="font-mono text-xs">{m.content}</span>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> looking up live data…
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 font-mono text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> <span>{error}</span>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="flex items-center gap-2 border-t border-border p-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about ${symbol.replace("USDT", "")}, gas, news, a contract…`}
          className="flex-1 rounded-md border border-border bg-surface-elevated px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
          disabled={loading}
        />
        <Button type="submit" size="sm" disabled={loading || !input.trim()} className="bg-primary text-primary-foreground hover:bg-primary-glow">
          <Send className="size-3.5" />
        </Button>
      </form>
    </div>
  );
}
