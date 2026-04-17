
DROP POLICY "Anyone can insert saved plans" ON public.saved_plans;

CREATE POLICY "Insert with matching client_id"
  ON public.saved_plans FOR INSERT
  WITH CHECK (
    length(client_id) > 0
    AND client_id = current_setting('request.headers', true)::json->>'x-client-id'
  );
