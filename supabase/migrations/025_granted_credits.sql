-- ── Separate admin-granted credits from purchased credits ────────
-- granted_credits: points given by admin for free (never via payment).
-- purchased_credits: points bought via Authorize.net (unchanged).
-- Total available for scanning = purchased_credits + granted_credits.
-- purchased_credits_used remains the shared consumption counter for both.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS granted_credits INTEGER NOT NULL DEFAULT 0;

-- Atomic increment for admin-granted credits.
CREATE OR REPLACE FUNCTION increment_granted_credits(p_user_id UUID, p_points INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE profiles
  SET granted_credits = granted_credits + p_points
  WHERE id = p_user_id;
END;
$$;
