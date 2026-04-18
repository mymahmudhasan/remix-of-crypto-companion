import { useEffect, useMemo, useState } from "react";
import { Flame, Loader2, RefreshCw } from "lucide-react";
import { formatPrice, formatCompact } from "@/lib/binance";
import { cn } from "@/lib/utils";

interface DepthLevel { price: number; qty: number; notional: number; }
interface DepthData {
  mid: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
  bidNotional: number;
  askNotional: number;
  imbalance: number; // -1..+1, +1 = full bid dominance
  topBidWalls: DepthLevel[];
  topAskWalls: DepthLevel[];
}

const PCT_RANGE = 0.02; // ±2% around mid

async function fetchDepth(symbol: string, market: "spot" | "futures"): Promise<DepthData> {
  const base = market === "futures"
    ? "https://fapi.binance.com/fapi/v1/depth"
    : "https://api.binance.com/api/v3/depth";
  const res = await fetch(`${base}?symbol=${symbol}&limit=500`);
  if (!res.ok) throw new Error(`depth ${res.status}`);
  const j = await res.json();
  const rawBids = (j.bids as [string, string][]).map(([p, q]) => ({ price: +p, qty: +q }));
  const rawAsks = (j.asks as [string, string][]).map(([p, q]) => ({ price: +p, qty: +q }));
  const bestBid = rawBids[0]?.price ?? 0;
  const bestAsk = rawAsks[0]?.price ?? 0;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
  const lo = mid * (1 - PCT_RANGE);
  const hi = mid * (1 + PCT_RANGE);
  const bids = rawBids
    .filter((l) => l.price >= lo)
    .map((l) => ({ ...l, notional: l.price * l.qty }));
  const asks = rawAsks
    .filter((l) => l.price <= hi)
    .map((l) => ({ ...l, notional: l.price * l.qty }));
  const bidNotional = bids.reduce((s, l) => s + l.notional, 0);
  const askNotional = asks.reduce((s, l) => s + l.notional, 0);
  const total = bidNotional + askNotional;
  const imbalance = total > 0 ? (bidNotional - askNotional) / total : 0;
  const topBidWalls = [...bids].sort((a, b) => b.notional - a.notional).slice(0, 5);
  const topAskWalls = [...asks].sort((a, b) => b.notional - a.notional).slice(0, 5);
  return { mid, bids, asks, bidNotional, askNotional, imbalance, topBidWalls, topAskWalls };
}

interface BinProps { price: number; notional: number; max: number; side: "bid" | "ask"; isWall: boolean; mid: number; }
function Bin({ price, notional, max, side, isWall, mid }: BinProps) {
  const pct = max > 0 ? (notional / max) * 100 : 0;
  const distPct = ((price - mid) / mid) * 100;
  return (
    <div className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums">
      <span className="w-14 shrink-0 text-right text-muted-foreground">${formatPrice(price)}</span>
      <span className={cn("w-10 shrink-0 text-right", side === "bid" ? "text-bull/70" : "text-bear/70")}>
        {distPct >= 0 ? "+" : ""}{distPct.toFixed(2)}%
      </span>
      <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-surface-elevated">
        <div
          className={cn(
            "h-full transition-all",
            side === "bid" ? "bg-bull/40" : "bg-bear/40",
            isWall && (side === "bid" ? "bg-bull/80" : "bg-bear/80"),
          )}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <span className={cn("w-14 shrink-0 text-right", isWall ? "font-bold text-foreground" : "text-muted-foreground")}>
        ${formatCompact(notional)}
      </span>
    </div>
  );
}

