/**
 * Manual portfolio store (localStorage).
 * Holdings are { symbol, sizeUsd, sector? } — used by Pro Analysis to weigh
 * new setups against current exposure (correlation, sector, total risk).
 */

const KEY = "cryptodesk:portfolio:v1";
const ACCT_KEY = "cryptodesk:portfolio-account:v1";
const EVT = "cryptodesk:portfolio-changed";

export interface Holding {
  /** Binance pair symbol e.g. BTCUSDT */
  symbol: string;
  /** USD allocation */
  sizeUsd: number;
  /** Optional rough sector tag */
  sector?: "L1" | "L2" | "DeFi" | "AI" | "Meme" | "Stable" | "Other";
}

export interface PortfolioState {
  accountSize: number;
  holdings: Holding[];
}

export const SECTORS: Holding["sector"][] = ["L1", "L2", "DeFi", "AI", "Meme", "Stable", "Other"];

export function loadPortfolio(): PortfolioState {
  if (typeof window === "undefined") return { accountSize: 1000, holdings: [] };
  try {
    const accountSize = Number(window.localStorage.getItem(ACCT_KEY)) || 1000;
    const raw = window.localStorage.getItem(KEY);
    const holdings: Holding[] = raw ? JSON.parse(raw) : [];
    return { accountSize, holdings: Array.isArray(holdings) ? holdings : [] };
  } catch {
    return { accountSize: 1000, holdings: [] };
  }
}

export function savePortfolio(state: PortfolioState) {
  try {
    window.localStorage.setItem(ACCT_KEY, String(Math.max(0, state.accountSize)));
    window.localStorage.setItem(KEY, JSON.stringify(state.holdings));
    window.dispatchEvent(new Event(EVT));
  } catch {}
}

export function onPortfolioChange(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Total portfolio USD exposure (sum of sizeUsd). */
export function totalExposure(state: PortfolioState): number {
  return state.holdings.reduce((s, h) => s + (h.sizeUsd || 0), 0);
}

/** Weight (0–1) of a single holding within total. */
export function weightOf(state: PortfolioState, symbol: string): number {
  const total = totalExposure(state);
  if (total <= 0) return 0;
  const h = state.holdings.find((x) => x.symbol === symbol);
  return h ? (h.sizeUsd || 0) / total : 0;
}

/** Compact text representation suitable for sending as AI context. */
export function portfolioContext(state: PortfolioState): string {
  if (state.holdings.length === 0) {
    return `Account: $${state.accountSize.toLocaleString()}. Holdings: none configured (treat as cash-only).`;
  }
  const total = totalExposure(state);
  const lines = state.holdings.map((h) => {
    const pct = total > 0 ? ((h.sizeUsd / total) * 100).toFixed(1) : "0";
    return `  · ${h.symbol.replace("USDT", "")}: $${h.sizeUsd.toFixed(0)} (${pct}%)${h.sector ? ` [${h.sector}]` : ""}`;
  });
  return `Account: $${state.accountSize.toLocaleString()} · Crypto exposure: $${total.toFixed(0)}\nHoldings:\n${lines.join("\n")}`;
}
