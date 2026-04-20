// Server-side publisher: posts a generated Binance Square post + base64 chart image
// to the user's private REST endpoint using their stored Bearer token.
// Runs server-side to avoid browser CORS restrictions against the 3rd-party endpoint.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-client-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { post, hashtags, symbol, side, coinTag, imageBase64 } = body ?? {};
    const client_id = req.headers.get("x-client-id") || body?.client_id;

    if (!client_id) return json({ error: "Missing client_id" }, 400);
    if (!post || typeof post !== "string") return json({ error: "post text is required" }, 400);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: settings, error: sErr } = await admin
      .from("square_publisher_settings")
      .select("endpoint_url, api_key, enabled")
      .eq("client_id", client_id)
      .maybeSingle();

    if (sErr) return json({ error: `Settings lookup failed: ${sErr.message}` }, 500);
    if (!settings) return json({ error: "No connection saved. Configure the endpoint & API key first." }, 400);
    if (!settings.endpoint_url || !settings.api_key)
      return json({ error: "Endpoint URL or API key missing. Save them in the connection panel." }, 400);
    if (!settings.enabled)
      return json({ error: "Publishing is paused. Enable the connection to auto-post." }, 400);

    // Build payload — keep it generic so any REST endpoint can consume it.
    const payload = {
      content: post,
      hashtags: Array.isArray(hashtags) ? hashtags : [],
      symbol,
      side,
      coin: coinTag,
      image: imageBase64 ?? null, // data URL or raw base64; caller decides
      source: "lovable-square-queue",
      posted_at: new Date().toISOString(),
    };

    const resp = await fetch(settings.endpoint_url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.api_key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawText = await resp.text();
    let parsed: unknown = rawText;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // leave as text
    }

    if (!resp.ok) {
      console.error("square-publish upstream error:", resp.status, rawText);
      return json(
        { error: `Upstream ${resp.status}`, status: resp.status, response: parsed },
        502,
      );
    }

    return json({ ok: true, status: resp.status, response: parsed });
  } catch (e) {
    console.error("square-publish error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
