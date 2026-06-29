-- ── Separate paid credits from admin-granted credits ─────────────
-- Before this migration, both Authorize.net payments AND admin grants
-- were stored in purchased_credits, making the two indistinguishable.
-- This migration cleanly separates them using the payment_transactions
-- table as the authoritative record of what users actually paid for.
--
-- Algorithm:
--   1. Move ALL current purchased_credits into granted_credits (park it)
--   2. Recalculate purchased_credits from completed credit payments
--   3. Reduce granted_credits by the now-correctly-attributed paid amount
--      so total credits (purchased + granted) stays identical to before
--
-- purchased_credits_used does NOT need to change — it is a shared
-- consumption counter and the total available credits is unchanged.
--
-- Depends on: 025_granted_credits.sql (granted_credits column + RPC)

BEGIN;

-- Step 1: Park everything currently in purchased_credits into granted_credits.
UPDATE profiles
SET granted_credits   = granted_credits + purchased_credits,
    purchased_credits = 0
WHERE purchased_credits > 0;

-- Step 2: Re-set purchased_credits to the actual amount each user paid
-- (sum of all completed credit-type payment transactions).
UPDATE profiles p
SET purchased_credits = COALESCE((
  SELECT SUM(pt.points)
  FROM payment_transactions pt
  WHERE pt.user_id = p.id
    AND pt.type    = 'credits'
    AND pt.status  = 'completed'
), 0);

-- Step 3: Remove the paid portion from granted_credits to avoid double-counting.
UPDATE profiles
SET granted_credits = GREATEST(0, granted_credits - purchased_credits)
WHERE purchased_credits > 0;

COMMIT;
