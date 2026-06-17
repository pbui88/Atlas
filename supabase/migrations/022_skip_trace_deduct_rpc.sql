-- ── Skip Trace Balance RPCs ──────────────────────────────────────

-- Atomically deducts p_amount from skip_trace_balance only when the
-- user has sufficient funds, preventing overdraft and race conditions.
-- Returns TRUE on success, FALSE if balance is insufficient.
CREATE OR REPLACE FUNCTION deduct_skip_trace_balance(p_user_id UUID, p_amount NUMERIC)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE profiles
  SET skip_trace_balance = skip_trace_balance - p_amount
  WHERE id = p_user_id
    AND skip_trace_balance >= p_amount;
  RETURN FOUND;
END;
$$;

-- Adds p_amount to skip_trace_balance (used for refunds on failed jobs).
CREATE OR REPLACE FUNCTION add_skip_trace_balance(p_user_id UUID, p_amount NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE profiles
  SET skip_trace_balance = skip_trace_balance + p_amount
  WHERE id = p_user_id;
END;
$$;
