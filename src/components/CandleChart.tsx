import { useEffect, useRef, useState } from "react";
import { createChart, type IChartApi, type ISeriesApi, type CandlestickData, type HistogramData, ColorType } from "lightweight-charts";
import { Eye, EyeOff } from "lucide-react";
import { fetchKlines, subscribeKline, type Kline } from "@/lib/binance";
import { ema, bollinger, donchian } from "@/lib/indicators";
import { cn } from "@/lib/utils";

type BandMode = "bb" | "donchian" | "off";

export interface ChartMarker {
  /** Bar time in seconds (matches Kline.time). */
  time: number;
  position: "aboveBar" | "belowBar" | "inBar" | string;
  shape: "arrowUp" | "arrowDown" | "circle" | "square" | string;
  color: string;
  text?: string;
}

interface Props {
  symbol: string;
  interval: string;
  /** Initial channel overlay. Default "bb". */
  initialBands?: BandMode;
  /** Initial volume visibility. Default true. */
  initialShowVolume?: boolean;
  /** Optional event markers (e.g. footprints). Re-applied whenever the array reference changes. */
  markers?: ChartMarker[];
  onData?: (closes: number[]) => void;
}

export function CandleChart({
  symbol,
  interval,
  initialBands = "bb",
  initialShowVolume = true,
  markers,
  onData,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema200Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const bandUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bandMidRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bandLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const klinesRef = useRef<Kline[]>([]);
  const closesRef = useRef<number[]>([]);

  const [bands, setBands] = useState<BandMode>(initialBands);
  const [showVolume, setShowVolume] = useState(initialShowVolume);

  // Color per band mode (BB = pink, Donchian = teal)
  const bandColor = bands === "donchian" ? "#5eead4" : "#f472b6";
  const bandColorStrong = bands === "donchian" ? "rgba(94,234,212,0.65)" : "rgba(244,114,182,0.65)";
  const bandColorWeak = bands === "donchian" ? "rgba(94,234,212,0.35)" : "rgba(244,114,182,0.35)";

  // Build chart once
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
        fontFamily: "JetBrains Mono, monospace",
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.06)" },
        horzLines: { color: "rgba(148,163,184,0.06)" },
      },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.15)" },
      timeScale: { borderColor: "rgba(148,163,184,0.15)", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;

    candleRef.current = chart.addCandlestickSeries({
      upColor: "#00ff95",
      downColor: "#ff3366",
      borderUpColor: "#00ff95",
      borderDownColor: "#ff3366",
      wickUpColor: "#00ff95",
      wickDownColor: "#ff3366",
    });

    volumeRef.current = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: "rgba(148,163,184,0.4)",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    ema20Ref.current = chart.addLineSeries({ color: "#00d9ff", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    ema50Ref.current = chart.addLineSeries({ color: "#ffb800", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    ema200Ref.current = chart.addLineSeries({ color: "#c084fc", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

    bandUpperRef.current = chart.addLineSeries({ lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
    bandMidRef.current = chart.addLineSeries({ lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
    bandLowerRef.current = chart.addLineSeries({ lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });

    return () => { chart.remove(); chartRef.current = null; };
  }, []);

  // Re-color & toggle visibility when bands or showVolume change
  useEffect(() => {
    bandUpperRef.current?.applyOptions({ color: bandColorStrong, visible: bands !== "off" });
    bandMidRef.current?.applyOptions({ color: bandColorWeak, visible: bands !== "off" });
    bandLowerRef.current?.applyOptions({ color: bandColorStrong, visible: bands !== "off" });
  }, [bands, bandColorStrong, bandColorWeak]);

  useEffect(() => {
    volumeRef.current?.applyOptions({ visible: showVolume });
  }, [showVolume]);

  // Apply markers when prop changes
  useEffect(() => {
    if (!candleRef.current) return;
    if (!markers || markers.length === 0) {
      candleRef.current.setMarkers([]);
      return;
    }
    const sorted = [...markers].sort((a, b) => a.time - b.time);
    candleRef.current.setMarkers(sorted.map((m) => ({
      time: m.time as any,
      position: m.position as any,
      shape: m.shape as any,
      color: m.color,
      text: m.text,
    })));
  }, [markers]);

  // Recompute band data when toggling between BB and Donchian
  useEffect(() => {
    const klines = klinesRef.current;
    if (klines.length === 0 || bands === "off") return;
    const closes = klines.map((k) => k.close);
    const highs = klines.map((k) => k.high);
    const lows = klines.map((k) => k.low);
    const data = bands === "bb" ? bollinger(closes, 20, 2) : donchian(highs, lows, 20);
    bandUpperRef.current?.setData(klines.map((k, i) => data.upper[i] !== null ? { time: k.time as any, value: data.upper[i] as number } : null).filter(Boolean) as any);
    bandMidRef.current?.setData(klines.map((k, i) => data.mid[i] !== null ? { time: k.time as any, value: data.mid[i] as number } : null).filter(Boolean) as any);
    bandLowerRef.current?.setData(klines.map((k, i) => data.lower[i] !== null ? { time: k.time as any, value: data.lower[i] as number } : null).filter(Boolean) as any);
  }, [bands]);

  // Load + subscribe per symbol/interval
  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    const candle = candleRef.current!;
    const vol = volumeRef.current!;

    fetchKlines(symbol, interval, 500).then((klines) => {
      if (cancelled) return;
      klinesRef.current = klines;
      const cd: CandlestickData[] = klines.map((k) => ({ time: k.time as any, open: k.open, high: k.high, low: k.low, close: k.close }));
      const vd: HistogramData[] = klines.map((k) => ({
        time: k.time as any,
        value: k.volume,
        color: k.close >= k.open ? "rgba(0,255,149,0.35)" : "rgba(255,51,102,0.35)",
      }));
      candle.setData(cd);
      vol.setData(vd);

      const closes = klines.map((k) => k.close);
      const highs = klines.map((k) => k.high);
      const lows = klines.map((k) => k.low);
      closesRef.current = closes;

      const e20 = ema(closes, 20);
      const e50 = ema(closes, 50);
      const e200 = ema(closes, 200);
      ema20Ref.current?.setData(klines.map((k, i) => e20[i] !== null ? { time: k.time as any, value: e20[i] as number } : null).filter(Boolean) as any);
      ema50Ref.current?.setData(klines.map((k, i) => e50[i] !== null ? { time: k.time as any, value: e50[i] as number } : null).filter(Boolean) as any);
      ema200Ref.current?.setData(klines.map((k, i) => e200[i] !== null ? { time: k.time as any, value: e200[i] as number } : null).filter(Boolean) as any);

      if (bands !== "off") {
        const data = bands === "bb" ? bollinger(closes, 20, 2) : donchian(highs, lows, 20);
        bandUpperRef.current?.setData(klines.map((k, i) => data.upper[i] !== null ? { time: k.time as any, value: data.upper[i] as number } : null).filter(Boolean) as any);
        bandMidRef.current?.setData(klines.map((k, i) => data.mid[i] !== null ? { time: k.time as any, value: data.mid[i] as number } : null).filter(Boolean) as any);
        bandLowerRef.current?.setData(klines.map((k, i) => data.lower[i] !== null ? { time: k.time as any, value: data.lower[i] as number } : null).filter(Boolean) as any);
      }

      chartRef.current?.timeScale().fitContent();
      onData?.(closes);

      unsub = subscribeKline(symbol, interval, (k: Kline) => {
        candle.update({ time: k.time as any, open: k.open, high: k.high, low: k.low, close: k.close });
        vol.update({ time: k.time as any, value: k.volume, color: k.close >= k.open ? "rgba(0,255,149,0.35)" : "rgba(255,51,102,0.35)" });
        // patch the live bar
        const arr = klinesRef.current;
        if (arr.length > 0) {
          const last = arr[arr.length - 1];
          if (last.time === k.time) arr[arr.length - 1] = k;
          else arr.push(k);
        }
        closesRef.current = klinesRef.current.map((x) => x.close);
        onData?.(closesRef.current);
      });
    }).catch(() => {});

    return () => { cancelled = true; unsub?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {/* Toggle controls (top-right) */}
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-border bg-surface/90 p-0.5 backdrop-blur">
        {(["bb", "donchian", "off"] as BandMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setBands(m)}
            className={cn(
              "rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider transition-colors",
              bands === m
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            )}
            title={m === "bb" ? "Bollinger Bands(20,2)" : m === "donchian" ? "Donchian Channels(20)" : "Hide channels"}
          >
            {m === "bb" ? "BB" : m === "donchian" ? "DC" : "Off"}
          </button>
        ))}
        <span className="mx-0.5 h-3 w-px bg-border" />
        <button
          onClick={() => setShowVolume((v) => !v)}
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider transition-colors",
            showVolume
              ? "bg-primary/20 text-primary"
              : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          )}
          title={showVolume ? "Hide volume histogram" : "Show volume histogram"}
        >
          {showVolume ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
          Vol
        </button>
      </div>

      {/* Legend (top-left, below toggle area on small screens via flex-wrap) */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px]">
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#00d9ff]" /> EMA20</span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#ffb800]" /> EMA50</span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#c084fc]" /> EMA200</span>
        {bands !== "off" && (
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: bandColor }} />
            {bands === "bb" ? "BB(20,2)" : "Donchian(20)"}
          </span>
        )}
      </div>
    </div>
  );
}
