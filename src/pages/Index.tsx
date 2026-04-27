import { useState } from "react";
import { Watchlist } from "@/components/Watchlist";
import { CandleChart } from "@/components/CandleChart";
import { SymbolHeader } from "@/components/SymbolHeader";
import { SignalsPanel } from "@/components/SignalsPanel";
import { AIAssistant } from "@/components/AIAssistant";
import { MarketHero, MarketStatsBar } from "@/components/MarketHero";
import { TopMovers } from "@/components/TopMovers";
import { QuickActions } from "@/components/QuickActions";
import { SuggestedTrades } from "@/components/SuggestedTrades";
import { ReversalRadar } from "@/components/ReversalRadar";
import { CrashRiskRadar } from "@/components/CrashRiskRadar";
import { RfdPanel } from "@/components/RfdPanel";
import { NewsSignalsCard } from "@/components/NewsSignalsCard";

const WATCHLIST = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "TONUSDT",
  "TRXUSDT", "DOTUSDT", "MATICUSDT", "NEARUSDT", "APTUSDT",
];

const Index = () => {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState("1h");
  const [closes, setCloses] = useState<number[]>([]);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin text-base">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 md:p-6">
        {/* Section: Market Overview */}
        <Section title="Market Overview" subtitle="Global stats & top movers at a glance">
          <MarketStatsBar />
          <MarketHero onSelect={setSymbol} selected={symbol} />
          <QuickActions />
        </Section>

        {/* Section: Chart */}
        <Section title="Chart" subtitle={`${symbol} · ${interval}`}>
          <div className="panel flex min-h-[520px] flex-col">
            <SymbolHeader symbol={symbol} interval={interval} onIntervalChange={setInterval} />
            <div className="min-h-[460px] flex-1">
              <CandleChart symbol={symbol} interval={interval} onData={setCloses} />
            </div>
          </div>
        </Section>

        {/* Section: Watchlist */}
        <Section title="Watchlist" subtitle="Tap a symbol to load it in the chart">
          <div className="min-h-[360px]">
            <Watchlist symbols={WATCHLIST} selected={symbol} onSelect={setSymbol} />
          </div>
        </Section>

        {/* Section: AI Assistant */}
        <Section title="AI Assistant" subtitle="Live commentary on the selected symbol">
          <div className="min-h-[280px]">
            <AIAssistant symbol={symbol} interval={interval} closes={closes} />
          </div>
        </Section>

        {/* Section: Signals */}
        <Section title="Signals" subtitle="Indicator-based buy/sell signals for the selected symbol">
          <div className="min-h-[520px]">
            <SignalsPanel closes={closes} symbol={symbol} />
          </div>
        </Section>

        {/* Section: News Signals */}
        <Section title="News Signals" subtitle="Trade ideas generated from latest news">
          <NewsSignalsCard onSelect={setSymbol} />
        </Section>

        {/* Section: RFD Analysis */}
        <Section title="RFD Analysis" subtitle="Rate of Force Development with MACD-style breakdown">
          <div className="min-h-[560px]">
            <RfdPanel symbol={symbol} />
          </div>
        </Section>

        {/* Section: Reversal Radar */}
        <Section title="Reversal Radar" subtitle="High-priority, low-risk reversal setups">
          <div className="min-h-[520px]">
            <ReversalRadar onSelect={setSymbol} />
          </div>
        </Section>

        {/* Section: Crash Risk Radar */}
        <Section title="Crash Risk Radar" subtitle="Tokens with elevated crash probability">
          <div className="min-h-[520px]">
            <CrashRiskRadar onSelect={setSymbol} />
          </div>
        </Section>

        {/* Section: Suggested Trades */}
        <Section title="Suggested Trades" subtitle="Curated setups based on current market conditions">
          <div className="min-h-[460px]">
            <SuggestedTrades onSelect={setSymbol} />
          </div>
        </Section>

        {/* Section: Top Movers */}
        <Section title="Top Movers" subtitle="Biggest gainers and losers over 24h">
          <div className="min-h-[460px]">
            <TopMovers onSelect={setSymbol} />
          </div>
        </Section>
      </div>
    </div>
  );
};

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1 border-b border-border/60 pb-2">
        <h2 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm text-muted-foreground md:text-base">{subtitle}</p>
        )}
      </header>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export default Index;
