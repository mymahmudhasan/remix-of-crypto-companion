import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getClientId } from "./client-id";

/**
 * Supabase client that injects the x-client-id header used by saved_plans RLS.
 * We use a separate client (not the auto-generated singleton) so we can attach
 * a custom header without touching the generated file.
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const plansClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    headers: {
      "x-client-id": getClientId(),
    },
  },
});

export const SAVED_PLANS_TABLE = "saved_plans" as const;
