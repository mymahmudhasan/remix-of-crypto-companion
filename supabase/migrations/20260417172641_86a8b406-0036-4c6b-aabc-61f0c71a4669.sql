
ALTER TABLE public.saved_plans ADD COLUMN client_id TEXT NOT NULL DEFAULT '';

DROP POLICY "Anyone can update saved plans" ON public.saved_plans;
DROP POLICY "Anyone can delete saved plans" ON public.saved_plans;

CREATE POLICY "Owner can update by client_id"
  ON public.saved_plans FOR UPDATE
  USING (client_id = current_setting('request.headers', true)::json->>'x-client-id')
  WITH CHECK (client_id = current_setting('request.headers', true)::json->>'x-client-id');

CREATE POLICY "Owner can delete by client_id"
  ON public.saved_plans FOR DELETE
  USING (client_id = current_setting('request.headers', true)::json->>'x-client-id');

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
