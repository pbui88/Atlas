import * as turf from '@turf/turf'
import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

function generateGrid(polygonGeoJson, spacingMeters) {
  const cellDegrees = spacingMeters / 111320
  const bbox = turf.bbox(polygonGeoJson)
  const grid = turf.pointGrid(bbox, cellDegrees, { units: 'degrees' })
  return grid.features
    .filter(pt => turf.booleanPointInPolygon(pt, polygonGeoJson))
    .map(pt => ({
      lat: +pt.geometry.coordinates[1].toFixed(7),
      lng: +pt.geometry.coordinates[0].toFixed(7),
    }))
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  const projectId = new URL(event.rawUrl || `http://x${event.path}`, 'http://x').searchParams.get('projectId')
  if (!projectId) return err('projectId required')

  const { geojson, spacingMeters = 50 } = JSON.parse(event.body || '{}')
  if (!geojson?.coordinates) return err('geojson polygon required')

  const supabase = adminSupabase()

  // Verify project ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single()
  if (!project) return err('Project not found', 404)

  // Generate points
  const points = generateGrid(geojson, Math.max(20, Math.min(500, spacingMeters)))
  if (points.length === 0) return err('No points generated — polygon may be too small')
  if (points.length > 10000) return err(`Too many points (${points.length}). Increase spacing or reduce area.`)

  // Delete existing pending points (allow re-generation)
  await supabase.from('scan_points').delete().eq('project_id', projectId).eq('status', 'pending')

  // Batch insert
  const BATCH = 500
  for (let i = 0; i < points.length; i += BATCH) {
    const batch = points.slice(i, i + BATCH).map(pt => ({
      project_id: projectId,
      lat: pt.lat,
      lng: pt.lng,
      status: 'pending',
    }))
    const { error: insErr } = await supabase.from('scan_points').insert(batch)
    if (insErr) return err(insErr.message)
  }

  // Update project
  await supabase
    .from('projects')
    .update({
      scan_area_geojson: geojson,
      point_spacing_meters: spacingMeters,
      total_points: points.length,
      completed_points: 0,
      failed_points: 0,
      status: 'queued',
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId)

  return ok({ pointsGenerated: points.length })
}
