import { useState } from "react";
import { Bookmark, Check, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { plansClient, SAVED_PLANS_TABLE } from "@/lib/plans-client";
import { getClientId } from "@/lib/client-id";
import { snapshotChart } from "@/lib/snapshot-chart";
import type { PlanCommon } from "@/components/PlanDetails";
import { cn } from "@/lib/utils";

interface Props {
  mode: "spot" | "futures";
  symbol: string;
  interval: string;
  side: "long" | "short" | "neutral";
  action?: string;
  leverage?: number;
  entryPrice: number;
  plan: PlanCommon;
  /** Ref-style getter for the chart container so we can capture the canvas at click time. */
  getChartEl: () => HTMLElement | null;
}

export function SavePlanButton({
  mode,
  symbol,
  interval,
  side,
  action,
  leverage,
  entryPrice,
  plan,
  getChartEl,
}: Props) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setState("saving"); setErr(null);
    try {
      const snapshot = await snapshotChart(getChartEl());
      const { error } = await plansClient.from(SAVED_PLANS_TABLE).insert({
        client_id: getClientId(),
        mode,
        symbol,
        interval,
        side,
        action: action ?? null,
        leverage: leverage ?? null,
        entry_low: plan.entry.low,
        entry_high: plan.entry.high,
        stop: plan.stop,
        targets: plan.targets,
        conviction: plan.conviction,
        risk_pct: plan.riskPct,
        entry_price: entryPrice,
        plan: plan as any,
        chart_snapshot: snapshot,
      } as any);
      if (error) throw error;
      setState("saved");
      toast.success("Plan saved", { description: `${symbol} · ${side.toUpperCase()} added to your journal` });
      setTimeout(() => setState("idle"), 2200);
    } catch (e: any) {
      setState("error");
      setErr(e.message || "Save failed");
      toast.error("Could not save plan", { description: e.message });
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={save}
        disabled={state === "saving" || state === "saved"}
        className={cn(
          "flex items-center justify-center gap-2 rounded-md border py-2 font-mono text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-70",
          state === "saved"
            ? "border-bull bg-bull/10 text-bull"
            : "border-primary/60 bg-primary/10 text-primary hover:bg-primary/20"
        )}
      >
        {state === "saving" ? (
          <><Loader2 className="size-3.5 animate-spin" /> Saving…</>
        ) : state === "saved" ? (
          <><Check className="size-3.5" /> Saved to Journal</>
        ) : (
          <><Bookmark className="size-3.5" /> Save Plan</>
        )}
      </button>
      {err && (
        <div className="flex items-start gap-1.5 rounded border border-destructive/30 bg-destructive/10 p-1.5 font-mono text-[10px] text-destructive">
          <AlertCircle className="mt-px size-3 shrink-0" /> {err}
        </div>
      )}
    </div>
  );
}
