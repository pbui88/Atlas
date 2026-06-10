-- Fix "infinite recursion detected in policy for relation "profiles"" (42P17).
--
-- profiles_admin (and projects_admin / usage_admin, which check the same
-- condition) used `EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
-- AND p.role = 'admin')`. Evaluating that subquery against `profiles`
-- re-triggers profiles' own RLS policies — including profiles_admin itself —
-- so Postgres detects the cycle at planning time and errors on ANY query
-- against profiles, projects, or usage_logs.
--
-- Fix: a SECURITY DEFINER helper, owned by the table owner (which bypasses
-- RLS on tables it owns), checks the role without re-entering RLS.
CREATE OR REPLACE FUNCTION is_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND role = 'admin');
$$;

-- Evaluated inside RLS policies for every authenticated/anon request.
GRANT EXECUTE ON FUNCTION is_admin(UUID) TO authenticated, anon, service_role;

-- ── Replace the recursive policies ──────────────────────────
DROP POLICY IF EXISTS "profiles_admin" ON profiles;
CREATE POLICY "profiles_admin" ON profiles FOR ALL USING (is_admin(auth.uid()));

DROP POLICY IF EXISTS "projects_admin" ON projects;
CREATE POLICY "projects_admin" ON projects FOR ALL USING (is_admin(auth.uid()));

DROP POLICY IF EXISTS "usage_admin" ON usage_logs;
CREATE POLICY "usage_admin" ON usage_logs FOR ALL USING (is_admin(auth.uid()));
