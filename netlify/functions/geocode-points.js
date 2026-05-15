import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

const POSITIONSTACK_KEY = process.env.POSITIONSTACK_API_KEY
const CAP               = 50   // points geocoded in parallel per function call

// Returns a property-level address (must have a house number) or null.
// Street-only matches ("North Tom Green Avenue") are rejected so the caller
// can retry the point on the next scan run instead of locking in a bad value.
async function reverseGeocode(lat, lng) {
  const url = `http://api.positionstack.com/v1/reverse?access_key=${POSITIONSTACK_KEY}&query=${lat},${lng}&limit=10&output=json`
  const res  = await fetch(url)
  const data = await res.json()

  if (data.error) throw new Error(data.error.message || `Positionstack error (${data.error.code})`)

  const results = data.data || []
  if (!results.length) return null

  // Prefer property-level: has a numeric house number, or PositionStack
  // labels the type 'address'. Reject street-only / locality-only hits.
  const property = results.find(r => (r.number != null && String(r.number).trim() !== '') || r.type === 'address')
  if (!property) return null

  const parts = [property.name, property.locality, property.region_code, property.postal_code].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : property.label || null
}

async function geocodePoint(pt, supabase) {
  if (pt.address) return { pointId: pt.id, status: 'skipped' }
  try {
    const address = await reverseGeocode(pt.lat, pt.lng)
    if (address) {
      await supabase.from('scan_points')
        .update({ address, updated_at: new Date().toISOString() })
        .eq('id', pt.id)
      return { pointId: pt.id, status: 'geocoded', address }
    }
    return { pointId: pt.id, status: 'no_result' }
  } catch (e) {
    console.error(`Geocode failed ${pt.id}:`, e.message)
    return { pointId: pt.id, status: 'error', error: e.message }
  }
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
  const ids      = pointIds.slice(0, CAP)

  // Batch-fetch all point data
  const { data: pts } = await supabase
    .from('scan_points')
    .select('id, lat, lng, address')
    .in('id', ids)

  if (!pts?.length) return ok({ results: [] })

  // Process all points in parallel
  const settled = await Promise.allSettled(
    pts.map(pt => geocodePoint(pt, supabase))
  )

  const results      = settled.map(s => s.status === 'fulfilled' ? s.value : { status: 'error' })
  const geocodedCount = results.filter(r => r.status === 'geocoded').length

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
