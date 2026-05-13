import * as turf from '@turf/turf'
import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

// ── OSM road fetching ────────────────────────────────────────────────────────

async function getRoadsFromOSM(polygonGeoJson) {
  const [west, south, east, north] = turf.bbox(polygonGeoJson)

  // Fetch driveable roads relevant to residential scanning
  const query = `[out:json][timeout:25];way[highway~"^(residential|primary|secondary|tertiary|living_street|service|unclassified|road|trunk)$"](${south},${west},${north},${east});(._;>;);out body;`

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `data=${encodeURIComponent(query)}`,
  })
  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`)
  return res.json()
}

function buildRoadLines(osm) {
  const nodes = {}
  for (const el of osm.elements) {
    if (el.type === 'node') nodes[el.id] = [el.lon, el.lat]
  }
  return osm.elements
    .filter(el => el.type === 'way')
    .map(el => {
      const coords = el.nodes.map(id => nodes[id]).filter(Boolean)
      return coords.length >= 2 ? turf.lineString(coords) : null
    })
    .filter(Boolean)
}

// Sample evenly-spaced points along road centerlines that fall inside the polygon.
// Deduplicates using ~11m grid so overlapping road segments don't produce duplicate points.
function sampleRoadPoints(roads, polygon, spacingMeters) {
  const spacingKm = spacingMeters / 1000
  const seen      = new Set()
  const points    = []

  for (const road of roads) {
    if (!turf.booleanIntersects(road, polygon)) continue

    const len   = turf.length(road, { units: 'kilometers' })
    const steps = Math.max(1, Math.floor(len / spacingKm))

    for (let i = 0; i <= steps; i++) {
      const pt = turf.along(road, (i / steps) * len, { units: 'kilometers' })
      if (!turf.booleanPointInPolygon(pt, polygon)) continue

      // ~0.0001° ≈ 11 m — coarse enough to merge nearby duplicates
      const key = `${pt.geometry.coordinates[0].toFixed(4)},${pt.geometry.coordinates[1].toFixed(4)}`
      if (seen.has(key)) continue
      seen.add(key)

      points.push({
        lat: +pt.geometry.coordinates[1].toFixed(7),
        lng: +pt.geometry.coordinates[0].toFixed(7),
      })
    }
  }
  return points
}

// ── Grid fallback ────────────────────────────────────────────────────────────

function generateGrid(polygonGeoJson, spacingMeters) {
  const cellDegrees = spacingMeters / 111320
  const bbox        = turf.bbox(polygonGeoJson)
  const grid        = turf.pointGrid(bbox, cellDegrees, { units: 'degrees' })
  return grid.features
    .filter(pt => turf.booleanPointInPolygon(pt, polygonGeoJson))
    .map(pt => ({
      lat: +pt.geometry.coordinates[1].toFixed(7),
      lng: +pt.geometry.coordinates[0].toFixed(7),
    }))
}

// ── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  const projectId = new URL(event.rawUrl || `http://x${event.path}`, 'http://x').searchParams.get('projectId')
  if (!projectId) return err('projectId required')

  const { geojson, spacingMeters = 50 } = JSON.parse(event.body || '{}')
  if (!geojson?.coordinates) return err('geojson polygon required')

  const supabase       = adminSupabase()
  const clampedSpacing = Math.max(20, Math.min(500, spacingMeters))

  // Verify project ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single()
  if (!project) return err('Project not found', 404)

  // Try road-centerline points first; fall back to grid if OSM fails or returns nothing
  let points
  let method = 'road'
  try {
    const osm   = await getRoadsFromOSM(geojson)
    const roads = buildRoadLines(osm)
    points      = sampleRoadPoints(roads, geojson, clampedSpacing)
    if (points.length === 0) throw new Error('No roads found inside polygon')
  } catch (e) {
    console.warn('Road-based generation failed, falling back to grid:', e.message)
    points = generateGrid(geojson, clampedSpacing)
    method = 'grid'
  }

  if (points.length === 0) return err('No points generated — polygon may be too small')
  if (points.length > 10000) return err(`Too many points (${points.length}). Increase spacing or reduce area.`)

  // Delete existing pending points (allow re-generation)
  await supabase.from('scan_points').delete().eq('project_id', projectId).eq('status', 'pending')

  // Batch insert
  const BATCH = 500
  for (let i = 0; i < points.length; i += BATCH) {
    const batch = points.slice(i, i + BATCH).map(pt => ({
      project_id: projectId,
      lat:        pt.lat,
      lng:        pt.lng,
      status:     'pending',
    }))
    const { error: insErr } = await supabase.from('scan_points').insert(batch)
    if (insErr) return err(insErr.message)
  }

  // Update project
  await supabase.from('projects').update({
    scan_area_geojson:    geojson,
    point_spacing_meters: spacingMeters,
    total_points:         points.length,
    completed_points:     0,
    failed_points:        0,
    status:               'queued',
    updated_at:           new Date().toISOString(),
  }).eq('id', projectId)

  return ok({ pointsGenerated: points.length, method })
}
