-- ── Cost-optimization additions ─────────────────────────────
-- 1. Track image source (mapillary | google) and content hash for dedup/caching
-- 2. Add analysis_cache so identical images don't pay Gemini twice

ALTER TABLE images
  ADD COLUMN IF NOT EXISTS image_hash   TEXT,
  ADD COLUMN IF NOT EXISTS image_source TEXT;

CREATE INDEX IF NOT EXISTS idx_images_hash ON images(image_hash);

CREATE TABLE IF NOT EXISTS analysis_cache (
  image_hash   TEXT PRIMARY KEY,
  model        TEXT NOT NULL,
  result       JSONB NOT NULL,
  hit_count    INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
