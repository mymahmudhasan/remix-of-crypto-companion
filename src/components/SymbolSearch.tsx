import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { fetchExchangeInfo, type ExchangeSymbol } from "@/lib/binance";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onSelect: (symbol: string) => void;
  className?: string;
}

/** Searchable symbol picker. Loads Binance exchangeInfo once and filters client-side. */
export function SymbolSearch({ value, onSelect, className }: Props) {
  const [all, setAll] = useState<ExchangeSymbol[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchExchangeInfo().then(setAll).catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Cmd/Ctrl+K to focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toUpperCase();
    const usdtFirst = (a: ExchangeSymbol, b: ExchangeSymbol) => {
      const aU = a.quoteAsset === "USDT" ? 0 : 1;
      const bU = b.quoteAsset === "USDT" ? 0 : 1;
      if (aU !== bU) return aU - bU;
      return a.symbol.localeCompare(b.symbol);
    };
    if (!q) {
      return all.filter((s) => s.quoteAsset === "USDT").sort(usdtFirst).slice(0, 50);
    }
    return all
      .filter(
        (s) =>
          s.baseAsset.includes(q) || s.symbol.includes(q) || s.quoteAsset.includes(q)
      )
      .sort((a, b) => {
        // Exact base match first
        const aExact = a.baseAsset === q ? 0 : 1;
        const bExact = b.baseAsset === q ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        // Starts-with next
        const aStart = a.baseAsset.startsWith(q) ? 0 : 1;
        const bStart = b.baseAsset.startsWith(q) ? 0 : 1;
        if (aStart !== bStart) return aStart - bStart;
        return usdtFirst(a, b);
      })
      .slice(0, 50);
  }, [all, query]);

  useEffect(() => {
    setHi(0);
  }, [query]);

  const choose = (s: ExchangeSymbol) => {
    onSelect(s.symbol);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div ref={wrapRef} className={cn("relative w-full", className)}>
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface-elevated px-3 py-2 focus-within:border-primary">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => Math.min(h + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const r = results[hi];
              if (r) choose(r);
            } else if (e.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          placeholder={`Search any symbol — current: ${value} (⌘K)`}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Clear"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-popover shadow-lg scrollbar-thin">
          {results.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              {all.length === 0 ? "Loading symbols…" : "No matches"}
            </div>
          ) : (
            results.map((s, i) => (
              <button
                key={s.symbol}
                onMouseEnter={() => setHi(i)}
                onClick={() => choose(s)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors",
                  i === hi ? "bg-surface-hover" : "hover:bg-surface-hover"
                )}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {s.baseAsset}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    /{s.quoteAsset}
                  </span>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {s.symbol}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
