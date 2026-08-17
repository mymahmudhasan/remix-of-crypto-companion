import { useState } from "react";
import {
  LayoutDashboard, Radar, ShoppingCart, Rocket, Sparkles, Wand2, Crosshair,
  Newspaper, Flame, Lock, Bookmark, BellRing, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { cn } from "@/lib/utils";

const GROUPS = [
  {
    label: "Markets",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/scanner", label: "Scanner", icon: Radar },
      { to: "/spot", label: "Spot", icon: ShoppingCart },
      { to: "/futures", label: "Futures", icon: Rocket },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/signals", label: "Signals", icon: Sparkles },
      { to: "/smart-money", label: "Smart Money", icon: Crosshair },
      { to: "/news", label: "News", icon: Newspaper },
      { to: "/square", label: "Square Posts", icon: Wand2 },
    ],
  },
  {
    label: "Risk",
    items: [
      { to: "/alerts", label: "Level Alerts", icon: BellRing },
      { to: "/pump-dump", label: "Pump / Dump", icon: Flame },
      { to: "/unlocks", label: "Unlocks", icon: Lock },
    ],
  },
  {
    label: "Personal",
    items: [{ to: "/plans", label: "Journal", icon: Bookmark }],
  },
];

export function SideNav() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-border bg-surface/50 transition-[width] duration-200 md:flex",
        collapsed ? "w-[52px]" : "w-[188px]",
      )}
    >
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-2">
        {GROUPS.map((g) => (
          <div key={g.label} className="mb-2">
            {!collapsed && (
              <div className="px-3 pb-1 pt-2 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">
                {g.label}
              </div>
            )}
            {g.items.map((t) => {
              const Icon = t.icon;
              return (
                <NavLink
                  key={t.to}
                  to={t.to}
                  end={t.end}
                  title={t.label}
                  className={cn(
                    "relative flex items-center gap-2.5 px-3 py-[7px] text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-surface-hover/60 hover:text-foreground",
                    collapsed && "justify-center px-0",
                  )}
                  activeClassName="!text-foreground bg-primary/10 before:absolute before:left-0 before:top-1/2 before:h-[18px] before:w-[2px] before:-translate-y-1/2 before:rounded-r before:bg-primary [&_svg]:!text-primary"
                >
                  <Icon className="size-[15px] shrink-0" />
                  {!collapsed && <span className="truncate">{t.label}</span>}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
      >
        {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}

/** Horizontal rail for small screens. */
export function MobileNav() {
  const items = GROUPS.flatMap((g) => g.items);
  return (
    <nav className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-surface/40 px-2 scrollbar-thin md:hidden">
      {items.map((t) => {
        const Icon = t.icon;
        return (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className="flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2.5 py-2 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            activeClassName="!border-primary !text-foreground"
          >
            <Icon className="size-3.5" />
            {t.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
