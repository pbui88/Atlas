-- ── Recover granted_credits for non-admin users ──────────────────
-- Safe to run whether or not 026 was previously run.
-- Only touches users where granted_credits = 0 (not yet migrated).
--
-- Step 1: For users with purchased_credits > 0 and granted_credits = 0,
--         park purchased_credits into granted_credits.
-- Step 2: Recalculate purchased_credits from actual payment_transactions.
-- Step 3: Remove the paid portion from granted_credits to avoid double-counting.

BEGIN;

-- Step 1: Move un-migrated purchased_credits into granted_credits.
UPDATE profiles
SET granted_credits   = purchased_credits,
    purchased_credits = 0
WHERE purchased_credits > 0
  AND granted_credits  = 0
  AND role != 'admin';

-- Step 2: Restore purchased_credits from actual Authorize.net payments.
UPDATE profiles p
SET purchased_credits = COALESCE((
  SELECT SUM(pt.points)
  FROM payment_transactions pt
  WHERE pt.user_id = p.id
    AND pt.type    = 'credits'
    AND pt.status  = 'completed'
), 0)
WHERE p.role != 'admin';

-- Step 3: Subtract the paid portion from granted_credits (avoid double-count).
UPDATE profiles
SET granted_credits = GREATEST(0, granted_credits - purchased_credits)
WHERE purchased_credits > 0
  AND role != 'admin';

COMMIT;
