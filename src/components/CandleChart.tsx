import { useEffect, useRef } from "react";
import { createChart, type IChartApi, type ISeriesApi, type CandlestickData, type HistogramData, ColorType } from "lightweight-charts";
import { fetchKlines, subscribeKline, type Kline } from "@/lib/binance";
import { ema, bollinger } from "@/lib/indicators";

interface Props {
  symbol: string;
  interval: string;
  /** Show Bollinger Bands(20,2) overlay. Default true. */
  showBollinger?: boolean;
  onData?: (closes: number[]) => void;
}

export function CandleChart({ symbol, interval, showBollinger = true, onData }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema200Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbMidRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const closesRef = useRef<number[]>([]);

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

    const candles = chart.addCandlestickSeries({
      upColor: "#00ff95",
      downColor: "#ff3366",
      borderUpColor: "#00ff95",
      borderDownColor: "#ff3366",
      wickUpColor: "#00ff95",
      wickDownColor: "#ff3366",
    });
    candleRef.current = candles;

    const vol = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: "rgba(148,163,184,0.4)",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    volumeRef.current = vol;

    ema20Ref.current = chart.addLineSeries({ color: "#00d9ff", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    ema50Ref.current = chart.addLineSeries({ color: "#ffb800", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    ema200Ref.current = chart.addLineSeries({ color: "#c084fc", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

    if (showBollinger) {
      bbUpperRef.current = chart.addLineSeries({ color: "rgba(244,114,182,0.55)", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
      bbMidRef.current = chart.addLineSeries({ color: "rgba(244,114,182,0.35)", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
      bbLowerRef.current = chart.addLineSeries({ color: "rgba(244,114,182,0.55)", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
    }

    return () => { chart.remove(); chartRef.current = null; };
  }, [showBollinger]);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    const candle = candleRef.current!;
    const vol = volumeRef.current!;

    fetchKlines(symbol, interval, 500).then((klines) => {
      if (cancelled) return;
      const cd: CandlestickData[] = klines.map((k) => ({ time: k.time as any, open: k.open, high: k.high, low: k.low, close: k.close }));
      const vd: HistogramData[] = klines.map((k) => ({
        time: k.time as any,
        value: k.volume,
        color: k.close >= k.open ? "rgba(0,255,149,0.35)" : "rgba(255,51,102,0.35)",
      }));
      candle.setData(cd);
      vol.setData(vd);
      const closes = klines.map((k) => k.close);
      closesRef.current = closes;
      const e20 = ema(closes, 20);
      const e50 = ema(closes, 50);
      const e200 = ema(closes, 200);
      ema20Ref.current?.setData(klines.map((k, i) => e20[i] !== null ? { time: k.time as any, value: e20[i] as number } : null).filter(Boolean) as any);
      ema50Ref.current?.setData(klines.map((k, i) => e50[i] !== null ? { time: k.time as any, value: e50[i] as number } : null).filter(Boolean) as any);
      ema200Ref.current?.setData(klines.map((k, i) => e200[i] !== null ? { time: k.time as any, value: e200[i] as number } : null).filter(Boolean) as any);
      chartRef.current?.timeScale().fitContent();
      onData?.(closes);

      unsub = subscribeKline(symbol, interval, (k: Kline) => {
        candle.update({ time: k.time as any, open: k.open, high: k.high, low: k.low, close: k.close });
        vol.update({ time: k.time as any, value: k.volume, color: k.close >= k.open ? "rgba(0,255,149,0.35)" : "rgba(255,51,102,0.35)" });
        const closes = closesRef.current;
        if (closes.length === 0) return;
        // update or push close
        if (closes.length && closesRef.current[closesRef.current.length - 1] !== undefined) {
          closesRef.current = [...closes.slice(0, -1), k.close];
        }
        onData?.(closesRef.current);
      });
    }).catch(() => {});

    return () => { cancelled = true; unsub?.(); };
  }, [symbol, interval]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px]">
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#00d9ff]" /> EMA20</span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#ffb800]" /> EMA50</span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#c084fc]" /> EMA200</span>
        {showBollinger && (
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#f472b6]" /> BB(20,2)</span>
        )}
      </div>
    </div>
  );
}
