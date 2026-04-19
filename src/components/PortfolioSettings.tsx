import { useEffect, useState } from "react";
import { Briefcase, Plus, Trash2, X, Save } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import {
  loadPortfolio, savePortfolio, totalExposure, SECTORS,
  type Holding, type PortfolioState,
} from "@/lib/portfolio";
import { cn } from "@/lib/utils";

const HoldingSchema = z.object({
  symbol: z.string().trim().regex(/^[A-Z0-9]{2,15}USDT$/, "Use BASE+USDT (e.g. BTCUSDT)"),
  sizeUsd: z.number().min(0).max(1_000_000_000),
  sector: z.enum(["L1", "L2", "DeFi", "AI", "Meme", "Stable", "Other"]).optional(),
});

const PortfolioSchema = z.object({
  accountSize: z.number().min(0).max(1_000_000_000),
  holdings: z.array(HoldingSchema).max(50),
});

/** Compact button + dialog for managing the manual portfolio (localStorage). */
export function PortfolioSettings() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PortfolioState>(() => loadPortfolio());
  const [draft, setDraft] = useState<{ symbol: string; sizeUsd: string; sector: Holding["sector"] | "" }>({
    symbol: "", sizeUsd: "", sector: "",
  });

  useEffect(() => { if (open) setState(loadPortfolio()); }, [open]);

  const total = totalExposure(state);
  const count = state.holdings.length;

  const addHolding = () => {
    const sym = draft.symbol.trim().toUpperCase();
    const size = Number(draft.sizeUsd);
    const parsed = HoldingSchema.safeParse({
      symbol: sym.endsWith("USDT") ? sym : sym + "USDT",
      sizeUsd: size,
      sector: draft.sector || undefined,
    });
    if (!parsed.success) {
      const first = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
      toast.error(first || "Invalid holding");
      return;
    }
    if (state.holdings.some((h) => h.symbol === parsed.data.symbol)) {
      toast.error(`${parsed.data.symbol} already in portfolio`);
      return;
    }
    setState({ ...state, holdings: [...state.holdings, parsed.data] });
    setDraft({ symbol: "", sizeUsd: "", sector: "" });
  };

  const removeHolding = (sym: string) => {
    setState({ ...state, holdings: state.holdings.filter((h) => h.symbol !== sym) });
  };

  const save = () => {
    const parsed = PortfolioSchema.safeParse(state);
    if (!parsed.success) {
      toast.error("Invalid portfolio data");
      return;
    }
    savePortfolio(parsed.data);
    toast.success("Portfolio saved", { description: `${parsed.data.holdings.length} holdings · $${totalExposure(parsed.data).toFixed(0)} exposure` });
    setOpen(false);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Manage portfolio (used by Pro Analysis)"
        className={cn(
          "hidden items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors md:flex",
          count > 0
            ? "border-primary/50 bg-primary/10 text-primary"
            : "border-border text-muted-foreground hover:border-primary hover:text-primary"
        )}
      >
        <Briefcase className="size-3" />
        Portfolio · {count > 0 ? `${count}` : "0"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="panel max-h-[90vh] w-full max-w-2xl overflow-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Briefcase className="size-4 text-primary" />
                <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-primary">
                  Portfolio Settings
                </h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="mb-3 font-mono text-[11px] text-muted-foreground">
              Used by Pro Analysis to weigh setups against your real exposure (correlation, sector concentration, total risk).
              Stored locally on this device only.
            </p>

            {/* Account size */}
            <div className="mb-3 panel p-3">
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Account size (USD)
              </label>
              <input
                type="number"
                min="0"
                step="100"
                value={state.accountSize}
                onChange={(e) => setState({ ...state, accountSize: Math.max(0, Number(e.target.value) || 0) })}
                className="w-full rounded border border-border bg-surface-elevated px-2 py-1.5 font-mono text-sm tabular-nums focus:border-primary focus:outline-none"
              />
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                Total capital (cash + crypto) — used for position-sizing math.
              </p>
            </div>

            {/* Add holding */}
            <div className="mb-3 panel p-3">
              <h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">
                Add holding
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_120px_auto]">
                <input
                  type="text"
                  placeholder="BTC or BTCUSDT"
                  value={draft.symbol}
                  onChange={(e) => setDraft({ ...draft, symbol: e.target.value.toUpperCase() })}
                  className="rounded border border-border bg-surface-elevated px-2 py-1.5 font-mono text-xs uppercase focus:border-primary focus:outline-none"
                />
                <input
                  type="number"
                  min="0"
                  placeholder="USD size"
                  value={draft.sizeUsd}
                  onChange={(e) => setDraft({ ...draft, sizeUsd: e.target.value })}
                  className="rounded border border-border bg-surface-elevated px-2 py-1.5 font-mono text-xs tabular-nums focus:border-primary focus:outline-none"
                />
                <select
                  value={draft.sector || ""}
                  onChange={(e) => setDraft({ ...draft, sector: (e.target.value || "") as Holding["sector"] | "" })}
                  className="rounded border border-border bg-surface-elevated px-2 py-1.5 font-mono text-xs focus:border-primary focus:outline-none"
                >
                  <option value="">Sector…</option>
                  {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button
                  onClick={addHolding}
                  className="flex items-center justify-center gap-1 rounded border border-bull/40 bg-bull/10 px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-bull hover:bg-bull/20"
                >
                  <Plus className="size-3" /> Add
                </button>
              </div>
            </div>

            {/* List */}
            <div className="mb-3 panel p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">
                  Holdings · {count}
                </h3>
                <span className="font-mono text-[10px] text-muted-foreground">
                  Total exposure ${total.toFixed(0)}
                </span>
              </div>
              {count === 0 ? (
                <p className="py-4 text-center font-mono text-[11px] text-muted-foreground">
                  No holdings yet — add some to get portfolio-aware analysis.
                </p>
              ) : (
                <div className="space-y-1">
                  {state.holdings.map((h) => {
                    const pct = total > 0 ? (h.sizeUsd / total) * 100 : 0;
                    return (
                      <div key={h.symbol} className="flex items-center gap-2 rounded border border-border bg-surface-elevated p-2">
                        <span className="font-mono text-xs font-bold">{h.symbol.replace("USDT", "")}</span>
                        {h.sector && (
                          <span className="rounded border border-border bg-surface px-1 py-px font-mono text-[9px] uppercase text-muted-foreground">
                            {h.sector}
                          </span>
                        )}
                        <span className="ml-auto font-mono text-xs tabular-nums">${h.sizeUsd.toFixed(0)}</span>
                        <span className="w-12 text-right font-mono text-[10px] text-muted-foreground tabular-nums">{pct.toFixed(1)}%</span>
                        <button
                          onClick={() => removeHolding(h.symbol)}
                          className="rounded p-1 text-bear hover:bg-bear/10"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="rounded border border-border bg-surface-elevated px-3 py-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={save}
                className="flex items-center gap-1.5 rounded border border-primary/50 bg-primary/10 px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-primary hover:bg-primary/20"
              >
                <Save className="size-3" /> Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
