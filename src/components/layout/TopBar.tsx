import { Activity, Wifi } from "lucide-react";
import { PortfolioSettings } from "@/components/PortfolioSettings";
import { AnalystChatDock } from "@/components/AnalystChatDock";
import { PriceAlertsWatcher } from "@/components/PriceAlertsWatcher";
import { FootprintAlertsWatcher } from "@/components/FootprintAlertsWatcher";

export function TopBar() {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface/70 px-3 py-2 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <div className="flex size-7 items-center justify-center rounded border border-primary/40 bg-primary/15">
          <Activity className="size-3.5 text-primary" />
        </div>
        <div className="flex flex-col leading-none">
          <span className="font-display text-[13px] font-bold tracking-tight text-foreground">
            CRYPTO<span className="text-primary">DESK</span>
          </span>
          <span className="font-mono text-[8.5px] uppercase tracking-[0.22em] text-muted-foreground">
            Trading Terminal
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <PortfolioSettings />
        <PriceAlertsWatcher />
        <FootprintAlertsWatcher />
        <span className="hidden items-center gap-1.5 rounded border border-border bg-surface-elevated px-2 py-1 sm:flex">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-pulse-glow rounded-full bg-bull" />
          </span>
          <Wifi className="size-3 text-bull" /> Binance · Live
        </span>
      </div>
    </header>
  );
}

export { AnalystChatDock };
