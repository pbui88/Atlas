-- Scan points whose address never resolves to a usable street address (no
-- house number found even after geocoding) can't be skip-traced or mailed.
-- Refund the 1 scan credit charged for the Street View download so the user
-- isn't paying for a point they can't act on.

ALTER TABLE scan_points
  ADD COLUMN IF NOT EXISTS credit_refunded BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION refund_purchased_credit(p_user_id UUID, p_points INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE profiles
  SET purchased_credits_used = GREATEST(purchased_credits_used - p_points, 0)
  WHERE id = p_user_id;
END;
$$;
