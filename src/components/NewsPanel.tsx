import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Newspaper, TrendingUp, TrendingDown, Minus, Loader2, ExternalLink, Sparkles, Crosshair } from "lucide-react";
import { fetchNews, timeAgo, type NewsItem } from "@/lib/news";
import { NewsPlanModal } from "@/components/NewsPlanModal";
import { cn } from "@/lib/utils";

interface Props {
  symbol: string; // e.g. "BTCUSDT"
  mode: "spot" | "futures";
  interval?: string;
}

/** Compact news strip for a single symbol, designed for the Smart Money sidebar. */
export function NewsPanel({ symbol, mode, interval = "1h" }: Props) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [planFor, setPlanFor] = useState<NewsItem | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null);
    fetchNews({ symbol, limit: 20 })
      .then((it) => { if (alive) setItems(it); })
      .catch((e) => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol]);

  return (
    <>
      <div className="rounded-md border border-border bg-card/40">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <Newspaper className="size-3" /> News · {symbol.replace(/USDT$/, "")}
          </div>
          <Link to="/news" className="font-mono text-[9px] uppercase text-primary hover:underline">All news →</Link>
        </div>

        <div className="max-h-[260px] overflow-y-auto scrollbar-thin">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              <span className="font-mono text-[10px] uppercase">Loading news…</span>
            </div>
          )}
          {err && <div className="px-3 py-3 font-mono text-[10px] text-destructive">⚠ {err}</div>}
          {!loading && !err && items.length === 0 && (
            <div className="px-3 py-6 text-center font-mono text-[10px] text-muted-foreground">
              No recent news for this token. Check the <Link to="/news" className="text-primary hover:underline">News tab</Link>.
            </div>
          )}
          {items.map((it) => (
            <NewsRow key={it.id} item={it} compact onPlan={() => setPlanFor(it)} />
          ))}
        </div>
      </div>

      {planFor && (
        <NewsPlanModal
          open={!!planFor}
          onClose={() => setPlanFor(null)}
          news={planFor}
          symbol={symbol}
          mode={mode}
          interval={interval}
        />
      )}
    </>
  );
}

interface RowProps {
  item: NewsItem;
  compact?: boolean;
  onPlan: () => void;
}

export function NewsRow({ item, compact, onPlan }: RowProps) {
  const Icon = item.sentiment === "bullish" ? TrendingUp : item.sentiment === "bearish" ? TrendingDown : Minus;
  const tone = item.sentiment === "bullish" ? "text-bull" : item.sentiment === "bearish" ? "text-bear" : "text-muted-foreground";
  const border = item.sentiment === "bullish" ? "border-l-bull" : item.sentiment === "bearish" ? "border-l-bear" : "border-l-border";
  const primarySymbol = item.symbols[0];
  const coachHref = primarySymbol ? `/smart-money?symbol=${primarySymbol}USDT` : null;

  return (
    <div className={cn("group border-b border-border border-l-2 px-3 py-2 last:border-b-0 hover:bg-muted/40", border)}>
      <div className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 size-3 shrink-0", tone)} />
        <div className="min-w-0 flex-1">
          <a
            href={item.url} target="_blank" rel="noopener noreferrer"
            className="line-clamp-2 text-xs font-medium text-foreground hover:text-primary"
          >
            {item.title}
          </a>
          {!compact && item.summary && (
            <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{item.summary}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[9px] uppercase text-muted-foreground">
            <span>{item.source}</span>
            <span>·</span>
            <span>{timeAgo(item.publishedAt)}</span>
            <span className={cn("rounded border px-1 py-px text-[8px]", tone, item.sentiment === "bullish" ? "border-bull/40 bg-bull/10" : item.sentiment === "bearish" ? "border-bear/40 bg-bear/10" : "border-border")}>
              {item.sentiment} {item.sentimentScore > 0 ? `+${item.sentimentScore}` : item.sentimentScore}
            </span>
            {item.symbols.slice(0, compact ? 2 : 5).map((s) => (
              <span key={s} className="rounded border border-primary/40 bg-primary/10 px-1 py-px text-[8px] text-primary">{s}</span>
            ))}
            {item.symbols.length > (compact ? 2 : 5) && (
              <span className="text-[8px] text-muted-foreground">+{item.symbols.length - (compact ? 2 : 5)}</span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 opacity-80 group-hover:opacity-100">
            {coachHref && (
              <Link
                to={coachHref}
                className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Crosshair className="size-2.5" /> Coach {primarySymbol}
              </Link>
            )}
            {primarySymbol && (
              <button
                onClick={onPlan}
                className="flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-primary hover:bg-primary/20"
              >
                <Sparkles className="size-2.5" /> News plan
              </button>
            )}
            <a
              href={item.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-2.5" /> Open
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
