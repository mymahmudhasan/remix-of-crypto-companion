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
import { SymbolSearch } from "@/components/SymbolSearch";
import { SectionLabel } from "@/components/ui/panel";

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
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="flex flex-col gap-5 p-3 md:p-4">
        {/* Market strip */}
        <section className="flex flex-col gap-2.5">
          <SectionLabel hint="24h">Market</SectionLabel>
          <MarketStatsBar />
          <MarketHero onSelect={setSymbol} selected={symbol} />
          <QuickActions />
        </section>

        {/* Chart + right column */}
        <section className="flex flex-col gap-2.5">
          <SectionLabel hint={`${symbol} · ${interval}`}>Terminal</SectionLabel>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <div className="flex flex-col gap-2.5 xl:col-span-2">
              <SymbolSearch value={symbol} onSelect={setSymbol} />
              <div className="panel flex min-h-[480px] flex-col">
                <SymbolHeader symbol={symbol} interval={interval} onIntervalChange={setInterval} />
                <div className="min-h-[420px] flex-1">
                  <CandleChart symbol={symbol} interval={interval} onData={setCloses} />
                </div>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <div className="min-h-[420px]">
                <RfdPanel symbol={symbol} />
              </div>
              <div className="min-h-[420px]">
                <SignalsPanel closes={closes} symbol={symbol} />
              </div>
            </div>
          </div>
        </section>

        {/* Radars */}
        <section className="flex flex-col gap-2.5">
          <SectionLabel hint="live scan">Radar</SectionLabel>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            <div className="min-h-[440px]">
              <ReversalRadar onSelect={setSymbol} />
            </div>
            <div className="min-h-[440px]">
              <CrashRiskRadar onSelect={setSymbol} />
            </div>
            <div className="min-h-[440px]">
              <SuggestedTrades onSelect={setSymbol} />
            </div>
          </div>
        </section>

        {/* Desk modules */}
        <section className="flex flex-col gap-2.5">
          <SectionLabel>Desk</SectionLabel>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="min-h-[360px]">
              <Watchlist symbols={WATCHLIST} selected={symbol} onSelect={setSymbol} />
            </div>
            <div className="min-h-[360px]">
              <TopMovers onSelect={setSymbol} />
            </div>
            <div className="min-h-[320px]">
              <NewsSignalsCard onSelect={setSymbol} />
            </div>
            <div className="min-h-[320px]">
              <AIAssistant symbol={symbol} interval={interval} closes={closes} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Index;
