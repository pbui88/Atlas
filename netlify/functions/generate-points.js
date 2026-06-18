import * as turf from '@turf/turf'
import { requireAuth, adminSupabase, ok, err, options, isValidUUID, getPathParam } from './utils/supabase.js'
import { getUserUsage } from './utils/usage.js'

// Compass bearing (0–360°) from point A → point B
function bearingBetween(lat1, lng1, lat2, lng2) {
  const R = Math.PI / 180
  const y = Math.sin((lng2 - lng1) * R) * Math.cos(lat2 * R)
  const x = Math.cos(lat1 * R) * Math.sin(lat2 * R)
          - Math.sin(lat1 * R) * Math.cos(lat2 * R) * Math.cos((lng2 - lng1) * R)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

async function overpassFetch(query) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `data=${encodeURIComponent(query)}`,
      signal:  controller.signal,
    })
    if (!res.ok) throw new Error(`Overpass API error: ${res.status}`)
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function getRoadsFromOSM(polygonGeoJson) {
  const [west, south, east, north] = turf.bbox(polygonGeoJson)
  // Only named, public-facing residential and collector roads.
  // Requiring [name] excludes alleys, back-access roads, and service lanes
  // which almost never have street names in OSM.
  const query = `[out:json][timeout:25];way[highway~"^(residential|primary|secondary|tertiary|living_street)$"][name][access!~"^(private|no)$"](${south},${west},${north},${east});(._;>;);out body;`
  return overpassFetch(query)
}

async function getBuildingsFromOSM(polygonGeoJson) {
  const [west, south, east, north] = turf.bbox(polygonGeoJson)
  const query = `[out:json][timeout:25];way[building](${south},${west},${north},${east});(._;>;);out body;`
  return overpassFetch(query)
}

// Building types that are not scannable properties (garages, sheds, etc.)
const SKIP_BUILDING_TYPES = new Set([
  'garage', 'garages', 'shed', 'carport', 'hut', 'barn', 'greenhouse',
  'kiosk', 'canopy', 'roof', 'ruins', 'collapsed', 'construction',
  'fence', 'wall', 'transformer_tower', 'service',
])

// Place one scan point at each building centroid. road_bearing is left null —
// the collect-images heading logic uses the Street View metadata to aim the
// camera from the road toward the scan point (building), so no bearing is needed.
function buildBuildingCentroids(osm, polygon) {
  const nodes = {}
  for (const el of osm.elements) {
    if (el.type === 'node') nodes[el.id] = [el.lon, el.lat]
  }

  // 5 m dedup cell — collapses OSM duplicates without merging distinct buildings.
  const CELL_DEG = 5 / 111320
  const seen     = new Set()
  const points   = []

  for (const el of osm.elements) {
    if (el.type !== 'way' || !el.tags?.building) continue
    if (SKIP_BUILDING_TYPES.has((el.tags.building || '').toLowerCase())) continue

    const coords = el.nodes?.map(id => nodes[id]).filter(Boolean)
    if (!coords || coords.length < 4) continue

    // Ensure the ring is closed (OSM closed ways have first === last node, but
    // missing nodes can break that invariant).
    const ring = [...coords]
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
      ring.push(ring[0])
    }

    try {
      const poly     = turf.polygon([ring])
      const centroid = turf.centroid(poly)
      if (!turf.booleanPointInPolygon(centroid, polygon)) continue

      const [lng, lat] = centroid.geometry.coordinates
      const key = `${Math.round(lng / CELL_DEG)},${Math.round(lat / CELL_DEG)}`
      if (seen.has(key)) continue
      seen.add(key)

      points.push({
        lat:          +lat.toFixed(7),
        lng:          +lng.toFixed(7),
        road_bearing: null,
      })
    } catch {
      // Invalid polygon geometry — skip
    }
  }

  return points
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

function sampleRoadPoints(roads, polygon, spacingMeters) {
  const spacingKm = spacingMeters / 1000
  // Grid cell = spacing/2 metres converted to degrees (~111,320 m per degree).
  // Any two points that fall in the same cell are the same property — keep one.
  const cellDeg   = (spacingMeters / 2) / 111320
  const seen      = new Set()
  const points    = []

  for (const road of roads) {
    if (!turf.booleanIntersects(road, polygon)) continue

    const len   = turf.length(road, { units: 'kilometers' })
    const steps = Math.max(1, Math.floor(len / spacingKm))

    for (let i = 0; i <= steps; i++) {
      const pos = (i / steps) * len
      const pt  = turf.along(road, pos, { units: 'kilometers' })
      if (!turf.booleanPointInPolygon(pt, polygon)) continue

      const [lng, lat] = pt.geometry.coordinates
      const key = `${Math.round(lng / cellDeg)},${Math.round(lat / cellDeg)}`
      if (seen.has(key)) continue
      seen.add(key)

      // Compute local road bearing from OSM geometry (5m tangent window)
      const delta  = 0.005
      const ptA    = turf.along(road, Math.min(pos + delta, len), { units: 'kilometers' }).geometry.coordinates
      const ptB    = turf.along(road, Math.max(pos - delta, 0),   { units: 'kilometers' }).geometry.coordinates
      const bearing = bearingBetween(ptB[1], ptB[0], ptA[1], ptA[0])

      points.push({
        lat:          +pt.geometry.coordinates[1].toFixed(7),
        lng:          +pt.geometry.coordinates[0].toFixed(7),
        road_bearing: +bearing.toFixed(2),
      })
    }
  }
  return points
}

