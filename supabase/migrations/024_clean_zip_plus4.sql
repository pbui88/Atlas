-- Strip ZIP+4 suffixes (-1234) from stored scan_point addresses so zips are
-- always the bare 5-digit form. ZIP+4 values came from Positionstack (which
-- returns the full 9-digit code) and were stored verbatim before the
-- extractAddress fix in geocode-points.js. Existing rows are frozen by the
-- "\d{5}" skip-check, so they need this one-time cleanup.
--
-- "..., AZ 85001-1234" → "..., AZ 85001"
-- "..., AZ 85001 1234" → "..., AZ 85001"
-- Bare 5-digit zips are untouched.

UPDATE scan_points
SET address    = REGEXP_REPLACE(address, '(\d{5})[\s-]+\d{4}$', '\1'),
    updated_at = NOW()
WHERE address ~ '\d{5}[\s-]+\d{4}$';
