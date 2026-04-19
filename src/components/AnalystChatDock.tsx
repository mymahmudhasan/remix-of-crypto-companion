import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Loader2, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "cryptodesk.analystChat.history";
const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyst-chat`;

const STARTER: Msg = {
  role: "assistant",
  content:
    "Hey — I'm your **desk analyst**. Ask me about any pair (BTC, ETH, SOL, alts), a setup you're seeing, or paste levels and I'll size up bias / entry / SL / targets.\n\n_Educational only — not financial advice._",
};

export function AnalystChatDock() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as Msg[];
    } catch {}
    return [STARTER];
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40))); } catch {}
  }, [messages]);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open, streaming]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const userMsg: Msg = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setStreaming(true);

    // Capture page context (route + visible heading) so analyst can reason about what user is on.
    const ctx = `Route: ${window.location.pathname}\nPage title: ${document.title}`;

    const controller = new AbortController();
    abortRef.current = controller;
    let assistantSoFar = "";
    const upsert = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last !== STARTER && prev.length > next.length) {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: next.filter((m) => m !== STARTER).map((m) => ({ role: m.role, content: m.content })),
          context: ctx,
        }),
        signal: controller.signal,
      });

      if (resp.status === 429) { upsert("⚠ Rate limit hit on the desk. Try again in a minute."); return; }
      if (resp.status === 402) { upsert("⚠ AI credits exhausted. Top up in Settings → Workspace → Usage."); return; }
      if (!resp.ok || !resp.body) { upsert("⚠ Couldn't reach analyst. Try again."); return; }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        if (d) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") { done = true; break; }
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (delta) upsert(delta);
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") upsert("⚠ Connection dropped. Try again.");
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setMessages([STARTER]);
  };

  return (
    <>
      {/* Floating launcher */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-primary/50 bg-surface px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-primary shadow-lg shadow-primary/20 transition-all hover:bg-primary/10 hover:scale-105 glow-bull",
          open && "scale-95 opacity-0 pointer-events-none"
        )}
        aria-label="Open analyst chat"
      >
        <MessageCircle className="size-4" />
        <span>Ask Analyst</span>
        <Sparkles className="size-3 text-warning" />
      </button>

      {/* Chat panel */}
      <div
        className={cn(
          "fixed bottom-4 right-4 z-50 flex w-[min(92vw,420px)] flex-col rounded-lg border border-primary/40 bg-surface shadow-2xl shadow-primary/10 transition-all",
          open ? "h-[min(75vh,600px)] opacity-100" : "h-0 opacity-0 pointer-events-none"
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="size-2 rounded-full bg-bull animate-pulse" />
              <div className="absolute inset-0 size-2 rounded-full bg-bull blur-sm" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-foreground">Desk Analyst</span>
              <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Online · AI-powered</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={reset}
              className="rounded px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              title="Clear conversation"
            >
              Reset
            </button>
            <button onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 scrollbar-thin">
          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[88%] rounded-lg px-3 py-2 text-sm",
                  m.role === "user"
                    ? "bg-primary/15 border border-primary/30 text-foreground"
                    : "bg-surface-hover/60 border border-border text-foreground"
                )}
              >
                {m.role === "assistant" ? (
                  <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-headings:mt-2 prose-headings:mb-1 prose-code:text-warning prose-strong:text-primary">
                    <ReactMarkdown>{m.content || "…"}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{m.content}</p>
                )}
              </div>
            </div>
          ))}
          {streaming && messages[messages.length - 1]?.role === "user" && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-hover/60 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Analyst is typing…
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="flex shrink-0 items-end gap-2 border-t border-border bg-surface/60 px-3 py-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder="Ask about a pair, paste levels, or describe a setup…"
            rows={1}
            className="min-h-[36px] max-h-32 flex-1 resize-none rounded-md border border-border bg-background px-2.5 py-2 font-mono text-sm placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none"
            disabled={streaming}
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/50 bg-primary/15 text-primary transition-colors hover:bg-primary/25 disabled:opacity-40"
            aria-label="Send"
          >
            {streaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </form>
      </div>
    </>
  );
}
