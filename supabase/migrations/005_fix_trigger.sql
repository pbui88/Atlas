-- ── Fix handle_new_user trigger ───────────────────────────────
-- Adds SET search_path = public so the function always finds the
-- profiles table regardless of Supabase's search_path security settings.
-- Also uses fully-qualified table name and handles both Google and email signups.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, is_active, admin_notified)
  VALUES (
    new.id,
    new.email,
    COALESCE(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name'
    ),
    false,
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;
