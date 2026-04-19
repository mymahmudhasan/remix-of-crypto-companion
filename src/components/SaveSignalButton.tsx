import { useState } from "react";
import { Bookmark, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { plansClient, SAVED_PLANS_TABLE } from "@/lib/plans-client";
import { getClientId } from "@/lib/client-id";
import { cn } from "@/lib/utils";
import type { PremiumSignal } from "@/lib/premium-signals";

interface Props {
  signal: PremiumSignal;
}

export function SaveSignalButton({ signal }: Props) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  const save = async () => {
    setState("saving");
    try {
      const entryPrice = (signal.entry_low + signal.entry_high) / 2;
      const planJson = {
        conviction: signal.conviction,
        entry: { low: signal.entry_low, high: signal.entry_high },
        stop: signal.stop,
        targets: signal.targets,
        riskPct: 1,
        rationale: signal.reasoning,
        invalidations: [signal.invalidation],
        summary: `${signal.setup_name} — ${signal.catalysts}`,
        indicatorBreakdown: [],
        multiTimeframe: [],
        scenarios: { bullCase: "", bearCase: "", keyLevel: signal.stop, keyLevelNote: signal.invalidation },
        timeHorizon: signal.timeframe,
      };
      const { error } = await plansClient.from(SAVED_PLANS_TABLE).insert({
        client_id: getClientId(),
        mode: "futures",
        symbol: signal.symbol,
        interval: "1h",
        side: signal.side,
        action: signal.setup_name,
        leverage: signal.leverage,
        entry_low: signal.entry_low,
        entry_high: signal.entry_high,
        stop: signal.stop,
        targets: signal.targets,
        conviction: signal.conviction,
        risk_pct: 1,
        entry_price: entryPrice,
        plan: planJson as any,
        notes: `Premium Signal · ${signal.catalysts}`,
      } as any);
      if (error) throw error;
      setState("saved");
      toast.success("Signal saved", { description: `${signal.symbol} ${signal.side.toUpperCase()} added to journal` });
      setTimeout(() => setState("idle"), 2200);
    } catch (e: any) {
      setState("idle");
      toast.error("Could not save", { description: e.message });
    }
  };

  return (
    <button
      onClick={save}
      disabled={state !== "idle"}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded border py-1.5 px-2.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-70",
        state === "saved"
          ? "border-bull bg-bull/10 text-bull"
          : "border-primary/60 bg-primary/10 text-primary hover:bg-primary/20"
      )}
    >
      {state === "saving" ? <><Loader2 className="size-3 animate-spin" /> Saving</>
        : state === "saved" ? <><Check className="size-3" /> Saved</>
        : <><Bookmark className="size-3" /> Save</>}
    </button>
  );
}
