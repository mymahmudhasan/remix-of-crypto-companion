import { Outlet } from "react-router-dom";
import { Activity, Wifi, LayoutDashboard, Radar, ShoppingCart, Rocket, Flame, Lock, Bookmark, Crosshair, Newspaper, Sparkles } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { TickerBar } from "@/components/TickerBar";
import { FavoritesStrip } from "@/components/FavoritesStrip";
import { FootprintAlertsWatcher } from "@/components/FootprintAlertsWatcher";
import { AnalystChatDock } from "@/components/AnalystChatDock";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/scanner", label: "Scanner", icon: Radar },
  { to: "/spot", label: "Spot", icon: ShoppingCart },
  { to: "/futures", label: "Futures", icon: Rocket },
  { to: "/signals", label: "Signals", icon: Sparkles },
  { to: "/smart-money", label: "Smart Money", icon: Crosshair },
  { to: "/news", label: "News", icon: Newspaper },
  { to: "/pump-dump", label: "Pump/Dump", icon: Flame },
  { to: "/unlocks", label: "Unlocks", icon: Lock },
  { to: "/plans", label: "Journal", icon: Bookmark },
];

export function AppLayout() {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border bg-surface/80 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md border border-primary/40 bg-primary/10 glow-bull">
            <Activity className="size-4 text-primary" />
          </div>
          <div className="flex flex-col leading-none">
            <h1 className="font-mono text-base font-bold tracking-tight text-foreground neon-text">
              CRYPTO<span className="text-primary">DESK</span>
            </h1>
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
              Smart Trading Terminal
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <FootprintAlertsWatcher />
          <span className="hidden items-center gap-1.5 md:flex">
            <Wifi className="size-3 text-bull" /> Binance · Live
          </span>
        </div>
      </header>

      {/* Tab nav */}
      <nav className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-surface/40 px-2 scrollbar-thin">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              )}
              activeClassName="!border-primary !text-primary neon-text"
            >
              <Icon className="size-3.5" />
              {t.label}
            </NavLink>
          );
        })}
      </nav>

      <TickerBar />
      <FavoritesStrip />

      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>

      <AnalystChatDock />
    </div>
  );
}
