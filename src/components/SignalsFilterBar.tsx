import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { ArrowUpDown, Filter, Search } from "lucide-react";

export type SideFilter = "all" | "long" | "short";
export type TimeframeFilter = "all" | "intraday" | "swing" | "position";
export type SortKey = "conviction" | "risk_reward";

export interface SignalsFilterState {
  side: SideFilter;
  minConviction: number;
  timeframe: TimeframeFilter;
  sortBy: SortKey;
  search: string;
}

export const DEFAULT_FILTERS: SignalsFilterState = {
  side: "all",
  minConviction: 0,
  timeframe: "all",
  sortBy: "conviction",
  search: "",
};

interface Props {
  value: SignalsFilterState;
  onChange: (next: SignalsFilterState) => void;
  totalCount: number;
  visibleCount: number;
}

function PillGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T; activeClass?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-surface/40 p-0.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors",
              active
                ? opt.activeClass ?? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function SignalsFilterBar({ value, onChange, totalCount, visibleCount }: Props) {
  const update = <K extends keyof SignalsFilterState>(key: K, v: SignalsFilterState[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-surface/30 px-4 py-2">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <Filter className="size-3" /> Filters
      </div>

      {/* Search */}
      <div className="relative min-w-[160px]">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
        <input
          value={value.search}
          onChange={(e) => update("search", e.target.value)}
          placeholder="Search symbol…"
          className="w-full rounded-md border border-border bg-surface/40 py-1 pl-7 pr-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
      </div>

      {/* Side */}
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] uppercase text-muted-foreground">Side</span>
        <PillGroup
          value={value.side}
          onChange={(v) => update("side", v)}
          options={[
            { label: "All", value: "all" },
            { label: "Long", value: "long", activeClass: "bg-bull/20 text-bull" },
            { label: "Short", value: "short", activeClass: "bg-bear/20 text-bear" },
          ]}
        />
      </div>

      {/* Timeframe */}
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] uppercase text-muted-foreground">TF</span>
        <PillGroup
          value={value.timeframe}
          onChange={(v) => update("timeframe", v)}
          options={[
            { label: "All", value: "all" },
            { label: "Intraday", value: "intraday" },
            { label: "Swing", value: "swing" },
            { label: "Position", value: "position" },
          ]}
        />
      </div>

      {/* Min conviction */}
      <div className="flex min-w-[180px] flex-1 items-center gap-2">
        <span className="font-mono text-[10px] uppercase text-muted-foreground">
          Min conv
        </span>
        <Slider
          value={[value.minConviction]}
          onValueChange={([v]) => update("minConviction", v)}
          min={0}
          max={100}
          step={5}
          className="flex-1 max-w-[180px]"
        />
        <span className="w-8 text-right font-mono text-[11px] font-bold tabular-nums text-primary">
          {value.minConviction}
        </span>
      </div>

      {/* Sort */}
      <div className="flex items-center gap-1.5">
        <ArrowUpDown className="size-3 text-muted-foreground" />
        <span className="font-mono text-[10px] uppercase text-muted-foreground">Sort</span>
        <PillGroup
          value={value.sortBy}
          onChange={(v) => update("sortBy", v)}
          options={[
            { label: "Conviction", value: "conviction" },
            { label: "R:R", value: "risk_reward" },
          ]}
        />
      </div>

      {/* Count */}
      <div className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="text-primary">{visibleCount}</span> / {totalCount} signals
      </div>
    </div>
  );
}
