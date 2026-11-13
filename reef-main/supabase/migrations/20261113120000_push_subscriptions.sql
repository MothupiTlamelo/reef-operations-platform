-- Push notifications: the phones and browsers that asked to be told, and which reminders have
-- already been sent to them.
--
-- A push subscription is what a browser hands back when a person taps "Allow notifications":
-- an endpoint URL at the browser vendor's push service (Google, Mozilla, Apple, Microsoft) and
-- two keys that encrypt the message so only that browser can read it. The API keeps one row per
-- endpoint and sends each new reminder to every endpoint its recipient owns.

-- ---------- Which reminders have been pushed ----------

-- The same idea as emailed_at: the reminder row records that it went out, so a restart, a
-- redeploy or a second API instance never sends it twice, and a reminder raised while push was
-- switched off is not lost.
ALTER TABLE public.notifications ADD COLUMN pushed_at timestamptz;

CREATE INDEX idx_notifications_unpushed
  ON public.notifications (created_at)
  WHERE pushed_at IS NULL;

-- ---------- Push subscriptions ----------

CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The endpoint is the subscription's identity. The push service gives each browser install a
  -- different, unguessable one, so one endpoint is one device.
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  -- Only so a person can tell their phone from their laptop. Never used to decide anything.
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_endpoint_https CHECK (endpoint LIKE 'https://%')
);

CREATE INDEX idx_push_subscriptions_user ON public.push_subscriptions (user_id);

GRANT SELECT, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- A person sees and removes their own devices and nobody else's.
CREATE POLICY "Users read own push subscriptions" ON public.push_subscriptions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users remove own push subscriptions" ON public.push_subscriptions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- There is no INSERT or UPDATE policy on purpose. Saving goes through the function below, so
-- that one rule holds whatever the API sends: the row always belongs to the caller.
--
-- A plain upsert cannot do this under row-level security. When a shared plant phone is signed
-- out of one account and into another, the browser keeps the same endpoint, and the existing
-- row belongs to the first person. The second person may not update it, so the upsert fails and
-- the phone silently keeps receiving the first person's reminders. The function moves the
-- endpoint to whoever registered it last, which is the person holding the phone.
CREATE FUNCTION public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to turn on notifications' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  VALUES (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = auth.uid(),
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent,
        last_seen_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.save_push_subscription(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(text, text, text, text) TO authenticated;
