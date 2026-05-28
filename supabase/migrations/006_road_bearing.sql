-- Store the road bearing at each scan point so collect-images can compute
-- the perpendicular heading without a separate Street View metadata API call.
ALTER TABLE scan_points
  ADD COLUMN IF NOT EXISTS road_bearing DOUBLE PRECISION;
