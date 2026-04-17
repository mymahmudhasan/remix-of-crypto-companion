import { useState } from "react";
import { Header } from "@/components/Header";
import { TickerBar } from "@/components/TickerBar";
import { Watchlist } from "@/components/Watchlist";
import { CandleChart } from "@/components/CandleChart";
import { SymbolHeader } from "@/components/SymbolHeader";
import { SignalsPanel } from "@/components/SignalsPanel";
import { AIAssistant } from "@/components/AIAssistant";

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
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Header />
      <TickerBar />

      <main className="grid flex-1 gap-2 overflow-hidden p-2 lg:grid-cols-[260px_1fr_340px]">
        {/* Left: watchlist */}
        <div className="hidden min-h-0 lg:block">
          <Watchlist symbols={WATCHLIST} selected={symbol} onSelect={setSymbol} />
        </div>

        {/* Center: chart + AI */}
        <div className="flex min-h-0 flex-col gap-2">
          <div className="panel flex min-h-0 flex-1 flex-col">
            <SymbolHeader symbol={symbol} interval={interval} onIntervalChange={setInterval} />
            <div className="flex-1">
              <CandleChart symbol={symbol} interval={interval} onData={setCloses} />
            </div>
          </div>
          <div className="h-[300px] min-h-0 lg:h-[280px]">
            <AIAssistant symbol={symbol} interval={interval} closes={closes} />
          </div>
        </div>

        {/* Right: signals */}
        <div className="hidden min-h-0 lg:block">
          <SignalsPanel closes={closes} symbol={symbol} />
        </div>
      </main>

      {/* Mobile fallback panels */}
      <div className="grid gap-2 p-2 lg:hidden">
        <div className="h-[280px]">
          <SignalsPanel closes={closes} symbol={symbol} />
        </div>
        <div className="h-[320px]">
          <Watchlist symbols={WATCHLIST} selected={symbol} onSelect={setSymbol} />
        </div>
      </div>
    </div>
  );
};

export default Index;
