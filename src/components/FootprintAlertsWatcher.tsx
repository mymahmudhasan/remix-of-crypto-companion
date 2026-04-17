import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, BellRing, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useFavorites } from "@/hooks/use-favorites";
import { fetchKlines } from "@/lib/binance";
import {
  detectCandleFootprints, detectFuturesFootprints, fetchOIHistory, fetchFundingRate,
} from "@/lib/footprints";
import {
  alertsEnabled, setAlertsEnabled, requestNotificationPermission, notificationPermission,
  filterAlertWorthy, shouldAlert, fireNotification,
} from "@/lib/footprint-alerts";
import { cn } from "@/lib/utils";

const SCAN_INTERVAL_MS = 90_000; // every 90s
const SCAN_INTERVAL_TF = "15m";  // resolution of footprint detection
const KLINE_LIMIT = 80;

/** Tiny header pill: toggles alerts and shows current state. Mounted once in AppLayout. */
export function FootprintAlertsWatcher() {
  const { favorites } = useFavorites();
  const [enabled, setEnabled] = useState<boolean>(() => alertsEnabled());
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(() => notificationPermission());
  const tickRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  // Sync with cross-tab toggles
  useEffect(() => {
    const onChange = () => setEnabled(alertsEnabled());
    window.addEventListener("cryptodesk:fp-alerts-changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("cryptodesk:fp-alerts-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  // The actual scan loop.
  useEffect(() => {
    if (!enabled || perm !== "granted" || favorites.size === 0) return;

    const scan = async () => {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        const symbols = [...favorites];
        for (const symbol of symbols) {
          try {
            const candles = await fetchKlines(symbol, SCAN_INTERVAL_TF, KLINE_LIMIT);
            if (!candles || candles.length < 30) continue;

            const candleFps = detectCandleFootprints(candles, { lookback: 20 });

            // Try futures-only footprints; ignore failures (symbol may be spot-only)
            let futsFps: ReturnType<typeof detectFuturesFootprints> = [];
            try {
              const [oi, fr] = await Promise.all([
                fetchOIHistory(symbol, "15m", 20).catch(() => null),
                fetchFundingRate(symbol).catch(() => null),
              ]);
              futsFps = detectFuturesFootprints(candles, { oiHistory: oi ?? undefined, fundingRate: fr });
            } catch {}

            const alertWorthy = filterAlertWorthy([...candleFps, ...futsFps]);
            for (const fp of alertWorthy) {
              if (!shouldAlert(symbol, fp)) continue;
              fireNotification(symbol, fp);
            }
          } catch {
            // network blip on a single symbol — keep scanning the rest
          }
        }
      } finally {
        runningRef.current = false;
      }
    };

    // Run immediately, then every interval.
    scan();
    tickRef.current = window.setInterval(scan, SCAN_INTERVAL_MS);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [enabled, perm, favorites]);

  const toggle = async () => {
    if (perm === "unsupported") {
      toast.error("Notifications not supported in this browser");
      return;
    }
    if (!enabled) {
      // Enabling: ensure permission first
      const result = await requestNotificationPermission();
      setPerm(result);
      if (result !== "granted") {
        toast.error("Notification permission denied", {
          description: "Enable notifications in your browser settings to receive footprint alerts.",
        });
        return;
      }
      setAlertsEnabled(true);
      setEnabled(true);
      toast.success("Footprint alerts enabled", {
        description: favorites.size === 0
          ? "Star symbols on Scanner or Smart Money to start watching."
          : `Watching ${favorites.size} favorite${favorites.size === 1 ? "" : "s"} every 90s.`,
      });
    } else {
      setAlertsEnabled(false);
      setEnabled(false);
      toast.message("Footprint alerts disabled");
    }
  };

  const Icon = perm === "denied" ? AlertCircle : enabled ? BellRing : Bell;
  const label = perm === "unsupported"
    ? "N/A"
    : perm === "denied"
    ? "Blocked"
    : enabled
    ? `Alerts · ${favorites.size}`
    : "Alerts";

  return (
    <button
      onClick={toggle}
      title={
        perm === "unsupported"
          ? "Browser does not support notifications"
          : perm === "denied"
          ? "Notifications blocked — enable in browser settings"
          : enabled
          ? `Watching ${favorites.size} favorite${favorites.size === 1 ? "" : "s"} for high-conviction footprints (sweeps, OI squeezes, 3×+ volume spikes)`
          : "Click to enable browser alerts for footprints on your favorited symbols"
      }
      className={cn(
        "hidden items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors md:flex",
        perm === "denied"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : enabled
          ? "border-bull/50 bg-bull/10 text-bull animate-pulse-glow"
          : "border-border text-muted-foreground hover:border-primary hover:text-primary"
      )}
    >
      <Icon className="size-3" />
      {label}
      {enabled && favorites.size === 0 && (
        <span className="ml-1 rounded bg-warning/20 px-1 py-px text-[8px] text-warning">no favs</span>
      )}
    </button>
  );
}
