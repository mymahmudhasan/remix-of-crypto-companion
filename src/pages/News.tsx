import { useEffect, useMemo, useState } from "react";
import { Loader2, Newspaper, RefreshCw, Search, Filter, AlertCircle } from "lucide-react";
import { fetchNews, baseToPair, type NewsItem } from "@/lib/news";
import { NewsRow } from "@/components/NewsPanel";
import { NewsPlanModal } from "@/components/NewsPlanModal";
import { cn } from "@/lib/utils";

type SentimentFilter = "all" | "bullish" | "bearish" | "neutral";

export default function News() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sentiment, setSentiment] = useState<SentimentFilter>("all");
  const [source, setSource] = useState<string>("all");
  const [symbol, setSymbol] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [planFor, setPlanFor] = useState<NewsItem | null>(null);
  const [planMode, setPlanMode] = useState<"spot" | "futures">("futures");

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const it = await fetchNews({ limit: 100 });
      setItems(it);
    } catch (e: any) {
      setErr(e.message || "Failed to load news");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60_000); // refresh every 5min
    return () => clearInterval(t);
  }, []);

  const sources = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => set.add(i.source));
    return ["all", ...[...set].sort()];
  }, [items]);

  const symbols = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((i) => i.symbols.forEach((s) => counts.set(s, (counts.get(s) ?? 0) + 1)));
    return ["all", ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s)];
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (sentiment !== "all" && it.sentiment !== sentiment) return false;
      if (source !== "all" && it.source !== source) return false;
      if (symbol !== "all" && !it.symbols.includes(symbol)) return false;
      if (q && !`${it.title} ${it.summary}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, sentiment, source, symbol, search]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const bull = filtered.filter((i) => i.sentiment === "bullish").length;
    const bear = filtered.filter((i) => i.sentiment === "bearish").length;
    return { total, bull, bear, neutral: total - bull - bear };
  }, [filtered]);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Newspaper className="size-4 text-primary" />
          <h1 className="font-mono text-sm font-bold uppercase tracking-wider text-foreground">News Feed</h1>
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            · {stats.total} items · <span className="text-bull">{stats.bull} bull</span> · <span className="text-bear">{stats.bear} bear</span> · {stats.neutral} neutral
          </span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 font-mono text-[10px] uppercase text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface/20 px-4 py-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search headlines…"
            className="w-full rounded border border-border bg-card/60 py-1 pl-7 pr-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>
        <Pill label="Sentiment">
          {(["all", "bullish", "bearish", "neutral"] as SentimentFilter[]).map((s) => (
            <Toggle key={s} active={sentiment === s} onClick={() => setSentiment(s)}>{s}</Toggle>
          ))}
        </Pill>
        <Pill label="Source">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="rounded border border-border bg-card/60 px-2 py-0.5 font-mono text-[10px] uppercase text-foreground focus:border-primary focus:outline-none"
          >
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Pill>
        <Pill label="Token">
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="max-w-[120px] rounded border border-border bg-card/60 px-2 py-0.5 font-mono text-[10px] uppercase text-foreground focus:border-primary focus:outline-none"
          >
            {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Pill>
        <Pill label="Plan as">
          {(["spot", "futures"] as const).map((m) => (
            <Toggle key={m} active={planMode === m} onClick={() => setPlanMode(m)}>{m}</Toggle>
          ))}
        </Pill>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {loading && items.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span className="font-mono text-xs uppercase">Loading news from 5 crypto outlets…</span>
          </div>
        )}
        {err && (
          <div className="m-4 flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="mt-px size-4 shrink-0" /> {err}
          </div>
        )}
        {!loading && filtered.length === 0 && !err && (
          <div className="px-4 py-16 text-center font-mono text-xs text-muted-foreground">
            No headlines match your filters.
          </div>
        )}
        <div>
          {filtered.map((it) => (
            <NewsRow key={it.id} item={it} onPlan={() => setPlanFor(it)} />
          ))}
        </div>
      </div>

      {planFor && planFor.symbols[0] && (
        <NewsPlanModal
          open={!!planFor}
          onClose={() => setPlanFor(null)}
          news={planFor}
          symbol={baseToPair(planFor.symbols[0])}
          mode={planMode}
        />
      )}
    </div>
  );
}

function Pill({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 rounded border border-border bg-card/40 px-2 py-1">
      <Filter className="size-2.5 text-muted-foreground" />
      <span className="font-mono text-[9px] uppercase text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded px-1.5 py-0.5 font-mono text-[10px] uppercase",
        active ? "bg-primary text-background" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
