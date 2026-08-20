-- The exact point an address was reverse-geocoded from, so collect-images.js
-- can aim the Street View camera at the same point instead of an
-- independently-guessed offset — keeps the photo and address from drifting
-- onto different houses on curves, corner lots, or uneven parcel spacing.
-- (These columns already exist in production from an earlier untracked
-- change; this migration just brings the schema file in sync with it.)

ALTER TABLE scan_points
  ADD COLUMN IF NOT EXISTS property_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS property_lng DOUBLE PRECISION;
