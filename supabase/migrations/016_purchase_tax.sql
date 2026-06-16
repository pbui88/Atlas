-- ── Sales tax on credit purchases ──────────────────────────────
-- profiles.billing_state: user's billing state (2-letter US state code,
-- or 'OTHER' for outside the US). Set by admin on the user's behalf.
-- Used to compute sales tax for non-admin credit purchases.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS billing_state TEXT;

-- payment_transactions: break the charged total into subtotal + tax, and
-- record the billing state the tax was computed from. amount_usd remains
-- the total amount charged via Authorize.net (subtotal_usd + tax_usd).
ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS subtotal_usd  NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_usd       NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_state TEXT;

-- Backfill existing rows: treat the full charged amount as subtotal with no tax.
UPDATE payment_transactions SET subtotal_usd = amount_usd WHERE subtotal_usd = 0;
