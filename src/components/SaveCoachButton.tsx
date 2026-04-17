import { useState } from "react";
import { Bookmark, Check, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { plansClient, SAVED_PLANS_TABLE } from "@/lib/plans-client";
import { getClientId } from "@/lib/client-id";
import { snapshotChart } from "@/lib/snapshot-chart";
import { cn } from "@/lib/utils";

/** The coach object returned by the trade-coach edge function. */
export interface CoachPayload {
  verdict: "GO" | "WAIT" | "SKIP";
  side: "long" | "short" | "neutral";
  confidence: number;
  headline: string;
  checklist: { item: string; status: "pass" | "warn" | "fail"; weight: number; note: string }[];
  playbook: { step: number; title: string; action: string; price?: number }[];
  levels: {
    entryLow: number;
    entryHigh: number;
    stop: number;
    targets: number[];
    leverage?: number;
    riskPct: number;
  };
  invalidation: string;
  skipReasons: string[];
}

interface Props {
  mode: "spot" | "futures";
  symbol: string;
  interval: string;
  entryPrice: number;
  coach: CoachPayload;
  /** Ref-style getter for the chart container so we can capture the canvas at click time. */
  getChartEl: () => HTMLElement | null;
}

export function SaveCoachButton({ mode, symbol, interval, entryPrice, coach, getChartEl }: Props) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setState("saving"); setErr(null);
    try {
      const snapshot = await snapshotChart(getChartEl());
      // For WAIT / SKIP we still persist the levels, but mark status="cancelled"
      // so the Journal's auto-resolve loop ignores it (TP1/Stop hits don't count
      // for setups the coach told us NOT to take).
      const status = coach.verdict === "GO" ? "open" : "cancelled";
      const { error } = await plansClient.from(SAVED_PLANS_TABLE).insert({
        client_id: getClientId(),
        mode,
        symbol,
        interval,
        side: coach.side,
        action: coach.verdict, // GO / WAIT / SKIP
        leverage: coach.levels.leverage ?? null,
        entry_low: coach.levels.entryLow,
        entry_high: coach.levels.entryHigh,
        stop: coach.levels.stop,
        targets: coach.levels.targets,
        conviction: coach.confidence,
        risk_pct: coach.levels.riskPct,
        entry_price: entryPrice,
        plan: { kind: "coach", ...coach } as any,
        chart_snapshot: snapshot,
        status,
      } as any);
      if (error) throw error;
      setState("saved");
      toast.success(`${coach.verdict} setup saved`, {
        description: `${symbol} · ${coach.side.toUpperCase()} added to your journal`,
      });
      setTimeout(() => setState("idle"), 2200);
    } catch (e: any) {
      setState("error");
      setErr(e.message || "Save failed");
      toast.error("Could not save setup", { description: e.message });
    }
  };

  const verdictCls = coach.verdict === "GO"
    ? "border-bull/60 bg-bull/10 text-bull hover:bg-bull/20"
    : coach.verdict === "WAIT"
    ? "border-warning/60 bg-warning/10 text-warning hover:bg-warning/20"
    : "border-bear/60 bg-bear/10 text-bear hover:bg-bear/20";

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={save}
        disabled={state === "saving" || state === "saved"}
        className={cn(
          "flex items-center justify-center gap-2 rounded-md border px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-70",
          state === "saved" ? "border-bull bg-bull/10 text-bull" : verdictCls
        )}
      >
        {state === "saving" ? (
          <><Loader2 className="size-3.5 animate-spin" /> Saving…</>
        ) : state === "saved" ? (
          <><Check className="size-3.5" /> Saved to Journal</>
        ) : (
          <><Bookmark className="size-3.5" /> Save {coach.verdict} Setup</>
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
