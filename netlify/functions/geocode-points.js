import { requireAuth, adminSupabase, ok, err, options, isValidUUID } from './utils/supabase.js'

const POSITIONSTACK_KEY = process.env.POSITIONSTACK_API_KEY
const CAP               = 50   // points geocoded in parallel per function call

// Offset lat/lng by distanceMeters in the given compass heading (degrees).
// Used to move the geocoding query point from the road center toward the property.
function offsetCoords(lat, lng, headingDeg, distanceMeters) {
  const R       = 6371000
  const bearing = (headingDeg * Math.PI) / 180
  const lat1    = (lat * Math.PI) / 180
  const lng1    = (lng * Math.PI) / 180
  const lat2    = Math.asin(
    Math.sin(lat1) * Math.cos(distanceMeters / R) +
    Math.cos(lat1) * Math.sin(distanceMeters / R) * Math.cos(bearing)
  )
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(distanceMeters / R) * Math.cos(lat1),
    Math.cos(distanceMeters / R) - Math.sin(lat1) * Math.sin(lat2)
  )
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI }
}

// Rejects strings that look like raw coordinates, e.g. "37.123, -122.456"
function looksLikeLatLng(str) {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test((str || '').trim())
}

// Attempts to extract a property-level address from a PositionStack response.
// Returns a valid address string with house number, or null if none found.
function extractAddress(results) {
  // Must have a house number — street-only results are too imprecise
  const property = results.find(r => r.number != null && String(r.number).trim() !== '')
  if (!property) return null

  // Use Positionstack's own formatted label — it includes number, street, city, state, zip
  if (property.label && !looksLikeLatLng(property.label)) return property.label

  // Fallback: build manually with house number first
  const houseNum   = String(property.number).trim()
  const street     = property.street || property.name || ''
  const locality   = property.locality || property.county || ''
  const regionCode = property.region_code || property.region || ''
  const postal     = property.postal_code || ''
  const streetAddr = [houseNum, street].filter(Boolean).join(' ')
  const parts      = [streetAddr, locality, regionCode, postal].filter(Boolean)

  const address = parts.join(', ')
  return (!address || looksLikeLatLng(address)) ? null : address
}

// Returns a property-level address or null.
// Retries once with a wider candidate pool if the first pass yields nothing.
async function reverseGeocode(lat, lng) {
  const base = `https://api.positionstack.com/v1/reverse?access_key=${POSITIONSTACK_KEY}&query=${lat},${lng}&output=json`

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
    let address = null

    if (pt.road_bearing != null) {
      // Known road bearing: offset 25m toward the photographed property (camera = road_bearing + 90°)
      const headingDeg = (pt.road_bearing + 90) % 360
      const { lat, lng } = offsetCoords(pt.lat, pt.lng, headingDeg, 25)
      address = await reverseGeocode(lat, lng)
    } else {
      // No road bearing (grid fallback): try both perpendicular directions and use whichever returns a result
      const { lat: lat1, lng: lng1 } = offsetCoords(pt.lat, pt.lng, 90, 25)
      address = await reverseGeocode(lat1, lng1)
      if (!address) {
        const { lat: lat2, lng: lng2 } = offsetCoords(pt.lat, pt.lng, 270, 25)
        address = await reverseGeocode(lat2, lng2)
      }
      // Last resort: use the road point itself
      if (!address) address = await reverseGeocode(pt.lat, pt.lng)
    }
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
  if (!isValidUUID(projectId) || !Array.isArray(pointIds) || !pointIds.length) {
    return err('projectId and pointIds required')
  }
  const validIds = pointIds.filter(isValidUUID)
  if (!validIds.length) return err('No valid pointIds')

  const supabase = adminSupabase()

  // Verify project belongs to this user
  const { data: project } = await supabase
    .from('projects').select('id').eq('id', projectId).eq('user_id', user.id).maybeSingle()
  if (!project) return err('Project not found', 404)

  // Fetch the requested points (road_bearing needed to offset toward the property)
  const { data: requested } = await supabase
    .from('scan_points')
    .select('id, lat, lng, address, road_bearing')
    .in('id', validIds.slice(0, CAP))

  // Also find any points in this project that have a lat/lng-looking address
  // so they get cleaned up even if not in the current batch
  const { data: badAddressed } = await supabase
    .from('scan_points')
    .select('id, lat, lng, address, road_bearing')
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
