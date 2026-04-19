import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { toast } from "sonner";
import {
  ALERT_THRESHOLD,
  getAlertsEnabled,
  notificationPermission,
  playAlertSound,
  requestNotificationPermission,
  setAlertsEnabled,
} from "@/lib/signal-alerts";
import { cn } from "@/lib/utils";

export function SignalAlertsToggle() {
  const [enabled, setEnabled] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setEnabled(getAlertsEnabled());
    setPerm(notificationPermission());
  }, []);

  const handleToggle = async () => {
    if (enabled) {
      setAlertsEnabled(false);
      setEnabled(false);
      toast.info("High-conviction alerts disabled");
      return;
    }
    // Turning ON
    if (perm === "unsupported") {
      toast.error("Notifications not supported in this browser");
      return;
    }
    let granted = perm === "granted";
    if (!granted) {
      granted = await requestNotificationPermission();
      setPerm(notificationPermission());
    }
    if (!granted) {
      toast.error("Notification permission denied. Enable it in browser settings.");
      return;
    }
    setAlertsEnabled(true);
    setEnabled(true);
    playAlertSound();
    toast.success(`Alerts ON · pings on conviction ≥ ${ALERT_THRESHOLD}`);
  };

  const Icon = enabled ? BellRing : perm === "denied" ? BellOff : Bell;

  return (
    <button
      onClick={handleToggle}
      title={
        enabled
          ? `Alerts ON — fires for new signals with conviction ≥ ${ALERT_THRESHOLD}`
          : `Alerts OFF — click to enable browser notifications + sound for conviction ≥ ${ALERT_THRESHOLD}`
      }
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all",
        enabled
          ? "border-bull/50 bg-bull/10 text-bull glow-bull hover:bg-bull/20"
          : "border-border bg-surface/40 text-muted-foreground hover:border-primary/40 hover:text-primary"
      )}
    >
      <Icon className={cn("size-3", enabled && "animate-pulse")} />
      <span>Alerts {enabled ? "ON" : "OFF"}</span>
      <span className="hidden md:inline opacity-70">· ≥{ALERT_THRESHOLD}</span>
    </button>
  );
}
