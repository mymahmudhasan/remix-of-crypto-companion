import { supabase } from "@/integrations/supabase/client";
import { getClientId } from "@/lib/client-id";
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

export interface PublishResult {
  ok: boolean;
  status?: number;
  response?: unknown;
}

/** Sends the generated post + optional base64 image to the user's private Binance Square endpoint. */
export async function publishSquarePost(
  post: SquarePost,
  imageBase64: string | null,
): Promise<PublishResult> {
  const client_id = getClientId();
  const { data, error } = await supabase.functions.invoke("square-publish", {
    body: {
      post: post.post,
      hashtags: post.hashtags,
      symbol: post.symbol,
      side: post.side,
      coinTag: post.coinTag,
      imageBase64,
      client_id,
    },
    headers: { "x-client-id": client_id },
  });
  if (error) {
    const msg = error.message || "Failed to publish";
    throw new Error(msg);
  }
  if (data?.error) {
    const detail = typeof data.response === "string" ? data.response : JSON.stringify(data.response ?? "");
    throw new Error(`${data.error}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
  return data as PublishResult;
}
