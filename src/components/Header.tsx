import { Activity, Wifi } from "lucide-react";

export function Header() {
  return (
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
      <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="hidden items-center gap-1.5 md:flex">
          <Wifi className="size-3 text-bull" /> Binance · Live
        </span>
        <span className="hidden md:inline">{new Date().toLocaleDateString()}</span>
      </div>
    </header>
  );
}
