-- Force-complete skip trace orders stuck in 'processing' for more than 2 hours.
-- Run this once to clear the current backlog; the scheduled function handles future cases.

UPDATE skip_trace_records
SET status = 'completed', completed_at = NOW()
WHERE order_id IN (
  SELECT id FROM skip_trace_orders
  WHERE status = 'processing'
    AND created_at < NOW() - INTERVAL '2 hours'
)
AND status != 'completed';

UPDATE skip_trace_orders
SET status = 'completed', completed_at = NOW()
WHERE status = 'processing'
  AND created_at < NOW() - INTERVAL '2 hours';
