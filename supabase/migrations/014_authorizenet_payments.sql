-- ── Authorize.net Accept Hosted payments ───────────────────────
-- Tracks each Accept Hosted purchase attempt. ref_id is sent to
-- Authorize.net as the request's refId and echoed back in the webhook
-- payload as merchantReferenceId, correlating the purchase with the
-- user/points to credit once payment completes.
CREATE TABLE IF NOT EXISTS payment_transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_id       TEXT UNIQUE NOT NULL,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  points       INTEGER NOT NULL,
  amount_usd   NUMERIC(10,2) NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  trans_id     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_ref ON payment_transactions(ref_id);

ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_transactions_own" ON payment_transactions;
CREATE POLICY "payment_transactions_own" ON payment_transactions FOR SELECT USING (auth.uid() = user_id);

-- Atomically marks a pending payment as completed and credits the user in a
-- single transaction, so a webhook retry after a partial failure can't
-- double-credit. Returns false if ref_id is unknown or already completed.
CREATE OR REPLACE FUNCTION complete_payment_transaction(p_ref_id TEXT, p_trans_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_points  INTEGER;
BEGIN
  UPDATE payment_transactions
  SET status = 'completed', trans_id = p_trans_id, completed_at = now()
  WHERE ref_id = p_ref_id AND status = 'pending'
  RETURNING user_id, points INTO v_user_id, v_points;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE profiles
  SET purchased_credits = purchased_credits + v_points
  WHERE id = v_user_id;

  RETURN true;
END;
$$;
