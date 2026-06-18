-- ── Skip Trace Balance ──────────────────────────────────────────
-- Adds a separate dollar-balance wallet for skip trace / DNC services.
-- Funded via Authorize.net just like scan credits, but billed per-use
-- at $0.08/record (skip trace) and $0.02/phone (DNC scrub).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS skip_trace_balance NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Extend payment_transactions to distinguish credit purchases from
-- skip-trace fund deposits.
ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'credits'
    CHECK (type IN ('credits', 'skip_trace'));

-- Update the RPC to credit the right wallet based on payment type.
-- For 'credits': adds points to purchased_credits (existing behaviour).
-- For 'skip_trace': adds subtotal_usd to skip_trace_balance.
CREATE OR REPLACE FUNCTION complete_payment_transaction(p_ref_id TEXT, p_trans_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id  UUID;
  v_points   INTEGER;
  v_type     TEXT;
  v_subtotal NUMERIC(10,2);
BEGIN
  UPDATE payment_transactions
  SET status = 'completed', trans_id = p_trans_id, completed_at = now()
  WHERE ref_id = p_ref_id AND status = 'pending'
  RETURNING user_id, points, type, subtotal_usd
    INTO v_user_id, v_points, v_type, v_subtotal;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_type = 'skip_trace' THEN
    UPDATE profiles
    SET skip_trace_balance = skip_trace_balance + v_subtotal
    WHERE id = v_user_id;
  ELSE
    UPDATE profiles
    SET purchased_credits = purchased_credits + v_points
    WHERE id = v_user_id;
  END IF;

  RETURN true;
END;
$$;
