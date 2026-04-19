import { useEffect, useRef, useState } from "react";
import { Bell, BellRing, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { plansClient, SAVED_PLANS_TABLE } from "@/lib/plans-client";
import { subscribeMiniTickers } from "@/lib/binance";
import {
  priceAlertsEnabled, setPriceAlertsEnabled, detectCrossings,
  fireBrowserNotification, shouldAlert,
} from "@/lib/price-alerts";
import {
  notificationPermission, requestNotificationPermission,
} from "@/lib/footprint-alerts";
import { cn } from "@/lib/utils";

interface OpenPlan {
  id: string;
  symbol: string;
  side: "long" | "short";
  entry_low: number;
  entry_high: number;
  stop: number;
  targets: number[];
}

const REFRESH_PLANS_MS = 60_000;

/** Header pill — when ON, polls Binance ticker stream for all open plans and
 * fires browser notifications + sound on entry/SL/TP crossings. */
export function PriceAlertsWatcher() {
  const [enabled, setEnabled] = useState<boolean>(() => priceAlertsEnabled());
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(() => notificationPermission());
  const [plans, setPlans] = useState<OpenPlan[]>([]);
  const prevPriceRef = useRef<Record<string, number>>({});

  // Cross-tab toggle sync
  useEffect(() => {
    const onChange = () => setEnabled(priceAlertsEnabled());
    window.addEventListener("cryptodesk:price-alerts-changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("cryptodesk:price-alerts-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  // Periodically refresh open plans
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      const { data, error } = await plansClient
        .from(SAVED_PLANS_TABLE)
        .select("id,symbol,side,entry_low,entry_high,stop,targets,status")
        .eq("status", "open")
        .limit(200);
      if (cancelled || error || !data) return;
      const open: OpenPlan[] = data
        .filter((r: any) => r.side === "long" || r.side === "short")
        .map((r: any) => ({
          id: r.id, symbol: r.symbol, side: r.side,
          entry_low: r.entry_low, entry_high: r.entry_high,
          stop: r.stop, targets: r.targets || [],
        }));
      setPlans(open);
    };
    load();
    const t = window.setInterval(load, REFRESH_PLANS_MS);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [enabled]);

  // Subscribe to mini ticker stream for open-plan symbols
  useEffect(() => {
    if (!enabled || perm !== "granted" || plans.length === 0) return;
    const symbols = Array.from(new Set(plans.map((p) => p.symbol)));
    const unsub = subscribeMiniTickers(symbols, (t) => {
      const sym = t.symbol;
      const curr = t.price;
      const prev = prevPriceRef.current[sym];
      if (typeof prev === "number") {
        for (const p of plans.filter((x) => x.symbol === sym)) {
          const fired = detectCrossings({
            side: p.side, prev, curr,
            entryLow: p.entry_low, entryHigh: p.entry_high,
            stop: p.stop, targets: p.targets,
          });
          for (const f of fired) {
            if (!shouldAlert(p.id, f.kind)) continue;
            fireBrowserNotification({
              planId: p.id, kind: f.kind, symbol: p.symbol, side: p.side,
              price: curr, level: f.level,
            });
            toast.message(
              `${p.symbol.replace("USDT", "/USDT")} · ${f.kind.toUpperCase()}`,
              { description: `${p.side.toUpperCase()} hit @ $${curr.toFixed(curr < 1 ? 6 : 2)}` },
            );
          }
        }
      }
      prevPriceRef.current[sym] = curr;
    });
    return () => unsub();
  }, [enabled, perm, plans]);

  const toggle = async () => {
    if (perm === "unsupported") {
      toast.error("Notifications not supported in this browser");
      return;
    }
    if (!enabled) {
      const result = await requestNotificationPermission();
      setPerm(result);
      if (result !== "granted") {
        toast.error("Notification permission denied");
        return;
      }
      setPriceAlertsEnabled(true);
      setEnabled(true);
      toast.success("Price alerts enabled", {
        description: "You'll be notified when entry, stop, or TP levels are hit on saved plans.",
      });
    } else {
      setPriceAlertsEnabled(false);
      setEnabled(false);
      toast.message("Price alerts disabled");
    }
  };

  const Icon = perm === "denied" ? AlertCircle : enabled ? BellRing : Bell;
  const label = perm === "unsupported"
    ? "N/A"
    : perm === "denied"
    ? "Blocked"
    : enabled
    ? `Levels · ${plans.length}`
    : "Levels";

  return (
    <button
      onClick={toggle}
      title={
        enabled
          ? `Watching ${plans.length} open plan${plans.length === 1 ? "" : "s"} for entry / SL / TP hits`
          : "Click to enable browser notifications when your saved plans hit entry, stop, or take-profit"
      }
      className={cn(
        "hidden items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors md:flex",
        perm === "denied"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : enabled
          ? "border-warning/50 bg-warning/10 text-warning animate-pulse-glow"
          : "border-border text-muted-foreground hover:border-primary hover:text-primary"
      )}
    >
      <Icon className="size-3" />
      {label}
    </button>
  );
}
