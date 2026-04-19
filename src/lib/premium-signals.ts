import { supabase } from "@/integrations/supabase/client";

export interface PremiumSignal {
  symbol: string;
  side: "long" | "short";
  conviction: number;
  timeframe: "intraday" | "swing" | "position";
  leverage: number;
  entry_low: number;
  entry_high: number;
  stop: number;
  targets: number[];
  risk_reward: number;
  setup_name: string;
  reasoning: string[];
  invalidation: string;
  catalysts: string;
}

export interface PremiumSignalsResponse {
  generated_at: string;
  market_summary: string;
  signals: PremiumSignal[];
  universe_size: number;
  shortlist_size: number;
}

export async function fetchPremiumSignals(): Promise<PremiumSignalsResponse> {
  const { data, error } = await supabase.functions.invoke("premium-signals", { body: {} });
  if (error) {
    const msg = error.message || "Failed to fetch signals";
    if (msg.includes("429")) throw new Error("Rate limit hit. Wait a moment.");
    if (msg.includes("402")) throw new Error("AI credits exhausted.");
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
