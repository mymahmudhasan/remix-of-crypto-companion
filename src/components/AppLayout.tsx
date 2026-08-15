import { Outlet } from "react-router-dom";
import { TickerBar } from "@/components/TickerBar";
import { FavoritesStrip } from "@/components/FavoritesStrip";
import { AnalystChatDock } from "@/components/AnalystChatDock";
import { SideNav, MobileNav } from "@/components/layout/SideNav";
import { TopBar } from "@/components/layout/TopBar";

export function AppLayout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar />

      <div className="flex min-h-0 flex-1">
        <SideNav />

        <div className="flex min-w-0 flex-1 flex-col">
          <MobileNav />
          <div className="shrink-0 border-b border-border">
            <TickerBar />
            <FavoritesStrip />
          </div>

          <main className="min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>

      <AnalystChatDock />
    </div>
  );
}
