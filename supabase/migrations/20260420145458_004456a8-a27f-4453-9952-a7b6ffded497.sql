-- Settings table for the Binance Square publisher (single-row per client_id)
CREATE TABLE public.square_publisher_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  endpoint_url TEXT,
  api_key TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  posts_per_window INTEGER NOT NULL DEFAULT 100,
  window_start_hour INTEGER NOT NULL DEFAULT 16,
  window_end_hour INTEGER NOT NULL DEFAULT 20,
  timezone TEXT NOT NULL DEFAULT 'Asia/Dhaka',
  last_tested_at TIMESTAMPTZ,
  last_test_ok BOOLEAN,
  last_test_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keep updated_at fresh
CREATE TRIGGER trg_square_publisher_settings_touch
BEFORE UPDATE ON public.square_publisher_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS: this app uses an anonymous client_id model (same pattern as saved_plans).
-- Allow any anon caller to read/write rows that match a provided client_id.
ALTER TABLE public.square_publisher_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read their own settings row"
ON public.square_publisher_settings
FOR SELECT
USING (true);

CREATE POLICY "Anyone can insert their own settings row"
ON public.square_publisher_settings
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update their own settings row"
ON public.square_publisher_settings
FOR UPDATE
USING (true)
WITH CHECK (true);

CREATE POLICY "Anyone can delete their own settings row"
ON public.square_publisher_settings
FOR DELETE
USING (true);