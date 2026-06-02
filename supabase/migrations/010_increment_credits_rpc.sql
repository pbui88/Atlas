-- Atomic increment for purchased_credits — called by the Stripe webhook.
-- SET search_path pins the schema to prevent search-path injection on SECURITY DEFINER functions.
CREATE OR REPLACE FUNCTION increment_purchased_credits(p_user_id UUID, p_points INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE profiles
  SET purchased_credits = purchased_credits + p_points
  WHERE id = p_user_id;
END;
$$;

-- Tracks lifetime consumption of purchased credits.
-- Called by collect-images when cycle usage exceeds the monthly quota.
-- LEAST guard prevents overshooting the total purchased balance.
CREATE OR REPLACE FUNCTION increment_purchased_credits_used(p_user_id UUID, p_points INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE profiles
  SET purchased_credits_used = LEAST(purchased_credits_used + p_points, purchased_credits)
  WHERE id = p_user_id;
END;
$$;
