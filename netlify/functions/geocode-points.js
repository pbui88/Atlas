import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

const POSITIONSTACK_KEY = process.env.POSITIONSTACK_API_KEY

// Positionstack reverse geocoding — free tier: 25,000 req/month
// Docs: https://positionstack.com/documentation#reverse_geocoding
async function reverseGeocode(lat, lng) {
  const url = `http://api.positionstack.com/v1/reverse?access_key=${POSITIONSTACK_KEY}&query=${lat},${lng}&limit=1&output=json`
  const res  = await fetch(url)
  const data = await res.json()

  if (data.error) throw new Error(data.error.message || `Positionstack error (${data.error.code})`)

  const result = data.data?.[0]
  if (!result) return null

  // Build a clean address string from components
  const parts = [result.name, result.locality, result.region_code, result.postal_code].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : result.label || null
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  if (!POSITIONSTACK_KEY) return err('POSITIONSTACK_API_KEY not configured', 503)

  const { projectId, pointIds } = JSON.parse(event.body || '{}')
  if (!projectId || !Array.isArray(pointIds) || !pointIds.length) {
    return err('projectId and pointIds required')
  }

  const supabase = adminSupabase()
  const results  = []
  let geocodedCount = 0

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
        await supabase.from('scan_points')
          .update({ address, updated_at: new Date().toISOString() })
          .eq('id', pointId)
        geocodedCount++
      }
      results.push({ pointId, status: 'geocoded', address })
    } catch (e) {
      console.error(`Geocode failed ${pointId}:`, e.message)
      results.push({ pointId, status: 'error', error: e.message })
    }
  }

  // Log usage — Positionstack free tier costs $0
  if (geocodedCount > 0) {
    await supabase.from('usage_logs').insert({
      user_id:  user.id,
      service:  'geocoding',
      action:   'reverse_geocode',
      count:    geocodedCount,
      cost_usd: 0,
      metadata: { projectId, provider: 'positionstack' },
    })
  }

  return ok({ results })
}
