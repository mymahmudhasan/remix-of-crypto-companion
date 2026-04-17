import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Send, Sparkles, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { snapshot, scoreSignal } from "@/lib/indicators";
import { cn } from "@/lib/utils";

interface Msg { role: "user" | "assistant"; content: string }

interface Props {
  symbol: string;
  interval: string;
  closes: number[];
}

const QUICK_PROMPTS = [
  "What's the current setup?",
  "Should I buy now or wait for a pullback?",
  "Where would you set the stop and targets?",
  "Is this overextended?",
];

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
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trade-assistant`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: next, context }),
      });

      if (!resp.ok || !resp.body) {
        if (resp.status === 429) throw new Error("Rate limit hit. Wait a moment and try again.");
        if (resp.status === 402) throw new Error("AI credits exhausted. Add credits in workspace settings.");
        throw new Error(`Request failed (${resp.status})`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let acc = "";
      let streamDone = false;

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, nl);
          textBuffer = textBuffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") { streamDone = true; break; }
          try {
            const parsed = JSON.parse(jsonStr);
            const c = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (c) {
              acc += c;
              setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: acc } : m)));
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }
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
              Ask me anything about <span className="text-foreground">{symbol.replace("USDT", "/USDT")}</span>.
              I see live price, RSI, MACD and EMAs.
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
            <div key={i} className={cn("flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
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
          {loading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> thinking…
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
          placeholder={`Ask about ${symbol.replace("USDT", "")}…`}
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
