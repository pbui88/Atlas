import { requireAuth, adminSupabase, fetchAllRows, ok, err, options, isValidUUID } from './utils/supabase.js'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  // Fix 2: guard malformed body
  let exportBody = {}
  try { exportBody = JSON.parse(event.body || '{}') } catch { return err('Invalid request body', 400) }
  const { projectId, format = 'GEOJSON', filters = {} } = exportBody
  if (!isValidUUID(projectId)) return err('projectId required')

  const supabase = adminSupabase()

  // Verify ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single()
  if (!project) return err('Project not found', 404)

  // Only fetch completed points — allows partial export while scan is still running.
  // ai_analyses has UNIQUE on scan_point_id so Supabase returns it as an object, not array.
  const points = await fetchAllRows((from, to) =>
    supabase
      .from('scan_points')
      .select('id, lat, lng, address, status, ai_analyses(overall_score, confidence, signals, notes)')
      .eq('project_id', projectId)
      .eq('status', 'complete')
      .range(from, to)
  )

  // Normalize ai_analyses — Supabase may return object or array depending on DB version
  const normalize = (pts) => pts.map(pt => ({
    ...pt,
    ai_analyses: pt.ai_analyses
      ? (Array.isArray(pt.ai_analyses) ? pt.ai_analyses[0] : pt.ai_analyses)
      : null,
  }))

  // Strip trailing country token (Positionstack appends ", United States")
  const cleanAddr = (s) => (s || '').replace(/,?\s*(United States|USA|US)\s*$/, '').trim()

  const normalized = normalize(points || []).filter(pt => pt.ai_analyses != null)
  if (!normalized.length) return err('No completed points with analysis yet — run a scan first')

  // Dedup key: house-number + core street name + city (strips direction prefixes
  // and type suffixes so "603 North Belmont Avenue, Odessa, TX" and
  // "603 N Belmont Ave, Odessa, Texas" both produce "603|belmont|odessa").
  const DIRS  = new Set(['n','s','e','w','ne','nw','se','sw','north','south','east','west','northeast','northwest','southeast','southwest'])
  const TYPES = new Set(['ave','avenue','blvd','boulevard','cir','circle','ct','court','dr','drive','ln','lane','pl','place','rd','road','st','street','trl','trail','pkwy','parkway','hwy','highway','way'])
  const addrKey = raw => {
    if (!raw) return null
    const parts = raw.replace(/,?\s*(United States|USA|US)\s*$/i, '').split(',').map(s => s.trim())
    const words = (parts[0] || '').toLowerCase().replace(/[.,#]/g, '').split(/\s+/).filter(Boolean)
    const num   = words[0]
    if (!num || !/^\d/.test(num)) return null
    const name  = words.slice(1).filter(w => !DIRS.has(w) && !TYPES.has(w)).join('-')
    const city  = (parts[1] || '').toLowerCase().trim().replace(/\s+/g, '-')
    return `${num}|${name}|${city}`
  }
  const COORD_DEG = 10 / 111320
  const seen = new Map()
  for (const pt of normalized) {
    const key = addrKey(pt.address) ||
                `${Math.round(pt.lat / COORD_DEG)},${Math.round(pt.lng / COORD_DEG)}`
    const existing = seen.get(key)
    const score    = pt.ai_analyses.overall_score ?? -1
    const exScore  = existing?.ai_analyses.overall_score ?? -1
    if (!existing || score > exScore) seen.set(key, pt)
  }
  const deduped = Array.from(seen.values())

  const minScore = filters.minScore ?? 0
  const filtered = deduped.filter(pt => {
    const score = pt.ai_analyses.overall_score ?? 0
    if (score < minScore) return false
    if (filters.signals?.length) {
      const sigs = pt.ai_analyses.signals || []
      if (!filters.signals.some(s => sigs.includes(s))) return false
    }
    return true
  })

  if (!filtered.length) return err('No points match the current filters')

  if (format === 'CSV') {
    const header = 'address,distress_score,confidence,signals,notes'
    const rows = filtered.map(pt => {
      const a = pt.ai_analyses
      return [
        `"${cleanAddr(pt.address).replace(/"/g, '""')}"`,
        a.overall_score ?? '',
        a.confidence    ?? '',
        `"${(a.signals || []).join('; ')}"`,
        `"${(a.notes   || '').replace(/"/g, '""')}"`,
      ].join(',')
    })
    return ok({ data: [header, ...rows].join('\n'), count: filtered.length, format: 'CSV' })
  }

  if (format === 'JSON') {
    const data = filtered.map(pt => ({
      id:            pt.id,
      lat:           pt.lat,
      lng:           pt.lng,
      address:       cleanAddr(pt.address),
      distressScore: pt.ai_analyses.overall_score,
      confidence:    pt.ai_analyses.confidence,
      signals:       pt.ai_analyses.signals || [],
      notes:         pt.ai_analyses.notes,
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
        address:       cleanAddr(pt.address),
        distressScore: pt.ai_analyses.overall_score,
        confidence:    pt.ai_analyses.confidence,
        signals:       pt.ai_analyses.signals || [],
        notes:         pt.ai_analyses.notes,
      },
    })),
  }
  return ok({ data: geojson, count: filtered.length, format: 'GEOJSON' })
}
