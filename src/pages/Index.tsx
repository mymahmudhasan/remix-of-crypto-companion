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
      <div className="flex flex-col gap-2 p-2">
        {/* Top: market overview */}
        <MarketStatsBar />
        <MarketHero onSelect={setSymbol} selected={symbol} />
        <QuickActions />

        {/* Main grid: chart + signals + AI + movers */}
        <div className="grid gap-2 lg:grid-cols-[260px_1fr_340px]">
          <div className="hidden h-[640px] lg:block">
            <Watchlist symbols={WATCHLIST} selected={symbol} onSelect={setSymbol} />
          </div>

          <div className="flex flex-col gap-2">
            <div className="panel flex h-[420px] flex-col">
              <SymbolHeader symbol={symbol} interval={interval} onIntervalChange={setInterval} />
              <div className="flex-1">
                <CandleChart symbol={symbol} interval={interval} onData={setCloses} />
              </div>
            </div>
            <div className="h-[212px]">
              <AIAssistant symbol={symbol} interval={interval} closes={closes} />
            </div>
          </div>

          <div className="hidden h-[640px] lg:block">
            <SignalsPanel closes={closes} symbol={symbol} />
          </div>
        </div>

        {/* RFD Analysis — Rate of Force Development with MACD-style breakdown + buy/sell verdict */}
        <div className="h-[520px]">
          <RfdPanel symbol={symbol} />
        </div>

        {/* Reversal radar full width — high-priority low-risk setups */}
        <div className="h-[460px]">
          <ReversalRadar onSelect={setSymbol} />
        </div>

        {/* Crash Risk Radar — tokens with high probability of crashing */}
        <div className="h-[460px]">
          <CrashRiskRadar onSelect={setSymbol} />
        </div>

        {/* Bottom: suggested trades + top movers */}
        <div className="grid gap-2 lg:grid-cols-2">
          <div className="h-[420px]">
            <SuggestedTrades onSelect={setSymbol} />
          </div>
          <div className="h-[420px]">
            <TopMovers onSelect={setSymbol} />
          </div>
        </div>

        {/* Mobile-only stacks */}
        <div className="grid gap-2 lg:hidden">
          <div className="h-[280px]">
            <SignalsPanel closes={closes} symbol={symbol} />
          </div>
          <div className="h-[320px]">
            <Watchlist symbols={WATCHLIST} selected={symbol} onSelect={setSymbol} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
