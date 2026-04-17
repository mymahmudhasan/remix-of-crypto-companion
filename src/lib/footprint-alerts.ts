// Helpers for the footprint alert watcher: storage, dedupe, permission.
import type { Footprint, FootprintType } from "@/lib/footprints";

const ENABLED_KEY = "cryptodesk:fp-alerts-enabled";
const SEEN_KEY = "cryptodesk:fp-alerts-seen";
const SEEN_TTL_MS = 6 * 60 * 60 * 1000; // 6h — re-alert if same footprint persists

/** Footprint types we treat as high-conviction and worth interrupting the user for. */
export const ALERT_TYPES: FootprintType[] = [
  "liquidity_sweep_high",
  "liquidity_sweep_low",
  "oi_long_squeeze",
  "oi_short_squeeze",
  "volume_spike", // gated by volume ratio extracted from detail string
];

export function alertsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ENABLED_KEY) === "1";
}

export function setAlertsEnabled(v: boolean) {
  window.localStorage.setItem(ENABLED_KEY, v ? "1" : "0");
  window.dispatchEvent(new Event("cryptodesk:fp-alerts-changed"));
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted" || Notification.permission === "denied") return Notification.permission;
  return Notification.requestPermission();
}

interface SeenMap { [key: string]: number }

function loadSeen(): SeenMap {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as SeenMap;
    const now = Date.now();
    // GC stale entries
    for (const k of Object.keys(obj)) if (now - obj[k] > SEEN_TTL_MS) delete obj[k];
    return obj;
  } catch { return {}; }
}

function saveSeen(map: SeenMap) {
  try { window.localStorage.setItem(SEEN_KEY, JSON.stringify(map)); } catch {}
}

/** Has this exact footprint already been alerted within TTL? */
export function shouldAlert(symbol: string, fp: Footprint): boolean {
  const key = `${symbol}:${fp.type}:${fp.index}:${fp.time}`;
  const seen = loadSeen();
  if (seen[key]) return false;
  seen[key] = Date.now();
  saveSeen(seen);
  return true;
}

/** Filter footprints to only the alert-worthy high-weight ones. */
export function filterAlertWorthy(fps: Footprint[]): Footprint[] {
  return fps.filter((f) => {
    if (!ALERT_TYPES.includes(f.type)) return false;
    if (f.weight < 4) return false;
    if (f.type === "volume_spike") {
      // detail format: "{N}× avg volume on a {color} bar"
      const m = /^([\d.]+)×/.exec(f.detail);
      const ratio = m ? parseFloat(m[1]) : 0;
      if (ratio < 3) return false;
    }
    return true;
  });
}

export function fireNotification(symbol: string, fp: Footprint) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification(`${symbol} · ${fp.label}`, {
      body: fp.detail,
      tag: `cryptodesk-${symbol}-${fp.type}`,
      icon: "/favicon.ico",
      silent: false,
    });
    n.onclick = () => {
      window.focus();
      window.location.href = `/smart-money?symbol=${symbol}`;
      n.close();
    };
  } catch {}
}
