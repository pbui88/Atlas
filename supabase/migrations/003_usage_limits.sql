-- ── Usage limits per user ─────────────────────────────────────
-- points_limit:      max scan points allowed per 30-day cycle (admin-configurable per user)
-- cycle_anchor_date: the date the first cycle started (= signup date for new users)
--                    current cycle window = anchor + floor(days_elapsed/30)*30 days

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS points_limit      INTEGER NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS cycle_anchor_date DATE    NOT NULL DEFAULT CURRENT_DATE;

-- Backfill existing users: anchor their cycle to their signup date
UPDATE profiles
SET cycle_anchor_date = created_at::date
WHERE cycle_anchor_date = CURRENT_DATE;

-- New users get cycle_anchor_date set to today via handle_new_user trigger (already uses DEFAULT)

-- Index for fast per-user cycle usage queries
CREATE INDEX IF NOT EXISTS images_panorama_id_source_idx
  ON images (panorama_id, image_source)
  WHERE panorama_id IS NOT NULL;
