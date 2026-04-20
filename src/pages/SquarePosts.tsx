import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles, RefreshCw, Loader2, AlertCircle, Copy, Check, Download, Wand2, Image as ImageIcon, Hash, TrendingUp, TrendingDown, Send, CheckCircle2,
} from "lucide-react";
import { fetchPremiumSignals, type PremiumSignal } from "@/lib/premium-signals";
import { generateSquarePost, publishSquarePost, type SquarePost } from "@/lib/square-posts";
import { loadSquareSettings } from "@/lib/square-settings";
import { snapshotChart } from "@/lib/snapshot-chart";
import { MiniSetupChart } from "@/components/MiniSetupChart";
import { SquareConnectionPanel } from "@/components/SquareConnectionPanel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface QueueItem {
  signal: PremiumSignal;
  post: SquarePost | null;
  imageDataUrl: string | null;
  loading: boolean;
  error: string | null;
  publishing?: boolean;
  published?: boolean;
  publishError?: string | null;
}

export default function SquarePosts() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loadingSignals, setLoadingSignals] = useState(false);
  const [signalsError, setSignalsError] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);

  const loadSignals = async () => {
    setLoadingSignals(true);
    setSignalsError(null);
    try {
      const r = await fetchPremiumSignals();
      setItems(r.signals.map((s) => ({ signal: s, post: null, imageDataUrl: null, loading: false, error: null })));
    } catch (e: any) {
      setSignalsError(e.message || "Failed to load signals");
    } finally {
      setLoadingSignals(false);
    }
  };

  useEffect(() => {
    loadSignals();
  }, []);

  const updateItem = (idx: number, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  // Waits briefly for the chart snapshot to be captured for a given index.
  const waitForImage = async (idx: number, timeoutMs = 4000): Promise<string | null> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const img = await new Promise<string | null>((resolve) =>
        setItems((prev) => {
          resolve(prev[idx]?.imageDataUrl ?? null);
          return prev;
        }),
      );
      if (img) return img;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };

  const autoPublish = async (idx: number, post: SquarePost) => {
    let settings;
    try {
      settings = await loadSquareSettings();
    } catch {
      return;
    }
    if (!settings.endpoint_url || !settings.api_key || !settings.enabled) return;
    updateItem(idx, { publishing: true, publishError: null });
    const img = await waitForImage(idx);
    try {
      await publishSquarePost(post, img);
      updateItem(idx, { publishing: false, published: true, publishError: null });
      toast.success("Posted to Binance Square", { description: post.symbol });
    } catch (e: any) {
      updateItem(idx, { publishing: false, published: false, publishError: e.message || "Publish failed" });
      toast.error("Auto-post failed", { description: e.message });
    }
  };

  const generateOne = async (idx: number) => {
    const item = items[idx];
    if (!item) return;
    updateItem(idx, { loading: true, error: null, published: false, publishError: null });
    try {
      const post = await generateSquarePost(item.signal);
      updateItem(idx, { post, loading: false });
      await autoPublish(idx, post);
    } catch (e: any) {
      updateItem(idx, { loading: false, error: e.message || "Failed" });
      toast.error("Generation failed", { description: e.message });
    }
  };

  const generateAll = async () => {
    setBatchRunning(true);
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].post) continue;
      try {
        const post = await generateSquarePost(items[i].signal);
        setItems((prev) => prev.map((it, j) => (j === i ? { ...it, post, loading: false, error: null } : it)));
        ok++;
        await autoPublish(i, post);
        await new Promise((r) => setTimeout(r, 800));
      } catch (e: any) {
        setItems((prev) =>
          prev.map((it, j) => (j === i ? { ...it, error: e.message || "Failed", loading: false } : it))
        );
        fail++;
        if (e.message?.includes("Rate limit") || e.message?.includes("credits")) break;
      }
    }
    setBatchRunning(false);
    if (ok) toast.success(`${ok} post${ok > 1 ? "s" : ""} generated${fail ? ` · ${fail} failed` : ""}`);
  };

  const stats = useMemo(() => {
    const ready = items.filter((i) => i.post).length;
    return { total: items.length, ready };
  }, [items]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface/40 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md border border-primary/40 bg-primary/10 glow-bull">
            <Wand2 className="size-4 text-primary" />
          </div>
          <div className="leading-tight">
            <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-foreground neon-text">
              Binance Square · Post Queue
            </h2>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {stats.ready}/{stats.total} ready · 200+ words · 5 hashtags · chart image · copy & paste to Binance
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase">
          <button
            onClick={loadSignals}
            disabled={loadingSignals}
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-[11px] font-bold text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-60"
          >
            {loadingSignals ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            Reload signals
          </button>
          <button
            onClick={generateAll}
            disabled={batchRunning || !items.length}
            className="flex items-center gap-1.5 rounded-md border border-primary/50 bg-primary/10 px-3 py-1.5 text-[11px] font-bold text-primary transition-all hover:bg-primary/20 disabled:opacity-60"
          >
            {batchRunning ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
            {batchRunning ? "Generating…" : "Generate all"}
          </button>
        </div>
      </div>

      {/* Connection */}
      <SquareConnectionPanel />

      {/* Notice */}
      <div className="shrink-0 border-b border-border bg-amber-500/5 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-amber-400/90">
        ℹ️ Binance Square has no public posting API. Generate a post → copy text + download image → paste into the Binance app.
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
        {signalsError && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-bold">Could not load signals</div>
              <div className="text-destructive/80">{signalsError}</div>
            </div>
          </div>
        )}

        {loadingSignals && !items.length && (
          <div className="flex h-full flex-col items-center justify-center gap-3 font-mono text-xs text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-primary" />
            <div>Loading premium signals…</div>
          </div>
        )}

        {items.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-2">
            {items.map((it, i) => (
              <PostCard
                key={`${it.signal.symbol}-${i}`}
                item={it}
                onGenerate={() => generateOne(i)}
                onImageReady={(dataUrl) => updateItem(i, { imageDataUrl: dataUrl })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PostCard({
  item,
  onGenerate,
  onImageReady,
}: {
  item: QueueItem;
  onGenerate: () => void;
  onImageReady: (dataUrl: string) => void;
}) {
  const { signal, post, loading, error, imageDataUrl } = item;
  const isLong = signal.side === "long";
  const chartRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [snapTried, setSnapTried] = useState(false);

  // Auto-snapshot chart once it has rendered
  useEffect(() => {
    if (imageDataUrl || snapTried) return;
    const t = window.setTimeout(async () => {
      const dataUrl = await snapshotChart(chartRef.current);
      if (dataUrl) onImageReady(dataUrl);
      setSnapTried(true);
    }, 1400);
    return () => window.clearTimeout(t);
  }, [imageDataUrl, snapTried, onImageReady]);

  const fullText = post ? post.post : "";

  const copy = async () => {
    if (!fullText) return;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      toast.success("Post copied", { description: "Paste it into Binance Square" });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Copy failed");
    }
  };

  const downloadImage = () => {
    if (!imageDataUrl) {
      toast.error("Image not ready yet");
      return;
    }
    const a = document.createElement("a");
    a.href = imageDataUrl;
    a.download = `${signal.symbol}-${signal.side}.png`;
    a.click();
  };

  return (
    <div className="panel flex flex-col gap-2.5 p-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex size-8 items-center justify-center rounded-md border",
              isLong ? "border-bull/50 bg-bull/10 text-bull" : "border-bear/50 bg-bear/10 text-bear"
            )}
          >
            {isLong ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-1.5 font-mono text-sm font-bold text-foreground">
              {signal.symbol.replace("USDT", "/USDT")}
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase",
                  isLong ? "bg-bull/20 text-bull" : "bg-bear/20 text-bear"
                )}
              >
                {signal.side}
              </span>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {signal.setup_name} · conviction {signal.conviction}
            </div>
          </div>
        </div>
        <button
          onClick={onGenerate}
          disabled={loading}
          className="flex items-center gap-1.5 rounded border border-primary/50 bg-primary/10 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-primary transition-all hover:bg-primary/20 disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-3 animate-spin" /> : post ? <RefreshCw className="size-3" /> : <Sparkles className="size-3" />}
          {loading ? "Writing…" : post ? "Regen" : "Generate"}
        </button>
      </div>

      {/* Chart (used as image source) */}
      <div ref={chartRef}>
        <MiniSetupChart
          symbol={signal.symbol}
          entryLow={signal.entry_low}
          entryHigh={signal.entry_high}
          stop={signal.stop}
          targets={signal.targets}
        />
      </div>

      {/* Post output */}
      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 font-mono text-[10px] text-destructive">
          {error}
        </div>
      )}

      {!post && !loading && !error && (
        <div className="rounded border border-dashed border-border bg-surface/30 p-3 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Click <span className="text-primary">Generate</span> to write a 200+ word Binance Square post
        </div>
      )}

      {post && (
        <>
          <div className="max-h-48 overflow-y-auto rounded border border-border bg-surface/40 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/90 whitespace-pre-wrap scrollbar-thin">
            {post.post}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1">
                <Hash className="size-2.5" /> {post.hashtags.length}
              </span>
              <span>·</span>
              <span>{post.wordCount} words</span>
              <span>·</span>
              <span className="text-primary">{post.coinTag}</span>
            </div>
            {post.hashtags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {post.hashtags.map((h) => (
                  <span key={h} className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
                    {h}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={copy}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded border py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all",
                copied
                  ? "border-bull bg-bull/10 text-bull"
                  : "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
              )}
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? "Copied" : "Copy text"}
            </button>
            <button
              onClick={downloadImage}
              disabled={!imageDataUrl}
              className="flex flex-1 items-center justify-center gap-1.5 rounded border border-border bg-surface-elevated py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
            >
              {imageDataUrl ? <Download className="size-3" /> : <ImageIcon className="size-3 animate-pulse" />}
              {imageDataUrl ? "Image" : "Rendering…"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
