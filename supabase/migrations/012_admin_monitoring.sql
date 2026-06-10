-- ============================================================
-- Admin monitoring — API cost trends + Supabase storage/DB size
-- Run in Supabase SQL Editor
--
-- All functions are SECURITY DEFINER (run as the table owner) so they can
-- read pg_catalog/storage.objects regardless of the caller's grants, but
-- EXECUTE is restricted to service_role — only the admin Netlify function
-- (which uses the service role key) can call them.
-- ============================================================

-- ── Cost/usage aggregated by service over a time window ────
CREATE OR REPLACE FUNCTION get_usage_summary(p_since TIMESTAMPTZ)
RETURNS TABLE(service TEXT, total_count BIGINT, total_cost DOUBLE PRECISION)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    service,
    SUM(count)::BIGINT          AS total_count,
    COALESCE(SUM(cost_usd), 0)  AS total_cost
  FROM usage_logs
  WHERE created_at >= p_since
  GROUP BY service;
$$;

-- ── Daily cost trend (per service, per UTC day) ─────────────
CREATE OR REPLACE FUNCTION get_daily_cost_trend(p_since TIMESTAMPTZ)
RETURNS TABLE(day DATE, service TEXT, total_cost DOUBLE PRECISION)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    date_trunc('day', created_at)::DATE AS day,
    service,
    COALESCE(SUM(cost_usd), 0) AS total_cost
  FROM usage_logs
  WHERE created_at >= p_since
  GROUP BY 1, 2
  ORDER BY 1;
$$;

-- ── Total Postgres database size (bytes) ────────────────────
CREATE OR REPLACE FUNCTION get_database_size()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT pg_catalog.pg_database_size(pg_catalog.current_database());
$$;

-- ── Largest tables in the public schema (bytes, incl. indexes) ──
CREATE OR REPLACE FUNCTION get_table_sizes()
RETURNS TABLE(table_name TEXT, size_bytes BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    c.relname::TEXT AS table_name,
    pg_catalog.pg_total_relation_size(c.oid) AS size_bytes
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'm')
    AND n.nspname = 'public'
  ORDER BY size_bytes DESC
  LIMIT 10;
$$;

-- ── Storage bucket usage (bytes + file count, from object metadata) ──
CREATE OR REPLACE FUNCTION get_storage_usage()
RETURNS TABLE(bucket_id TEXT, total_bytes BIGINT, file_count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    o.bucket_id::TEXT,
    COALESCE(SUM((o.metadata->>'size')::BIGINT), 0) AS total_bytes,
    COUNT(*) AS file_count
  FROM storage.objects o
  GROUP BY o.bucket_id;
$$;

REVOKE ALL ON FUNCTION get_usage_summary(TIMESTAMPTZ)    FROM PUBLIC;
REVOKE ALL ON FUNCTION get_daily_cost_trend(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_database_size()               FROM PUBLIC;
REVOKE ALL ON FUNCTION get_table_sizes()                 FROM PUBLIC;
REVOKE ALL ON FUNCTION get_storage_usage()               FROM PUBLIC;

GRANT EXECUTE ON FUNCTION get_usage_summary(TIMESTAMPTZ)    TO service_role;
GRANT EXECUTE ON FUNCTION get_daily_cost_trend(TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION get_database_size()               TO service_role;
GRANT EXECUTE ON FUNCTION get_table_sizes()                 TO service_role;
GRANT EXECUTE ON FUNCTION get_storage_usage()               TO service_role;
