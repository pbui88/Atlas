import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  const { projectId, format = 'GEOJSON', filters = {} } = JSON.parse(event.body || '{}')
  if (!projectId) return err('projectId required')

  const supabase = adminSupabase()

  // Verify ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single()
  if (!project) return err('Project not found', 404)

  // Fetch all points that have been analyzed (any status with an ai_analyses record)
  const { data: points, error: fetchErr } = await supabase
    .from('scan_points')
    .select('id, lat, lng, address, status, ai_analyses(overall_score, confidence, signals, notes)')
    .eq('project_id', projectId)

  if (fetchErr) return err(fetchErr.message)

  // Only export points that have an analysis result
  const analyzed = (points || []).filter(pt => pt.ai_analyses?.length > 0)
  if (!analyzed.length) return err('No analyzed points found — run AI analysis first')

  const minScore = filters.minScore ?? 0
  const filtered = analyzed.filter(pt => {
    const score = pt.ai_analyses[0].overall_score ?? 0
    if (score < minScore) return false
    if (filters.signals?.length) {
      const sigs = pt.ai_analyses[0].signals || []
      if (!filters.signals.some(s => sigs.includes(s))) return false
    }
    return true
  })

  if (!filtered.length) return err('No points match the current filters')

  if (format === 'CSV') {
    const header = 'id,lat,lng,address,distress_score,confidence,signals,notes'
    const rows = filtered.map(pt => {
      const a = pt.ai_analyses?.[0] || {}
      return [
        pt.id,
        pt.lat,
        pt.lng,
        `"${(pt.address || '').replace(/"/g, '""')}"`,
        a.overall_score ?? '',
        a.confidence ?? '',
        `"${(a.signals || []).join('; ')}"`,
        `"${(a.notes || '').replace(/"/g, '""')}"`,
      ].join(',')
    })
    return ok({ data: [header, ...rows].join('\n'), count: filtered.length, format: 'CSV' })
  }

  if (format === 'JSON') {
    const data = filtered.map(pt => ({
      id:            pt.id,
      lat:           pt.lat,
      lng:           pt.lng,
      address:       pt.address,
      distressScore: pt.ai_analyses?.[0]?.overall_score,
      confidence:    pt.ai_analyses?.[0]?.confidence,
      signals:       pt.ai_analyses?.[0]?.signals || [],
      notes:         pt.ai_analyses?.[0]?.notes,
    }))
    return ok({ data, count: data.length, format: 'JSON' })
  }

  // Default: GeoJSON
  const geojson = {
    type: 'FeatureCollection',
    features: filtered.map(pt => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] },
      properties: {
        id:            pt.id,
        address:       pt.address,
        distressScore: pt.ai_analyses?.[0]?.overall_score,
        confidence:    pt.ai_analyses?.[0]?.confidence,
        signals:       pt.ai_analyses?.[0]?.signals || [],
        notes:         pt.ai_analyses?.[0]?.notes,
      },
    })),
  }
  return ok({ data: geojson, count: filtered.length, format: 'GEOJSON' })
}