function generateGrid(polygonGeoJson, spacingMeters) {
  const cellDegrees = spacingMeters / 111320
  const bbox        = turf.bbox(polygonGeoJson)
  const grid        = turf.pointGrid(bbox, cellDegrees, { units: 'degrees' })
  return grid.features
    .filter(pt => turf.booleanPointInPolygon(pt, polygonGeoJson))
    .map(pt => ({
      lat:          +pt.geometry.coordinates[1].toFixed(7),
      lng:          +pt.geometry.coordinates[0].toFixed(7),
      road_bearing: null,
    }))
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  const projectId = getPathParam(event, 'generate-points')
  if (!isValidUUID(projectId)) return err('projectId required')

  // Fix 2: guard malformed body
  let genBody = {}
  try { genBody = JSON.parse(event.body || '{}') } catch { return err('Invalid request body', 400) }
  const { geojson, spacingMeters = 30 } = genBody
  if (!geojson?.coordinates) return err('geojson polygon required')

  const supabase       = adminSupabase()
  const clampedSpacing = Math.max(30, Math.min(500, spacingMeters))

  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id, status')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single()
  if (!project) return err('Project not found', 404)

  // Prevent double-submission — reject if a scan is already in progress
  if (['queued', 'collecting', 'analyzing'].includes(project.status)) {
    return err('A scan is already in progress for this project', 409)
  }

  // Fail fast: non-admin must have purchased/granted credits; admin always passes
  const [{ data: profile }, preflight] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    getUserUsage(user.id, supabase),
  ])
  const isAdmin            = profile?.role === 'admin'
  const purchasedRemaining = Math.max(0, (preflight.purchasedCredits ?? 0) - (preflight.purchasedCreditsUsed ?? 0))
  if (!isAdmin && purchasedRemaining <= 0) return err('No credits available. Contact your admin to grant credits.', 503)

  // Generation strategy: buildings → roads → grid (each is a fallback for the previous).
  // Buildings give exactly one point per structure — the most accurate.
  // Roads sample at clampedSpacing intervals along named streets.
  // Grid is the last-resort for areas with neither OSM buildings nor roads.
  let points
  let method = 'building'
  try {
    const osm = await getBuildingsFromOSM(geojson)
    points    = buildBuildingCentroids(osm, geojson)
    if (points.length === 0) throw new Error('No buildings found in polygon')
  } catch (buildingErr) {
    console.warn('Building-based generation failed, falling back to roads:', buildingErr.message)
    method = 'road'
    try {
      const osm   = await getRoadsFromOSM(geojson)
      const roads = buildRoadLines(osm)
      points      = sampleRoadPoints(roads, geojson, clampedSpacing)
      if (points.length === 0) throw new Error('No roads found inside polygon')
    } catch (roadErr) {
      console.warn('Road-based generation failed, falling back to grid:', roadErr.message)
      points = generateGrid(geojson, clampedSpacing)
      method = 'grid'
    }
  }

  if (points.length === 0) return err('No points generated — polygon may be too small')
  if (points.length > 5000) return err(`Too many points (${points.length}). Reduce the scan area.`)

  if (!isAdmin) {
    const { remaining } = preflight
    if (remaining <= 0) {
      return err('Insufficient credits — contact your admin to add more credits.', 429)
    }
    if (points.length > remaining) {
      return err(`This scan needs ${points.length.toLocaleString()} points but you only have ${remaining.toLocaleString()} credits remaining.`, 429)
    }
  }

  await supabase.from('scan_points').delete().eq('project_id', projectId).eq('status', 'pending')

  const BATCH = 500
  for (let i = 0; i < points.length; i += BATCH) {
    const batch = points.slice(i, i + BATCH).map(pt => ({
      project_id:   projectId,
      lat:          pt.lat,
      lng:          pt.lng,
      road_bearing: pt.road_bearing,
      status:       'pending',
    }))
    const { error: insErr } = await supabase.from('scan_points').insert(batch)
    if (insErr) return err(insErr.message)
  }

  await supabase.from('projects').update({
    scan_area_geojson:    geojson,
    point_spacing_meters: clampedSpacing,
    total_points:         points.length,
    completed_points:     0,
    failed_points:        0,
    status:               'queued',
    updated_at:           new Date().toISOString(),
  }).eq('id', projectId)

  return ok({ pointsGenerated: points.length, method })
}
