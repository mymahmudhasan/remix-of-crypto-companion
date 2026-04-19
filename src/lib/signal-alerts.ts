import type { PremiumSignal } from "@/lib/premium-signals";

const STORAGE_KEY = "signal-alerts-enabled";
const SEEN_KEY = "signal-alerts-seen";
const CONVICTION_THRESHOLD = 80;

export function getAlertsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function setAlertsEnabled(on: boolean) {
  localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const r = await Notification.requestPermission();
  return r === "granted";
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function signalKey(s: PremiumSignal): string {
  // Stable per setup: symbol + side + entry midpoint + stop
  const mid = ((s.entry_low + s.entry_high) / 2).toFixed(6);
  return `${s.symbol}:${s.side}:${mid}:${s.stop.toFixed(6)}`;
}

function loadSeen(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveSeen(set: Set<string>) {
  try {
    // Cap to last 200 keys
    const arr = Array.from(set).slice(-200);
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

/** Plays a short two-tone "ding" using WebAudio (no asset needed). */
export function playAlertSound() {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const tones = [880, 1320];
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.18;
      const end = start + 0.22;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.05);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch {
    /* ignore */
  }
}

function fireNotification(s: PremiumSignal) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const mid = (s.entry_low + s.entry_high) / 2;
    const title = `🔥 ${s.conviction} · ${s.side.toUpperCase()} ${s.symbol.replace("USDT", "/USDT")}`;
    const body = `${s.setup_name} · entry ~${mid.toPrecision(6)} · R:R ${s.risk_reward.toFixed(2)} · ${s.timeframe}`;
    const n = new Notification(title, {
      body,
      tag: signalKey(s),
      icon: "/favicon.ico",
    });
    n.onclick = () => {
      window.focus();
      window.location.href = `/signals`;
      n.close();
    };
  } catch {
    /* ignore */
  }
}

/**
 * Detects new high-conviction signals (≥ threshold) not seen before in this session,
 * fires a browser notification + sound for each, and returns the count fired.
 */
export function processSignalsForAlerts(signals: PremiumSignal[]): number {
  if (!getAlertsEnabled()) return 0;
  const seen = loadSeen();
  const fresh: PremiumSignal[] = [];
  for (const s of signals) {
    if (s.conviction < CONVICTION_THRESHOLD) continue;
    const key = signalKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(s);
  }
  saveSeen(seen);
  if (fresh.length === 0) return 0;

  playAlertSound();
  // Cap notifications to avoid spam: max 3 popups per refresh
  fresh.slice(0, 3).forEach(fireNotification);
  return fresh.length;
}

export const ALERT_THRESHOLD = CONVICTION_THRESHOLD;
