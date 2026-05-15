import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

const POSITIONSTACK_KEY = process.env.POSITIONSTACK_API_KEY
const CAP               = 50   // points geocoded in parallel per function call

// Rejects strings that look like raw coordinates, e.g. "37.123, -122.456"
function looksLikeLatLng(str) {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test((str || '').trim())
}

// Attempts to extract a property-level address from a PositionStack response.
// Returns a valid address string, or null if none found.
function extractAddress(results) {
  const property = results.find(r => (r.number != null && String(r.number).trim() !== '') || r.type === 'address')
  if (!property) return null

  const parts = [property.name, property.locality, property.region_code, property.postal_code].filter(Boolean)
  const address = parts.length > 0 ? parts.join(', ') : property.label || null

  if (!address || looksLikeLatLng(address)) return null
  return address
}

// Returns a property-level address or null.
// Retries once with a wider candidate pool if the first pass yields nothing.
async function reverseGeocode(lat, lng) {
  const base = `http://api.positionstack.com/v1/reverse?access_key=${POSITIONSTACK_KEY}&query=${lat},${lng}&output=json`

  // First attempt — tight limit
  const res1  = await fetch(`${base}&limit=10`)
  const data1 = await res1.json()
  if (data1.error) throw new Error(data1.error.message || `Positionstack error (${data1.error.code})`)

  const address1 = extractAddress(data1.data || [])
  if (address1) return address1

  // Retry with wider candidate pool to find a property-level hit
  console.warn(`[geocode] first pass found no property address at ${lat},${lng} — retrying with limit=25`)
  const res2  = await fetch(`${base}&limit=25`)
  const data2 = await res2.json()
  if (data2.error) throw new Error(data2.error.message || `Positionstack error (${data2.error.code})`)

  const address2 = extractAddress(data2.data || [])
  if (!address2) {
    console.warn(`[geocode] retry also failed at ${lat},${lng} — no property address found`)
  }
  return address2
}

async function geocodePoint(pt, supabase) {
  // Skip only if address exists AND is not a raw coordinate string
  if (pt.address && !looksLikeLatLng(pt.address)) {
    return { pointId: pt.id, status: 'skipped' }
  }

  if (pt.address) {
    console.warn(`[geocode] re-geocoding ${pt.id} — existing address is a coordinate: "${pt.address}"`)
  }

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

  // Fetch the requested points
  const { data: requested } = await supabase
    .from('scan_points')
    .select('id, lat, lng, address')
    .in('id', pointIds.slice(0, CAP))

  // Also find any points in this project that have a lat/lng-looking address
  // so they get cleaned up even if not in the current batch
  const { data: badAddressed } = await supabase
    .from('scan_points')
    .select('id, lat, lng, address')
    .eq('project_id', projectId)
    .not('address', 'is', null)

  const latLngPts = (badAddressed || []).filter(p => looksLikeLatLng(p.address))

  // Merge, deduplicate by id, cap total
  const seen = new Set()
  const pts  = []
  for (const pt of [...(requested || []), ...latLngPts]) {
    if (!seen.has(pt.id)) { seen.add(pt.id); pts.push(pt) }
    if (pts.length >= CAP) break
  }

  if (!pts.length) return ok({ results: [] })

  const settled = await Promise.allSettled(
    pts.map(pt => geocodePoint(pt, supabase))
  )

  const results       = settled.map(s => s.status === 'fulfilled' ? s.value : { status: 'error' })
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
