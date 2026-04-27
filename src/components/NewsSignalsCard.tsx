// News Signals Card — dashboard widget showing trade signals derived from news.
// Sources:
//   - "manual" signals pinned by the user from the News tab modal.
//   - "auto" signals: a background scanner that picks recent high-impact headlines,
//     pulls chart context, and asks the AI for a structured plan via news-plan fn.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Newspaper, TrendingUp, TrendingDown, Minus, X, ExternalLink, Loader2, RefreshCw, Sparkles, Pin } from "lucide-react";
import { fetchNews, buildNewsPlan, baseToPair, timeAgo, type NewsItem } from "@/lib/news";
import { fetchKlines, formatPrice } from "@/lib/binance";
import { snapshotFromCandles } from "@/lib/indicators";
import {
  listNewsSignals, addNewsSignal, removeNewsSignal, onNewsSignalsChanged,
  buildSignalId, hasNewsSignal, type NewsSignal,
} from "@/lib/news-signals";
import { cn } from "@/lib/utils";

interface Props {
  onSelect?: (symbol: string) => void;
}

const AUTO_SCAN_INTERVAL_MS = 5 * 60_000;
const MAX_AUTO_PER_SCAN = 2;

export function NewsSignalsCard({ onSelect }: Props) {
  const [signals, setSignals] = useState<NewsSignal[]>(() => listNewsSignals());
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<number | null>(null);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const scanLockRef = useRef(false);

  useEffect(() => {
    const off = onNewsSignalsChanged(() => setSignals(listNewsSignals()));
    return off;
  }, []);

  const runScan = async () => {
    if (scanLockRef.current) return;
    scanLockRef.current = true;
    setScanning(true); setScanErr(null);
    try {
      const news = await fetchNews({ limit: 60 });
      // Pick recent (<6h) opinionated headlines we haven't auto-pinned yet.
      const candidates = news
        .filter((n) =>
          n.symbols.length > 0 &&
          n.sentiment !== "neutral" &&
          Date.now() - n.publishedAt < 6 * 3600_000 &&
          Math.abs(n.sentimentScore) >= 2,
        )
        .filter((n) => !hasNewsSignal(buildSignalId(baseToPair(n.symbols[0]), n.url, "auto")))
        .sort((a, b) => Math.abs(b.sentimentScore) - Math.abs(a.sentimentScore))
        .slice(0, MAX_AUTO_PER_SCAN);

      for (const n of candidates) {
        try {
          const symbol = baseToPair(n.symbols[0]);
          const candles = await fetchKlines(symbol, "1h", 220);
          if (!candles || candles.length < 50) continue;
          const snap = snapshotFromCandles(candles);
          const plan = await buildNewsPlan({
            symbol, mode: "futures", interval: "1h",
            news: {
              title: n.title, summary: n.summary, source: n.source,
              sentiment: n.sentiment, publishedAt: n.publishedAt,
            },
            snapshot: {
              price: snap.price, rsi14: snap.rsi14,
              ema20: snap.ema20, ema50: snap.ema50, ema200: snap.ema200,
              atr14: snap.atr14, recentHigh: snap.recentHigh, recentLow: snap.recentLow,
            },
          });
          // Only pin high-conviction GO/WAIT signals.
          if (plan.confidence >= 55 && plan.verdict !== "SKIP") {
            addNewsSignal({
              symbol, base: n.symbols[0], mode: "futures", interval: "1h",
              source: "auto",
              news: {
                title: n.title, source: n.source, url: n.url,
                publishedAt: n.publishedAt, sentiment: n.sentiment,
              },
              plan,
            });
          }
        } catch (e) {
          // continue scanning other items
          console.warn("[news-signals] auto-plan failed", e);
        }
      }
      setLastScan(Date.now());
    } catch (e: any) {
      setScanErr(e?.message ?? "Scan failed");
    } finally {
      setScanning(false);
      scanLockRef.current = false;
    }
  };

  // initial + periodic background scan
  useEffect(() => {
    const t = setTimeout(runScan, 4_000); // delay slightly to avoid blocking initial render
    const i = setInterval(runScan, AUTO_SCAN_INTERVAL_MS);
    return () => { clearTimeout(t); clearInterval(i); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const manual = signals.filter((s) => s.source === "manual");
    const auto = signals.filter((s) => s.source === "auto");
    return { manual, auto };
  }, [signals]);

  return (
    <div className="panel flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Newspaper className="size-3.5 text-primary" />
          <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-foreground">
            News Signals
          </h3>
          <span className="font-mono text-[9px] uppercase text-muted-foreground">
            · {signals.length} active
          </span>
        </div>
        <div className="flex items-center gap-2">
          {lastScan && !scanning && (
            <span className="font-mono text-[9px] uppercase text-muted-foreground">
              scan {timeAgo(lastScan)}
            </span>
          )}
          <button
            onClick={runScan}
            disabled={scanning}
            className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
          >
            <RefreshCw className={cn("size-2.5", scanning && "animate-spin")} />
            {scanning ? "Scanning" : "Scan"}
          </button>
          <Link
            to="/news"
            className="font-mono text-[9px] uppercase text-primary hover:underline"
          >
            News tab →
          </Link>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {scanErr && (
          <div className="m-2 rounded border border-destructive/30 bg-destructive/10 p-2 font-mono text-[10px] text-destructive">
            ⚠ {scanErr}
          </div>
        )}

        {signals.length === 0 && !scanning && (
          <EmptyState />
        )}

        {signals.length === 0 && scanning && (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            <span className="font-mono text-[10px] uppercase">Scanning headlines for signals…</span>
          </div>
        )}

        {grouped.auto.length > 0 && (
          <Section title="Auto-detected" icon={<Sparkles className="size-2.5" />}>
            {grouped.auto.map((s) => (
              <SignalRow key={s.id} signal={s} onSelect={onSelect} />
            ))}
          </Section>
        )}
        {grouped.manual.length > 0 && (
          <Section title="Pinned from News" icon={<Pin className="size-2.5" />}>
            {grouped.manual.map((s) => (
              <SignalRow key={s.id} signal={s} onSelect={onSelect} />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <Newspaper className="size-6 text-muted-foreground/60" />
      <div className="font-mono text-[11px] uppercase text-muted-foreground">No news signals yet</div>
      <p className="max-w-[280px] text-[11px] text-muted-foreground">
        High-impact headlines will appear here automatically. Or open the{" "}
        <Link to="/news" className="text-primary hover:underline">News tab</Link>{" "}
        and pin a plan to the dashboard.
      </p>
    </div>
  );
}

function Section({
  title, icon, children,
}: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1 border-b border-border bg-surface/40 px-3 py-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        {icon} {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SignalRow({ signal, onSelect }: { signal: NewsSignal; onSelect?: (s: string) => void }) {
  const { plan } = signal;
  const Bias = plan.bias === "long" ? TrendingUp : plan.bias === "short" ? TrendingDown : Minus;
  const tone = plan.bias === "long" ? "text-bull" : plan.bias === "short" ? "text-bear" : "text-muted-foreground";
  const verdictClass =
    plan.verdict === "GO" ? "bg-bull text-background"
    : plan.verdict === "WAIT" ? "bg-warning text-background"
    : "bg-bear text-background";
  const sourceTone = signal.source === "auto" ? "border-primary/40 text-primary" : "border-warning/40 text-warning";

  return (
    <div className="group border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/40">
      <div className="flex items-center gap-2">
        <button
          onClick={() => onSelect?.(signal.symbol)}
          className="font-mono text-xs font-bold text-foreground hover:text-primary"
        >
          {signal.symbol}
        </button>
        <span className={cn("rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase", verdictClass)}>
          {plan.verdict}
        </span>
        <Bias className={cn("size-3", tone)} />
        <span className={cn("font-mono text-[9px] uppercase", tone)}>{plan.bias}</span>
        <span className="font-mono text-[9px] uppercase text-muted-foreground">
          · {plan.confidence}% · {plan.timeHorizon}
        </span>
        <span className={cn("ml-auto rounded border px-1 py-px font-mono text-[8px] uppercase", sourceTone)}>
          {signal.source === "auto" ? "AUTO" : "PINNED"}
        </span>
        <button
          onClick={() => removeNewsSignal(signal.id)}
          className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
          aria-label="Dismiss"
        >
          <X className="size-3" />
        </button>
      </div>

      <a
        href={signal.news.url} target="_blank" rel="noopener noreferrer"
        className="mt-1 line-clamp-2 block text-[11px] text-foreground hover:text-primary"
      >
        {signal.news.title}
      </a>

      <div className="mt-1 grid grid-cols-2 gap-1 font-mono text-[10px] sm:grid-cols-4">
        <Cell label="Entry" value={`${formatPrice(plan.levels.entryLow)}–${formatPrice(plan.levels.entryHigh)}`} />
        <Cell label="Stop" value={formatPrice(plan.levels.stop)} tone="bear" />
        <Cell label="TP1" value={formatPrice(plan.levels.targets[0])} tone="bull" />
        <Cell
          label={plan.levels.leverage ? "Lev" : "Risk"}
          value={plan.levels.leverage ? `${plan.levels.leverage}x` : `${plan.levels.riskPct}%`}
        />
      </div>

      <div className="mt-1 flex items-center gap-2 font-mono text-[9px] uppercase text-muted-foreground">
        <span>{signal.news.source}</span>
        <span>·</span>
        <span>{timeAgo(signal.news.publishedAt)}</span>
        <a
          href={signal.news.url} target="_blank" rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1 hover:text-foreground"
        >
          <ExternalLink className="size-2.5" /> Open
        </a>
      </div>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="rounded border border-border bg-card/60 px-1.5 py-1">
      <div className="text-[8px] uppercase text-muted-foreground">{label}</div>
      <div className={cn(
        "mt-px text-foreground",
        tone === "bull" && "text-bull",
        tone === "bear" && "text-bear",
      )}>{value}</div>
    </div>
  );
}
