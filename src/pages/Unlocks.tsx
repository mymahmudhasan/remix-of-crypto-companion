import { useMemo, useState } from "react";
import { Lock, Calendar, AlertTriangle, ShieldCheck, Eye, Scissors, Search } from "lucide-react";
import { UNLOCKS, judgeUnlock, type UnlockEvent } from "@/lib/unlocks";
import { cn } from "@/lib/utils";

const ACTION_META: Record<string, { icon: any; cls: string; label: string }> = {
  hold: { icon: ShieldCheck, cls: "bg-bull/15 text-bull border-bull/30", label: "HOLD" },
  watch: { icon: Eye, cls: "bg-accent/15 text-accent border-accent/30", label: "WATCH" },
  trim: { icon: Scissors, cls: "bg-warning/15 text-warning border-warning/30", label: "TRIM" },
  avoid: { icon: AlertTriangle, cls: "bg-bear/15 text-bear border-bear/30", label: "AVOID" },
};

const CATEGORIES = ["all", "cliff", "linear", "team", "investor", "ecosystem"] as const;

export default function Unlocks() {
  const [cat, setCat] = useState<typeof CATEGORIES[number]>("all");
  const [windowDays, setWindowDays] = useState(30);
  const [search, setSearch] = useState("");

  const events = useMemo(() => {
    const now = new Date();
    const limit = new Date(); limit.setDate(now.getDate() + windowDays);
    const q = search.trim().toUpperCase();
    return UNLOCKS
      .filter((u) => new Date(u.date) <= limit)
      .filter((u) => cat === "all" || u.category === cat)
      .filter((u) => !q || u.symbol.toUpperCase().includes(q) || u.name.toUpperCase().includes(q))
      .map((u) => ({ event: u, verdict: judgeUnlock(u) }))
      .sort((a, b) => +new Date(a.event.date) - +new Date(b.event.date));
  }, [cat, windowDays, search]);

  const totalUsd = events.reduce((s, e) => s + e.event.amountUsd, 0);
  const highRisk = events.filter((e) => e.verdict.action === "avoid" || e.verdict.action === "trim").length;

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden p-2">
      {/* Stats */}
      <div className="grid gap-2 sm:grid-cols-3">
        <StatCard icon={Calendar} label="Events" value={events.length.toString()} sub={`Next ${windowDays} days`} />
        <StatCard icon={Lock} label="Total Unlocks" value={`$${(totalUsd / 1_000_000).toFixed(1)}M`} sub="USD value at recent prices" />
        <StatCard icon={AlertTriangle} label="High-Risk" value={highRisk.toString()} sub="Avoid / Trim verdicts" tone={highRisk > 0 ? "bear" : "bull"} />
      </div>

      {/* Filters */}
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <div className="relative min-w-[180px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search token… (ARB, SUI)"
            className="w-full rounded-md border border-border bg-surface-elevated py-1 pl-7 pr-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
          />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Category:</span>
        <div className="flex flex-wrap overflow-hidden rounded-md border border-border bg-surface-elevated">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={cn(
                "px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors",
                cat === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Window:</span>
        <div className="flex overflow-hidden rounded-md border border-border bg-surface-elevated">
          {[7, 14, 30, 60, 90].map((d) => (
            <button
              key={d}
              onClick={() => setWindowDays(d)}
              className={cn(
                "px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors",
                windowDays === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="panel min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="divide-y divide-border">
          {events.map(({ event, verdict }) => {
            const meta = ACTION_META[verdict.action];
            const Icon = meta.icon;
            const date = new Date(event.date);
            const days = Math.max(0, Math.ceil((+date - Date.now()) / (1000 * 60 * 60 * 24)));
            return (
              <div key={event.symbol + event.date} className="flex flex-col gap-2 p-3 hover:bg-surface-hover sm:flex-row sm:items-center sm:gap-4">
                {/* Date pill */}
                <div className="flex w-20 shrink-0 flex-col items-start sm:items-center">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">In {days}d</span>
                  <span className="font-mono text-sm font-bold text-foreground">
                    {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>

                {/* Token */}
                <div className="flex flex-1 items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-md border border-primary/30 bg-primary/10 font-mono text-xs font-bold text-primary">
                    {event.symbol.replace("USDT", "").slice(0, 4)}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-mono text-sm font-semibold text-foreground">{event.name}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{event.category} · {event.symbol}</span>
                  </div>
                </div>

                {/* Numbers */}
                <div className="flex flex-1 gap-4 sm:flex-none">
                  <div className="flex flex-col">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Amount</span>
                    <span className="font-mono text-sm font-bold tabular-nums text-foreground">${(event.amountUsd / 1_000_000).toFixed(1)}M</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">% Supply</span>
                    <span className={cn("font-mono text-sm font-bold tabular-nums", event.supplyPct >= 3 ? "text-bear" : event.supplyPct >= 1.5 ? "text-warning" : "text-foreground")}>
                      {event.supplyPct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Risk</span>
                    <div className="flex items-center gap-1.5">
                      <div className="h-1 w-12 overflow-hidden rounded-full bg-surface-elevated">
                        <div className="h-full bg-bear" style={{ width: `${verdict.riskScore}%` }} />
                      </div>
                      <span className="font-mono text-xs">{verdict.riskScore}</span>
                    </div>
                  </div>
                </div>

                {/* Verdict */}
                <div className="flex w-full flex-col gap-1 sm:w-72">
                  <span className={cn("inline-flex w-fit items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider", meta.cls)}>
                    <Icon className="size-3" /> {meta.label}
                  </span>
                  <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">{verdict.rationale}</p>
                  {event.notes && <p className="font-mono text-[10px] italic text-muted-foreground/70">{event.notes}</p>}
                </div>
              </div>
            );
          })}
          {events.length === 0 && <div className="p-12 text-center font-mono text-xs text-muted-foreground">No unlocks in the selected window.</div>}
        </div>
      </div>

      <p className="px-2 font-mono text-[10px] text-muted-foreground">
        ⚠ Educational verdicts based on supply mechanics. Always cross-check on official project docs. Not financial advice.
      </p>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub: string; tone?: "bull" | "bear" }) {
  return (
    <div className="panel flex items-center gap-3 p-3">
      <div className={cn("flex size-10 items-center justify-center rounded-md border", tone === "bear" ? "border-bear/40 bg-bear/10" : tone === "bull" ? "border-bull/40 bg-bull/10" : "border-primary/40 bg-primary/10")}>
        <Icon className={cn("size-5", tone === "bear" ? "text-bear" : tone === "bull" ? "text-bull" : "text-primary")} />
      </div>
      <div className="flex flex-col">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="font-mono text-xl font-bold neon-text">{value}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{sub}</span>
      </div>
    </div>
  );
}
