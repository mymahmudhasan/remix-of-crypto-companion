import { supabase } from "@/integrations/supabase/client";
import { getClientId } from "@/lib/client-id";

export interface SquareSettings {
  id?: string;
  client_id: string;
  endpoint_url: string | null;
  api_key: string | null;
  enabled: boolean;
  posts_per_window: number;
  window_start_hour: number;
  window_end_hour: number;
  timezone: string;
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
}

const TABLE = "square_publisher_settings";
// The freshly-created table is not yet in the generated types, so we use a loose client.
const db = supabase as any;

const DEFAULTS: Omit<SquareSettings, "client_id"> = {
  endpoint_url: null,
  api_key: null,
  enabled: false,
  posts_per_window: 100,
  window_start_hour: 16,
  window_end_hour: 20,
  timezone: "Asia/Dhaka",
  last_tested_at: null,
  last_test_ok: null,
  last_test_message: null,
};

export async function loadSquareSettings(): Promise<SquareSettings> {
  const client_id = getClientId();
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("client_id", client_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { client_id, ...DEFAULTS };
  return data as SquareSettings;
}

export async function saveSquareSettings(
  patch: Partial<Omit<SquareSettings, "client_id" | "id">>,
): Promise<SquareSettings> {
  const client_id = getClientId();
  const current = await loadSquareSettings();
  const next = { ...current, ...patch, client_id };
  const { data, error } = await db
    .from(TABLE)
    .upsert(next, { onConflict: "client_id" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as SquareSettings;
}

/** Disconnect = clear key + url, force enabled false. */
export async function disconnectSquare(): Promise<SquareSettings> {
  return saveSquareSettings({
    endpoint_url: null,
    api_key: null,
    enabled: false,
    last_test_ok: null,
    last_test_message: null,
    last_tested_at: null,
  });
}

/** Quick connectivity test — fires an OPTIONS-ish probe through fetch. */
export async function testSquareConnection(
  endpoint_url: string,
  api_key: string,
): Promise<{ ok: boolean; message: string }> {
  if (!endpoint_url) return { ok: false, message: "Endpoint URL is empty" };
  if (!api_key) return { ok: false, message: "API key is empty" };
  try {
    // Best-effort HEAD; many endpoints reject HEAD but still confirm reachability via status code.
    const r = await fetch(endpoint_url, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${api_key}` },
      mode: "cors",
    });
    if (r.ok || r.status === 405 || r.status === 401 || r.status === 403) {
      return { ok: true, message: `Reachable (HTTP ${r.status})` };
    }
    return { ok: false, message: `Unexpected status: HTTP ${r.status}` };
  } catch (e: any) {
    return { ok: false, message: e?.message || "Network error" };
  }
}
