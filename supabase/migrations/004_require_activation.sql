-- ── Require admin activation for new signups ─────────────────
-- New users start as inactive. Admin must activate them before they can use the app.
-- Existing active users are unaffected.

ALTER TABLE profiles ALTER COLUMN is_active SET DEFAULT false;

-- Update the new-user trigger to be explicit about the inactive default
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, is_active, admin_notified)
  VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    false,
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
