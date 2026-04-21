import { supabase } from "@/integrations/supabase/client";
import type { PremiumSignal } from "@/lib/premium-signals";

export interface SquarePost {
  post: string;
  hashtags: string[];
  wordCount: number;
  coinTag: string;
  symbol: string;
  side: "long" | "short";
}

export async function generateSquarePost(signal: PremiumSignal): Promise<SquarePost> {
  const { data, error } = await supabase.functions.invoke("square-post", { body: { signal } });
  if (error) {
    const msg = error.message || "Failed to generate post";
    if (msg.includes("429")) throw new Error("Rate limit hit. Try again in a moment.");
    if (msg.includes("402")) throw new Error("AI credits exhausted.");
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function fetchSignalForSymbol(symbol: string): Promise<PremiumSignal> {
  const { data, error } = await supabase.functions.invoke("signal-for-symbol", { body: { symbol } });
  if (error) {
    const msg = error.message || "Failed to build signal";
    if (msg.includes("429")) throw new Error("Rate limit hit. Try again in a moment.");
    if (msg.includes("402")) throw new Error("AI credits exhausted.");
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data.signal as PremiumSignal;
}
