import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, type IChartApi, type CandlestickData } from "lightweight-charts";

// Multiple Binance read-only hosts to bypass per-region blocks (some users are geo-blocked from api.binance.com).
const KLINE_HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
];
async function fetchKlinesAny(symbol: string, interval: string, limit: number) {
  for (const host of KLINE_HOSTS) {
    try {
      const r = await fetch(`${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      if (!r.ok) continue;
      const raw: any[][] = await r.json();
      return raw.map((k) => ({
        time: Math.floor(k[0] / 1000), open: parseFloat(k[1]), high: parseFloat(k[2]),
        low: parseFloat(k[3]), close: parseFloat(k[4]),
      }));
    } catch { /* try next */ }
  }
  throw new Error("All Binance hosts blocked");
}

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
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    let cancelled = false;
    fetchKlines(symbol, interval, 80)
      .then((klines) => {
        if (cancelled) return;
        const data: CandlestickData[] = klines.map((k) => ({
          time: k.time as any, open: k.open, high: k.high, low: k.low, close: k.close,
        }));
        series.setData(data);
        series.createPriceLine({
          price: (entryLow + entryHigh) / 2,
          color: "#3b82f6", lineWidth: 1, lineStyle: 2,
          axisLabelVisible: true, title: "Entry",
        });
        series.createPriceLine({
          price: stop, color: "#ef4444", lineWidth: 1, lineStyle: 2,
          axisLabelVisible: true, title: "SL",
        });
        targets.forEach((t, i) => series.createPriceLine({
          price: t, color: "#22c55e", lineWidth: 1, lineStyle: 3,
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
