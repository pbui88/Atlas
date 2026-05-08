import * as turf from '@turf/turf'
import { API_COSTS } from './constants'

/**
 * Generate a uniform grid of lat/lng points inside a GeoJSON polygon.
 * spacingMeters controls the grid cell size.
 */
export function generateGridPoints(polygonGeoJson, spacingMeters = 50) {
  try {
    // Convert meters → approximate degrees (1° ≈ 111,320 m at equator)
    const cellDegrees = spacingMeters / 111320
    const bbox = turf.bbox(polygonGeoJson)
    const grid = turf.pointGrid(bbox, cellDegrees, { units: 'degrees' })

    return grid.features
      .filter(pt => turf.booleanPointInPolygon(pt, polygonGeoJson))
      .map(pt => ({
        lat: +pt.geometry.coordinates[1].toFixed(7),
        lng: +pt.geometry.coordinates[0].toFixed(7),
      }))
  } catch (err) {
    console.error('[geo] generateGridPoints error:', err)
    return []
  }
}

/**
 * Estimate API cost for a scan project.
 */
export function estimateCost(pointCount, directionCount = 4) {
  const images        = pointCount * directionCount
  const streetView    = (images / 1000) * API_COSTS.streetViewPer1k
  const geocoding     = (pointCount / 1000) * API_COSTS.geocodingPer1k
  const ai            = pointCount * API_COSTS.aiPerPoint
  return {
    streetView: +streetView.toFixed(2),
    geocoding:  +geocoding.toFixed(2),
    ai:         +ai.toFixed(2),
    total:      +(streetView + geocoding + ai).toFixed(2),
  }
}

/**
 * Map a 0–1 distress score to a hex color.
 */
export function scoreColor(score) {
  if (score == null) return '#64748b'
  if (score >= 0.70) return '#ef4444'  // red
  if (score >= 0.45) return '#f97316'  // orange
  if (score >= 0.20) return '#eab308'  // yellow
  return '#22c55e'                     // green
}

/** Format score 0–1 as integer 0–100. */
export function scoreLabel(score) {
  return score != null ? Math.round(score * 100) : '--'
}

/** Compute bounding box from a GeoJSON polygon. */
export function polygonBbox(geojson) {
  const [minLng, minLat, maxLng, maxLat] = turf.bbox(geojson)
  return { minLat, maxLat, minLng, maxLng }
}

/** Chunk an array into sub-arrays of size n. */
export function chunkArray(arr, n) {
  const chunks = []
  for (let i = 0; i < arr.length; i += n) chunks.push(arr.slice(i, i + n))
  return chunks
}
