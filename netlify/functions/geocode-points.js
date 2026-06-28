import { requireAuth, adminSupabase, ok, err, options, isValidUUID } from './utils/supabase.js'

const CAP = 50   // points geocoded in parallel per function call

// Fetch the actual Street View panorama location (free metadata call).
// The panorama is where the camera physically was — offset from here gives
// a much more accurate property geocoding than offsetting from the road center.
async function getPanoramaLocation(lat, lng, apiKey) {
  try {
    const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&return_error_code=true&key=${apiKey}`
    const res  = await fetch(url)
    const data = await res.json()
    if (data.status === 'OK' && data.location) return data.location
  } catch {}
  return null
}

// Resolve a Google Maps API key for metadata calls.
async function resolveGoogleKey(userId, supabase) {
  const [{ data: keyRow }, { data: profile }] = await Promise.all([
    supabase.from('user_keys').select('google_maps_key').eq('user_id', userId).maybeSingle(),
    supabase.from('profiles').select('role').eq('id', userId).maybeSingle(),
  ])
  return keyRow?.google_maps_key || (profile?.role === 'admin' ? process.env.GOOGLE_MAPS_KEY : null)
}

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

  const regionCode = (property.region_code || property.region || '').trim()

  // Never use Positionstack's postal_code — it returns malformed values in
  // some areas (e.g. "797 69", "982 27"). Nominatim always fills the zip.
  if (property.label && !looksLikeLatLng(property.label)) {
    // Strip any zip or zip+4 PS embedded in the label, then country tokens.
    let label = property.label
      .replace(/\b\d{5}([\s-]+\d{4})?\b/g, '')
      .replace(/,?\s*(United States|USA|US)\s*$/i, '')
      .replace(/,\s*,/g, ',')
      .replace(/,\s*$/, '')
      .trim()
    return looksLikeLatLng(label) ? null : label
  }

  // Fallback: build manually without zip (Nominatim fills it afterwards)
  const houseNum   = String(property.number).trim()
  const street     = property.street || property.name || ''
  const locality   = property.locality || property.county || ''
  const streetAddr = [houseNum, street].filter(Boolean).join(' ')
  const parts      = [streetAddr, locality, regionCode].filter(Boolean)

  const address = parts.join(', ')
  return (!address || looksLikeLatLng(address)) ? null : address
}

// Returns a property-level address or null.
// Retries once with a wider candidate pool if the first pass yields nothing.
async function reverseGeocode(lat, lng) {
  const base = `https://api.positionstack.com/v1/reverse?access_key=${process.env.POSITIONSTACK_API_KEY}&query=${lat},${lng}&output=json`

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

// Free zip-code fallback via Nominatim (OpenStreetMap).
// Called only when Positionstack returns an address without a 5-digit zip.
async function lookupZip(lat, lng) {
  try {
    const res  = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'User-Agent': 'AtlasApp/1.0' } }
    )
    const data = await res.json()
    return data.address?.postcode?.replace(/\s*-?\d{4}$/, '').trim() || null
  } catch {
    return null
  }
}

// Inject a zip code into an address that already has a 2-letter state abbreviation.
// Strips any existing trailing digits first (partial or wrong zip from Positionstack)
// so we never get "TX 7 79763" or "TX 79769 79763".
// "123 Main St, Phoenix, AZ"       → "123 Main St, Phoenix, AZ 85001"
// "123 Main St, Phoenix, AZ 7"     → "123 Main St, Phoenix, AZ 85001"
// "123 Main St, Phoenix, AZ 79769" → "123 Main St, Phoenix, AZ 85001"
function injectZip(address, zip) {
  const stripped = address.replace(/[\s\d-]+$/, '').trim()
  const patched  = stripped.replace(/(,\s*)([A-Z]{2})$/, `$1$2 ${zip}`)
  return patched !== stripped ? patched : `${stripped} ${zip}`
}

async function geocodePoint(pt, googleKey, supabase) {
  // Skip only if address already has a 5-digit zip — it's complete.
  if (pt.address && !looksLikeLatLng(pt.address) && /\d{5}\s*$/.test(pt.address)) {
    return { pointId: pt.id, status: 'skipped' }
  }

  // Address exists but missing zip — skip Positionstack, only need Nominatim.
  if (pt.address && !looksLikeLatLng(pt.address)) {
    try {
      const zip = await lookupZip(pt.lat, pt.lng)
      if (zip) {
        const address = injectZip(pt.address, zip)
        await supabase.from('scan_points')
          .update({ address, updated_at: new Date().toISOString() })
          .eq('id', pt.id)
        return { pointId: pt.id, status: 'geocoded', address }
      }
    } catch (e) {
      console.error(`Zip lookup failed ${pt.id}:`, e.message)
    }
    return { pointId: pt.id, status: 'no_zip' }
  }

  try {
    let address = null
    const headingDeg = pt.road_bearing != null ? (pt.road_bearing + 90) % 360 : null

    // Use actual panorama location as the base for offsetting — it's where the
    // Street View camera physically was, giving much more accurate property geocoding.
    let baseLat = pt.lat
    let baseLng = pt.lng
    if (googleKey) {
      const pano = await getPanoramaLocation(pt.lat, pt.lng, googleKey)
      if (pano) { baseLat = pano.lat; baseLng = pano.lng }
    }

    let geocodeLat = baseLat, geocodeLng = baseLng
    if (headingDeg != null) {
      const { lat, lng } = offsetCoords(baseLat, baseLng, headingDeg, 20)
      geocodeLat = lat; geocodeLng = lng
      address = await reverseGeocode(lat, lng)
    } else {
      // No road bearing (grid fallback): try both perpendicular directions
      const { lat: lat1, lng: lng1 } = offsetCoords(baseLat, baseLng, 90, 20)
      address = await reverseGeocode(lat1, lng1)
      if (address) { geocodeLat = lat1; geocodeLng = lng1 }
      if (!address) {
        const { lat: lat2, lng: lng2 } = offsetCoords(baseLat, baseLng, 270, 20)
        address = await reverseGeocode(lat2, lng2)
        if (address) { geocodeLat = lat2; geocodeLng = lng2 }
      }
      if (!address) address = await reverseGeocode(baseLat, baseLng)
    }

    // Always get the zip from Nominatim — Positionstack's postal data is
    // unreliable (returns malformed values like "797 69" in some areas).
    if (address) {
      const zip = await lookupZip(geocodeLat, geocodeLng)
      if (zip) address = injectZip(address, zip)
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

  if (!process.env.POSITIONSTACK_API_KEY) return err('POSITIONSTACK_API_KEY not configured', 503)

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

  const googleKey = await resolveGoogleKey(user.id, supabase)

  const settled = await Promise.allSettled(
    pts.map(pt => geocodePoint(pt, googleKey, supabase))
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
