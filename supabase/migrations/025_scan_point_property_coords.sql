-- Add the geocoded property location to each scan point.
-- geocode-points.js offsets 20 m perpendicular to the road (road_bearing + 90)
-- and resolves an address there, so this point sits on the actual property and
-- encodes the correct side of the road. collect-images.js aims the Street View
-- camera at this point so images face the house, not the road.
--
-- Nullable: points that fail geocoding (no address) have no property coords and
-- keep the existing fallback aiming. Existing rows are backfilled on the next
-- scan, since geocode now re-runs when property_lat IS NULL.

ALTER TABLE scan_points ADD COLUMN IF NOT EXISTS property_lat DOUBLE PRECISION;
ALTER TABLE scan_points ADD COLUMN IF NOT EXISTS property_lng DOUBLE PRECISION;
