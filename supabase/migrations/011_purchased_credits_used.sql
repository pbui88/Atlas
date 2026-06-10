-- ── Purchased credits usage tracking ───────────────────────────
-- purchased_credits_used: lifetime count of purchased credits consumed.
-- Referenced by getUserUsage() and increment_purchased_credits_used(),
-- but never created — 009_purchased_credits.sql only added
-- purchased_credits, not purchased_credits_used.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS purchased_credits_used INTEGER NOT NULL DEFAULT 0;

UPDATE profiles SET purchased_credits_used = 0 WHERE purchased_credits_used IS NULL;
