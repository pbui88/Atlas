-- Stripe checkout/webhook integration has been removed. credit_purchases was
-- the webhook's idempotency log (one row per Stripe checkout session) and is
-- no longer referenced by any code.
--
-- purchased_credits / purchased_credits_used on profiles, and the
-- increment_purchased_credits[_used] RPCs, are NOT Stripe-specific — they're
-- the shared credit ledger also used by the admin "grant credits" feature —
-- so they remain.
DROP TABLE IF EXISTS credit_purchases;
