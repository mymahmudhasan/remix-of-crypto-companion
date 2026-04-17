
CREATE TABLE public.saved_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('spot','futures')),
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  side TEXT NOT NULL,
  action TEXT,
  leverage INTEGER,
  entry_low NUMERIC NOT NULL,
  entry_high NUMERIC NOT NULL,
  stop NUMERIC NOT NULL,
  targets NUMERIC[] NOT NULL DEFAULT '{}',
  conviction INTEGER,
  risk_pct NUMERIC,
  entry_price NUMERIC,
  plan JSONB NOT NULL,
  chart_snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost','cancelled')),
  closed_price NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_plans_created ON public.saved_plans (created_at DESC);
CREATE INDEX idx_saved_plans_status ON public.saved_plans (status);

ALTER TABLE public.saved_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view saved plans"
  ON public.saved_plans FOR SELECT USING (true);

CREATE POLICY "Anyone can insert saved plans"
  ON public.saved_plans FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update saved plans"
  ON public.saved_plans FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete saved plans"
  ON public.saved_plans FOR DELETE USING (true);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_saved_plans_updated
  BEFORE UPDATE ON public.saved_plans
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
