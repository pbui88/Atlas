-- Atomic increment for purchased_credits — called by the Stripe webhook.
-- Uses a security definer so the service role can call it safely.
CREATE OR REPLACE FUNCTION increment_purchased_credits(p_user_id UUID, p_points INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
  SET purchased_credits = purchased_credits + p_points
  WHERE id = p_user_id;
END;
$$;
