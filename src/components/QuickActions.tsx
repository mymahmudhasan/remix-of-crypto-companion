import { Link } from "react-router-dom";
import { Radar, Sparkles, Crosshair, Newspaper, Flame, Lock, Bookmark, Rocket } from "lucide-react";

const ACTIONS = [
  { to: "/scanner", label: "Scanner", desc: "Find setups", icon: Radar, accent: "text-primary" },
  { to: "/signals", label: "Signals", desc: "Premium alpha", icon: Sparkles, accent: "text-accent" },
  { to: "/smart-money", label: "Smart Money", desc: "Whale flow", icon: Crosshair, accent: "text-warning" },
  { to: "/futures", label: "Futures", desc: "Leverage trade", icon: Rocket, accent: "text-primary" },
  { to: "/news", label: "News", desc: "Catalysts", icon: Newspaper, accent: "text-accent" },
  { to: "/pump-dump", label: "Pump/Dump", desc: "Spike alerts", icon: Flame, accent: "text-bear" },
  { to: "/unlocks", label: "Unlocks", desc: "Token cliffs", icon: Lock, accent: "text-warning" },
  { to: "/plans", label: "Journal", desc: "Saved plans", icon: Bookmark, accent: "text-muted-foreground" },
];

export function QuickActions() {
  return (
    <div className="panel p-2">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Quick Access
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 md:grid-cols-8">
        {ACTIONS.map((a) => {
          const Icon = a.icon;
          return (
            <Link
              key={a.to}
              to={a.to}
              className="group flex flex-col items-center gap-1 rounded-md border border-border bg-surface-elevated px-2 py-2.5 text-center transition-all hover:border-primary/40 hover:bg-surface-hover"
            >
              <Icon className={`size-4 ${a.accent} transition-transform group-hover:scale-110`} />
              <span className="font-mono text-[10px] font-semibold leading-none text-foreground">
                {a.label}
              </span>
              <span className="font-mono text-[9px] leading-none text-muted-foreground">
                {a.desc}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
