/**
 * Price-level alert helpers — fires browser notification + sound when a saved
 * plan's entry zone, stop, or any take-profit gets crossed.
 *
 * State is per-plan-id, persisted in localStorage so we don't re-fire the same
 * alert on every poll tick.
 */

const ENABLED_KEY = "cryptodesk:price-alerts-enabled";
const SEEN_KEY = "cryptodesk:price-alerts-seen";
const SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type AlertKind = "entry" | "stop" | "tp1" | "tp2" | "tp3" | "tp4";

export function priceAlertsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ENABLED_KEY) === "1";
}

export function setPriceAlertsEnabled(v: boolean) {
  window.localStorage.setItem(ENABLED_KEY, v ? "1" : "0");
  window.dispatchEvent(new Event("cryptodesk:price-alerts-changed"));
}

interface SeenMap { [key: string]: number }

function loadSeen(): SeenMap {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as SeenMap;
    const now = Date.now();
    for (const k of Object.keys(obj)) if (now - obj[k] > SEEN_TTL_MS) delete obj[k];
    return obj;
  } catch { return {}; }
}

function saveSeen(map: SeenMap) {
  try { window.localStorage.setItem(SEEN_KEY, JSON.stringify(map)); } catch {}
}

export function shouldAlert(planId: string, kind: AlertKind): boolean {
  const key = `${planId}:${kind}`;
  const seen = loadSeen();
  if (seen[key]) return false;
  seen[key] = Date.now();
  saveSeen(seen);
  return true;
}

/** Plays a short tone via Web Audio (no asset file needed). */
export function playAlertSound(kind: AlertKind) {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    // Different pitches for different events
    o.type = "sine";
    o.frequency.value = kind === "stop" ? 220 : kind === "entry" ? 660 : 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    o.start();
    o.stop(ctx.currentTime + 0.45);
  } catch {}
}

interface FireArgs {
  planId: string;
  kind: AlertKind;
  symbol: string;
  side: "long" | "short";
  price: number;
  level: number;
}

export function fireBrowserNotification({ planId, kind, symbol, side, price, level }: FireArgs) {
  const verb =
    kind === "entry" ? "Entry zone hit"
    : kind === "stop" ? "⚠ STOP LOSS hit"
    : `${kind.toUpperCase()} take-profit hit`;
  const title = `${symbol.replace("USDT", "/USDT")} · ${verb}`;
  const body = `${side.toUpperCase()} · price $${price.toFixed(price < 1 ? 6 : 2)} crossed level $${level.toFixed(level < 1 ? 6 : 2)}`;
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, {
        body,
        tag: `pl:${planId}:${kind}`,
        icon: "/placeholder.svg",
      });
    }
  } catch {}
  playAlertSound(kind);
}

/**
 * Decide which alert kinds (if any) just fired given the latest price.
 * `prevPrice` is the price observed on the previous tick; we only alert on a
 * fresh crossing (prev on one side, current on the other).
 */
export function detectCrossings(args: {
  side: "long" | "short";
  prev: number;
  curr: number;
  entryLow: number;
  entryHigh: number;
  stop: number;
  targets: number[];
}): { kind: AlertKind; level: number }[] {
  const fired: { kind: AlertKind; level: number }[] = [];
  if (!isFinite(args.prev) || !isFinite(args.curr) || args.prev <= 0 || args.curr <= 0) return fired;

  // Entry zone: alert when price first enters the [low, high] band.
  const inZoneNow = args.curr >= args.entryLow && args.curr <= args.entryHigh;
  const inZonePrev = args.prev >= args.entryLow && args.prev <= args.entryHigh;
  if (inZoneNow && !inZonePrev) {
    fired.push({ kind: "entry", level: (args.entryLow + args.entryHigh) / 2 });
  }

  // Stop: long → price falls under stop · short → price rises above stop.
  if (args.side === "long") {
    if (args.prev > args.stop && args.curr <= args.stop) fired.push({ kind: "stop", level: args.stop });
  } else {
    if (args.prev < args.stop && args.curr >= args.stop) fired.push({ kind: "stop", level: args.stop });
  }

  // Targets
  args.targets.slice(0, 4).forEach((t, i) => {
    const kind = (`tp${i + 1}` as AlertKind);
    if (args.side === "long") {
      if (args.prev < t && args.curr >= t) fired.push({ kind, level: t });
    } else {
      if (args.prev > t && args.curr <= t) fired.push({ kind, level: t });
    }
  });

  return fired;
}
