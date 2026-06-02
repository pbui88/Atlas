-- ── Purchased credits balance ──────────────────────────────────
-- purchased_credits: cumulative points bought via Stripe (never resets).
-- Effective quota = points_limit + purchased_credits.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS purchased_credits INTEGER NOT NULL DEFAULT 0;

-- Backfill existing users to 0 (already the default, but explicit)
UPDATE profiles SET purchased_credits = 0 WHERE purchased_credits IS NULL;
