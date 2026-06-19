-- Aggregate helpers for admin skip-trace-stats endpoint.
-- Computing SUM in the DB avoids fetching every row to JS as the orders table grows.

CREATE OR REPLACE FUNCTION get_skip_trace_total_spend()
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(SUM(cost_usd), 0) FROM skip_trace_orders WHERE status = 'completed'
$$;

CREATE OR REPLACE FUNCTION get_skip_trace_spend_since(p_since TIMESTAMPTZ)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(SUM(cost_usd), 0)
  FROM skip_trace_orders
  WHERE status = 'completed' AND completed_at >= p_since
$$;
