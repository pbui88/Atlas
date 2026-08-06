-- One-off backfill: refund users for skip trace orders that were force-completed
-- with no results — either by migration 029's manual backlog clear, or by the
-- scheduled-skip-trace-check.js "stuck > 2 hours" path before it was fixed to
-- refund. Both paths marked the order 'completed' and deducted nothing back.
--
-- Signature of an affected order: completed with a nonzero outstanding cost,
-- no record in the order ever received actual result data, and completion
-- took more than 2 hours from creation. A genuine Tracerfy completion (even
-- one with zero matches) resolves within minutes; only the stuck-order
-- force-complete path takes hours.
--
-- Idempotent: refunding zeroes cost_usd on the order, so re-running this
-- file is a no-op for orders already refunded.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT o.id, o.user_id, o.cost_usd
    FROM skip_trace_orders o
    WHERE o.status = 'completed'
      AND o.cost_usd > 0
      AND o.completed_at IS NOT NULL
      AND o.completed_at - o.created_at >= INTERVAL '2 hours'
      AND NOT EXISTS (
        SELECT 1 FROM skip_trace_records sr
        WHERE sr.order_id = o.id AND sr.result IS NOT NULL
      )
  LOOP
    PERFORM add_skip_trace_balance(r.user_id, r.cost_usd);
    UPDATE skip_trace_orders SET cost_usd = 0 WHERE id = r.id;
    RAISE NOTICE 'Refunded % to user % for stuck order %', r.cost_usd, r.user_id, r.id;
  END LOOP;
END $$;
