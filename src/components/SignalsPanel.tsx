import { snapshot, scoreSignal, type IndicatorSnapshot } from "@/lib/indicators";
import { formatPrice } from "@/lib/binance";
import { cn } from "@/lib/utils";

interface Props {
  closes: number[];
  symbol: string;
}

function Bar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-elevated">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-sm font-semibold", valueClass)}>{value}</span>
    </div>
  );
}

export function SignalsPanel({ closes, symbol }: Props) {
  if (closes.length < 50) {
    return (
      <div className="panel flex h-full items-center justify-center p-6">
        <span className="font-mono text-xs text-muted-foreground">Loading indicators…</span>
      </div>
    );
  }

  const s: IndicatorSnapshot = snapshot(closes);
  const sig = scoreSignal(s);
  const biasColor = sig.bias === "bull" ? "text-bull" : sig.bias === "bear" ? "text-bear" : "text-muted-foreground";
  const biasBg = sig.bias === "bull" ? "bg-bull/10 border-bull/30" : sig.bias === "bear" ? "bg-bear/10 border-bear/30" : "bg-muted/20 border-border";

  const rsiColor = s.rsi14 === null ? "text-muted-foreground" : s.rsi14 > 70 ? "text-bear" : s.rsi14 < 30 ? "text-bull" : "text-foreground";

  return (
    <div className="panel flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">Technical Signals</h3>
        <span className="font-mono text-[10px] text-muted-foreground">{symbol.replace("USDT", "/USDT")}</span>
      </div>

      <div className="flex flex-col gap-4 overflow-y-auto p-4 scrollbar-thin">
        {/* Bias */}
        <div className={cn("rounded-md border p-3", biasBg)}>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Composite Bias</span>
            <span className={cn("font-mono text-xs font-semibold", biasColor)}>
              Score {sig.score > 0 ? "+" : ""}{sig.score}
            </span>
          </div>
          <div className={cn("mt-1 font-mono text-2xl font-bold uppercase neon-text", biasColor)}>
            {sig.bias === "bull" ? "▲ Bullish" : sig.bias === "bear" ? "▼ Bearish" : "● Neutral"}
          </div>
        </div>

        {/* RSI */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">RSI (14)</span>
            <span className={cn("font-mono text-sm font-semibold", rsiColor)}>
              {s.rsi14?.toFixed(1) ?? "—"}
            </span>
          </div>
          <Bar
            value={s.rsi14 ?? 50}
            color={s.rsi14 && s.rsi14 > 70 ? "hsl(var(--bear))" : s.rsi14 && s.rsi14 < 30 ? "hsl(var(--bull))" : "hsl(var(--accent))"}
          />
          <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground">
            <span>0</span><span>30 oversold</span><span>70 overbought</span><span>100</span>
          </div>
        </div>

        {/* MACD */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">MACD</span>
            <span className={cn("font-mono text-sm font-semibold", (s.macdHist ?? 0) >= 0 ? "text-bull" : "text-bear")}>
              {s.macdHist?.toFixed(4) ?? "—"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
            <div>MACD: <span className="text-foreground">{s.macd?.toFixed(3)}</span></div>
            <div>Signal: <span className="text-foreground">{s.macdSignal?.toFixed(3)}</span></div>
            <div>Hist: <span className={(s.macdHist ?? 0) >= 0 ? "text-bull" : "text-bear"}>{s.macdHist?.toFixed(3)}</span></div>
          </div>
        </div>

        {/* EMAs */}
        <div className="grid grid-cols-3 gap-3 border-t border-border pt-3">
          <Stat label="EMA 20" value={s.ema20 ? formatPrice(s.ema20) : "—"} valueClass={s.price > (s.ema20 ?? 0) ? "text-bull" : "text-bear"} />
          <Stat label="EMA 50" value={s.ema50 ? formatPrice(s.ema50) : "—"} valueClass={s.price > (s.ema50 ?? 0) ? "text-bull" : "text-bear"} />
          <Stat label="EMA 200" value={s.ema200 ? formatPrice(s.ema200) : "—"} valueClass={s.price > (s.ema200 ?? 0) ? "text-bull" : "text-bear"} />
        </div>

        {/* S/R */}
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
          <Stat label="Resistance (50)" value={formatPrice(s.recentHigh)} valueClass="text-bear" />
          <Stat label="Support (50)" value={formatPrice(s.recentLow)} valueClass="text-bull" />
        </div>

        {/* Reasons */}
        <div className="border-t border-border pt-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Why</span>
          <ul className="mt-2 space-y-1">
            {sig.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2 font-mono text-xs">
                <span className="mt-1 size-1 shrink-0 rounded-full bg-primary" />
                <span className="text-foreground/80">{r}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="border-t border-border pt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
          ⚠ Educational signals based on indicators only. Not financial advice. Always do your own research.
        </p>
      </div>
    </div>
  );
}