export function LiquidityHeatmap({
  symbol,
  market = "spot",
  refreshMs = 15000,
}: {
  symbol: string;
  market?: "spot" | "futures";
  refreshMs?: number;
}) {
  const [data, setData] = useState<DepthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDepth(symbol, market)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, market, tick]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), refreshMs);
    return () => window.clearInterval(id);
  }, [refreshMs]);

  const view = useMemo(() => {
    if (!data) return null;
    // bucket bids/asks into ~12 price bins per side for visual density
    const bin = (levels: DepthLevel[], side: "bid" | "ask") => {
      if (!levels.length) return [];
      const sorted = side === "bid"
        ? [...levels].sort((a, b) => b.price - a.price)
        : [...levels].sort((a, b) => a.price - b.price);
      const N = 12;
      const step = data.mid * PCT_RANGE / N;
      const buckets: DepthLevel[] = [];
      for (let i = 0; i < N; i++) {
        const edgeNear = side === "bid" ? data.mid - i * step : data.mid + i * step;
        const edgeFar = side === "bid" ? data.mid - (i + 1) * step : data.mid + (i + 1) * step;
        const lo = Math.min(edgeNear, edgeFar);
        const hi = Math.max(edgeNear, edgeFar);
        const inBucket = sorted.filter((l) => l.price >= lo && l.price < hi);
        if (!inBucket.length) continue;
        const notional = inBucket.reduce((s, l) => s + l.notional, 0);
        const qty = inBucket.reduce((s, l) => s + l.qty, 0);
        const price = (lo + hi) / 2;
        buckets.push({ price, qty, notional });
      }
      return buckets;
    };
    const bidBins = bin(data.bids, "bid");
    const askBins = bin(data.asks, "ask");
    const max = Math.max(
      ...bidBins.map((b) => b.notional),
      ...askBins.map((b) => b.notional),
      1,
    );
    const wallSet = new Set([
      ...data.topBidWalls.slice(0, 3).map((w) => w.price),
      ...data.topAskWalls.slice(0, 3).map((w) => w.price),
    ]);
    const isWall = (p: number, side: "bid" | "ask") => {
      const walls = side === "bid" ? data.topBidWalls.slice(0, 3) : data.topAskWalls.slice(0, 3);
      return walls.some((w) => Math.abs(w.price - p) <= data.mid * (PCT_RANGE / 12) / 2);
    };
    return { bidBins, askBins, max, isWall, wallSet };
  }, [data]);

  return (
    <div className="panel flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Flame className="size-3.5 text-warning" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Liquidity Heatmap · ±2%
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className="font-mono text-[10px] text-muted-foreground">
              imbalance{" "}
              <span className={cn("font-bold", data.imbalance > 0.1 ? "text-bull" : data.imbalance < -0.1 ? "text-bear" : "text-muted-foreground")}>
                {(data.imbalance * 100).toFixed(0)}%
              </span>
            </span>
          )}
          <button
            onClick={() => setTick((t) => t + 1)}
            className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            title="Refresh"
          >
            {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto scrollbar-thin p-2">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 font-mono text-[11px] text-destructive">
            Depth unavailable: {error}
          </div>
        )}
        {!data && !error && (
          <div className="flex flex-1 items-center justify-center font-mono text-[11px] text-muted-foreground">
            <Loader2 className="mr-2 size-3 animate-spin" /> Loading depth…
          </div>
        )}
        {data && view && (
          <>
            {/* Asks (resistance, sells above) — descending so highest price on top */}
            <div className="flex flex-col gap-0.5">
              {[...view.askBins].reverse().map((b) => (
                <Bin key={`a-${b.price}`} price={b.price} notional={b.notional} max={view.max} side="ask" isWall={view.isWall(b.price, "ask")} mid={data.mid} />
              ))}
            </div>

            {/* Mid price marker */}
            <div className="my-1 flex items-center gap-2 rounded-sm border border-primary/40 bg-primary/10 px-2 py-1">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-primary">Mid</span>
              <span className="font-mono text-xs font-bold tabular-nums text-foreground">${formatPrice(data.mid)}</span>
              <div className="ml-auto flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                <span>bids <span className="font-bold text-bull">${formatCompact(data.bidNotional)}</span></span>
                <span>asks <span className="font-bold text-bear">${formatCompact(data.askNotional)}</span></span>
              </div>
            </div>

            {/* Bids (support, buys below) — descending so highest price (closest to mid) on top */}
            <div className="flex flex-col gap-0.5">
              {view.bidBins.map((b) => (
                <Bin key={`b-${b.price}`} price={b.price} notional={b.notional} max={view.max} side="bid" isWall={view.isWall(b.price, "bid")} mid={data.mid} />
              ))}
            </div>

            {/* Top walls summary */}
            <div className="mt-1 grid grid-cols-2 gap-2">
              <div className="rounded-md border border-bull/30 bg-bull/5 p-2">
                <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wider text-bull">Top Bid Walls</div>
                <div className="flex flex-col gap-0.5 font-mono text-[10px]">
                  {data.topBidWalls.slice(0, 3).map((w) => (
                    <div key={w.price} className="flex justify-between">
                      <span className="text-foreground/80">${formatPrice(w.price)}</span>
                      <span className="font-bold text-bull">${formatCompact(w.notional)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-bear/30 bg-bear/5 p-2">
                <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wider text-bear">Top Ask Walls</div>
                <div className="flex flex-col gap-0.5 font-mono text-[10px]">
                  {data.topAskWalls.slice(0, 3).map((w) => (
                    <div key={w.price} className="flex justify-between">
                      <span className="text-foreground/80">${formatPrice(w.price)}</span>
                      <span className="font-bold text-bear">${formatCompact(w.notional)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
