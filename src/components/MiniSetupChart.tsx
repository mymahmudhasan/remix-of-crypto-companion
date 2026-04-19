import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, type IChartApi, type ISeriesApi, type CandlestickData } from "lightweight-charts";
import { fetchKlines } from "@/lib/binance";

interface Props {
  symbol: string;
  interval?: string;
  entryLow: number;
  entryHigh: number;
  stop: number;
  targets: number[];
}

export function MiniSetupChart({ symbol, interval = "1h", entryLow, entryHigh, stop, targets }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 160,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "rgba(148,163,184,0.7)", fontSize: 9 },
      grid: { vertLines: { color: "rgba(30,41,59,0.3)" }, horzLines: { color: "rgba(30,41,59,0.3)" } },
      timeScale: { visible: false, borderVisible: false },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.15, bottom: 0.15 } },
      crosshair: { mode: 0 },
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    const series = chart.addCandlestickSeries({
      upColor: "hsl(142, 76%, 50%)",
      downColor: "hsl(0, 72%, 55%)",
      borderUpColor: "hsl(142, 76%, 50%)",
      borderDownColor: "hsl(0, 72%, 55%)",
      wickUpColor: "hsl(142, 76%, 50%)",
      wickDownColor: "hsl(0, 72%, 55%)",
    });

    let cancelled = false;
    fetchKlines(symbol, interval, 80)
      .then((klines) => {
        if (cancelled) return;
        const data: CandlestickData[] = klines.map((k) => ({
          time: k.time as any, open: k.open, high: k.high, low: k.low, close: k.close,
        }));
        series.setData(data);
        // Entry zone (avg of low/high as line + price line for high & low)
        const entryLine = series.createPriceLine({
          price: (entryLow + entryHigh) / 2,
          color: "hsl(217, 91%, 60%)", lineWidth: 1, lineStyle: 2,
          axisLabelVisible: true, title: "Entry",
        });
        const stopLine = series.createPriceLine({
          price: stop, color: "hsl(0, 72%, 55%)", lineWidth: 1, lineStyle: 2,
          axisLabelVisible: true, title: "SL",
        });
        targets.forEach((t, i) => series.createPriceLine({
          price: t, color: "hsl(142, 76%, 50%)", lineWidth: 1, lineStyle: 3,
          axisLabelVisible: true, title: `T${i + 1}`,
        }));
        chart.timeScale().fitContent();
        setLoading(false);
      })
      .catch(() => setLoading(false));

    const ro = new ResizeObserver(() => {
      if (chartRef.current && el) chartRef.current.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    return () => {
      cancelled = true;
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [symbol, interval, entryLow, entryHigh, stop, targets.join(",")]);

  return (
    <div className="relative w-full overflow-hidden rounded border border-border bg-surface/50">
      <div ref={ref} className="h-[160px] w-full" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-muted-foreground">
          loading…
        </div>
      )}
    </div>
  );
}
