-- Fix increment_purchased_credits_used to cap against total credits
-- (purchased + granted), not just purchased_credits alone.
--
-- Before this fix, a user with purchased_credits = 0 and granted_credits > 0
-- would never have purchased_credits_used incremented (LEAST(n, 0) = 0),
-- so their credit balance never deducted during scans and the sidebar widget
-- stayed frozen.

CREATE OR REPLACE FUNCTION increment_purchased_credits_used(p_user_id UUID, p_points INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE profiles
  SET purchased_credits_used = LEAST(
        purchased_credits_used + p_points,
        purchased_credits + granted_credits
      )
  WHERE id = p_user_id;
END;
$$;
