import { useCallback, useEffect, useState } from "react";

const KEY = "cryptodesk:favorites";

function read(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

/** Cross-tab + cross-component favorites synced via localStorage + a custom event. */
export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(() => read());

  useEffect(() => {
    const sync = () => setFavorites(read());
    window.addEventListener("storage", sync);
    window.addEventListener("cryptodesk:favorites-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("cryptodesk:favorites-changed", sync);
    };
  }, []);

  const persist = (next: Set<string>) => {
    window.localStorage.setItem(KEY, JSON.stringify([...next]));
    window.dispatchEvent(new Event("cryptodesk:favorites-changed"));
    setFavorites(next);
  };

  const toggle = useCallback((symbol: string) => {
    const next = new Set(read());
    if (next.has(symbol)) next.delete(symbol);
    else next.add(symbol);
    persist(next);
  }, []);

  const isFavorite = useCallback((symbol: string) => favorites.has(symbol), [favorites]);

  return { favorites, toggle, isFavorite, count: favorites.size };
}
