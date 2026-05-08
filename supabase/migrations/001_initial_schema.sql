-- ============================================================
-- Atlas — Initial Schema
-- Run in Supabase SQL Editor
-- ============================================================

-- ── Profiles (auto-created on signup) ──────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT,
  full_name     TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  admin_notified BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user();

-- ── Projects ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  description           TEXT,
  status                TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','queued','collecting','analyzing','complete','failed','paused')),
  scan_area_geojson     JSONB,
  bounding_box          JSONB,
  point_spacing_meters  INTEGER NOT NULL DEFAULT 50,
  capture_directions    TEXT[] NOT NULL DEFAULT '{N,S,E,W}',
  total_points          INTEGER NOT NULL DEFAULT 0,
  completed_points      INTEGER NOT NULL DEFAULT 0,
  failed_points         INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

-- ── Scan Points ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_points (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  road_snapped BOOLEAN NOT NULL DEFAULT false,
  address      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','downloading','downloaded','analyzing','complete','failed','no_coverage')),
  retry_count  INTEGER NOT NULL DEFAULT 0,
  error_msg    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Images ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS images (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_point_id   UUID NOT NULL REFERENCES scan_points(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL,
  heading         DOUBLE PRECISION NOT NULL,
  storage_path    TEXT,
  storage_url     TEXT,
  panorama_id     TEXT,
  size_bytes      INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── AI Analyses ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_analyses (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_point_id       UUID NOT NULL UNIQUE REFERENCES scan_points(id) ON DELETE CASCADE,
  overall_score       DOUBLE PRECISION,
  confidence          DOUBLE PRECISION,
  signals             TEXT[],
  model_used          TEXT,
  prompt_tokens       INTEGER,
  completion_tokens   INTEGER,
  estimated_cost_usd  DOUBLE PRECISION,
  notes               TEXT,
  raw_response        JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Usage Logs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id),
  service    TEXT NOT NULL,
  action     TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 1,
  cost_usd   DOUBLE PRECISION,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_projects_user        ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_status      ON projects(status);
CREATE INDEX IF NOT EXISTS idx_scan_points_project  ON scan_points(project_id);
CREATE INDEX IF NOT EXISTS idx_scan_points_status   ON scan_points(project_id, status);
CREATE INDEX IF NOT EXISTS idx_images_scan_point    ON images(scan_point_id);
CREATE INDEX IF NOT EXISTS idx_ai_score             ON ai_analyses(overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_usage_user_date      ON usage_logs(user_id, created_at DESC);

-- ── Row Level Security ──────────────────────────────────────
ALTER TABLE profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects     ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_points  ENABLE ROW LEVEL SECURITY;
ALTER TABLE images       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_analyses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs   ENABLE ROW LEVEL SECURITY;

-- Profiles: users see own; admins see all
DROP POLICY IF EXISTS "profiles_own"   ON profiles;
DROP POLICY IF EXISTS "profiles_admin" ON profiles;
CREATE POLICY "profiles_own"   ON profiles FOR ALL USING (auth.uid() = id);
CREATE POLICY "profiles_admin" ON profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

-- Projects
DROP POLICY IF EXISTS "projects_own"   ON projects;
DROP POLICY IF EXISTS "projects_admin" ON projects;
CREATE POLICY "projects_own" ON projects FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "projects_admin" ON projects FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

-- Scan points (owned via project)
DROP POLICY IF EXISTS "scan_points_own" ON scan_points;
CREATE POLICY "scan_points_own" ON scan_points FOR ALL USING (
  EXISTS (SELECT 1 FROM projects pr WHERE pr.id = project_id AND pr.user_id = auth.uid())
);

-- Images (owned via scan point → project)
DROP POLICY IF EXISTS "images_own" ON images;
CREATE POLICY "images_own" ON images FOR ALL USING (
  EXISTS (
    SELECT 1 FROM scan_points sp
    JOIN projects pr ON pr.id = sp.project_id
    WHERE sp.id = scan_point_id AND pr.user_id = auth.uid()
  )
);

-- AI analyses (same chain)
DROP POLICY IF EXISTS "ai_analyses_own" ON ai_analyses;
CREATE POLICY "ai_analyses_own" ON ai_analyses FOR ALL USING (
  EXISTS (
    SELECT 1 FROM scan_points sp
    JOIN projects pr ON pr.id = sp.project_id
    WHERE sp.id = scan_point_id AND pr.user_id = auth.uid()
  )
);

-- Usage logs
DROP POLICY IF EXISTS "usage_own"   ON usage_logs;
DROP POLICY IF EXISTS "usage_admin" ON usage_logs;
CREATE POLICY "usage_own" ON usage_logs FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "usage_admin" ON usage_logs FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

-- ── Storage bucket (run separately or via Supabase dashboard) ──
-- INSERT INTO storage.buckets (id, name, public) VALUES ('street-view-images', 'street-view-images', true)
-- ON CONFLICT DO NOTHING;
