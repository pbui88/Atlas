import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

const GOOGLE_KEY = process.env.GOOGLE_MAPS_KEY

async function reverseGeocode(lat, lng) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=street_address|premise&key=${GOOGLE_KEY}`
  const res  = await fetch(url)
  const data = await res.json()
  if (data.status !== 'OK' || !data.results?.length) return null
  return data.results[0].formatted_address
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  if (!GOOGLE_KEY) return err('GOOGLE_MAPS_KEY not configured', 503)

  const { projectId, pointIds } = JSON.parse(event.body || '{}')
  if (!projectId || !Array.isArray(pointIds) || !pointIds.length) {
    return err('projectId and pointIds required')
  }

  const supabase = adminSupabase()
  const results  = []

  for (const pointId of pointIds.slice(0, 20)) {
    try {
      const { data: pt } = await supabase
        .from('scan_points')
        .select('id, lat, lng, address')
        .eq('id', pointId)
        .single()

      if (!pt || pt.address) { results.push({ pointId, status: 'skipped' }); continue }

      const address = await reverseGeocode(pt.lat, pt.lng)
      if (address) {
        await supabase.from('scan_points').update({ address, updated_at: new Date().toISOString() }).eq('id', pointId)
      }
      results.push({ pointId, status: 'geocoded', address })
    } catch (e) {
      results.push({ pointId, status: 'error', error: e.message })
    }
  }

  // Log usage
  await supabase.from('usage_logs').insert({
    user_id:  user.id,
    service:  'geocoding',
    action:   'reverse_geocode',
    count:    results.filter(r => r.status === 'geocoded').length,
    cost_usd: results.filter(r => r.status === 'geocoded').length * 0.005,
    metadata: { projectId },
  })

  return ok({ results })
}
