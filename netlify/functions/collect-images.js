import crypto from 'crypto'
import { requireAuth, adminSupabase, ok, err, options, isValidUUID } from './utils/supabase.js'
import { getUserUsage } from './utils/usage.js'

const PLATFORM_KEY = process.env.GOOGLE_MAPS_KEY
const CAP          = 20

// Resolves Google API key(s) to use for billing and whether to deduct purchased credits.
// Admin           → platform key for everything, no credit deduction.
// Non-admin       → ALWAYS deducts purchased credits (lifetime balance, regardless of key).
//   No purchased credits remaining → blocked.
//   Own key covers up to (points_limit - used) downloads remaining this cycle;
//   any points beyond that — even within the same batch — fall back to the
//   platform key, so a batch straddling the monthly boundary is split correctly.
async function resolveApiKeyAndMode(userId, supabase) {
  const [{ data: keyRow }, { data: profile }, usage] = await Promise.all([
    supabase.from('user_keys').select('google_maps_key').eq('user_id', userId).maybeSingle(),
    supabase.from('profiles').select('role').eq('id', userId).maybeSingle(),
    getUserUsage(userId, supabase),
  ])

  if (profile?.role === 'admin') {
    return { ownKey: null, ownKeyCapacity: 0, platformKey: PLATFORM_KEY, deductPurchased: false, remaining: Infinity }
  }

  const { used, limit, purchasedRemaining } = usage

  if (purchasedRemaining <= 0) {
    return { ownKey: null, ownKeyCapacity: 0, platformKey: null, deductPurchased: false, remaining: 0 }
  }

  return {
    ownKey:          keyRow?.google_maps_key ?? null,
    ownKeyCapacity:  keyRow?.google_maps_key ? Math.max(0, limit - used) : 0,
    platformKey:     PLATFORM_KEY,
    deductPurchased: true,
    remaining:       purchasedRemaining,
  }
}

// Fetch the actual Street View panorama location (free metadata, no charge).
// Returns { lat, lng } of where Google's camera physically is, or null.
async function getPanoramaLocation(lat, lng, apiKey) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res  = await fetch(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&return_error_code=true&key=${apiKey}`,
      { signal: controller.signal }
    )
    const data = await res.json()
    if (data.status === 'OK' && data.location) return data.location
  } catch { /* timeout or network error — fall back to road_bearing */ }
  finally { clearTimeout(timer) }
  return null
}

// Compass bearing (degrees, 0=North) from one coordinate to another.
function bearingTo(fromLat, fromLng, toLat, toLng) {
  const lat1 = fromLat * Math.PI / 180
  const lat2 = toLat   * Math.PI / 180
  const dLng = (toLng - fromLng) * Math.PI / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

// Returns: { buffer } on success, { noCoverage: true } for 404 (no imagery),
// or throws an Error for 400/403 (bad key / API not enabled).
async function downloadGoogleImage(lat, lng, heading, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${lat},${lng}&heading=${heading}&pitch=0&fov=60&return_error_code=true&key=${apiKey}`
  const res = await fetch(url)
  if (res.status === 403 || res.status === 400) {
    throw new Error(`Street View API key error (HTTP ${res.status}) — check the key is valid and Street View Static API is enabled.`)
  }
  if (!res.ok) return { noCoverage: true }
  if (!(res.headers.get('content-type') || '').includes('image')) return { noCoverage: true }
  return { buffer: await res.arrayBuffer() }
}

async function processPoint(pt, projectId, userId, apiKey, supabase) {
  const { id: pointId, lat, lng, road_bearing, property_lat, property_lng } = pt

  try {
    if (!apiKey) return { pointId, status: 'error', error: 'No Google Maps API key configured' }

    // Get the actual panorama position (free metadata call) — that's where the
    // Street View camera physically was, so it's the origin for the camera heading.
    const pano = await getPanoramaLocation(lat, lng, apiKey)
    let heading
    if (property_lat != null && property_lng != null) {
      // Aim from the camera at the geocoded property point (20 m off the road on
      // the correct side) so the image faces the house, not the road. Falls back
      // to perpendicular-to-road if the panorama metadata call failed.
      heading = pano
        ? Math.round(bearingTo(pano.lat, pano.lng, property_lat, property_lng))
        : Math.round((road_bearing ?? 0) + 90) % 360
    } else if (pano) {
      // No property coords (geocode failed): aim from the camera at the scan point.
      const dist = Math.abs(pano.lat - lat) + Math.abs(pano.lng - lng)
      heading = dist > 1e-7
        ? Math.round(bearingTo(pano.lat, pano.lng, lat, lng))   // panorama → scan point
        : Math.round((road_bearing ?? 0) + 90) % 360            // same spot, fall back
    } else {
      heading = Math.round((road_bearing ?? 0) + 90) % 360
    }

    await supabase.from('scan_points')
      .update({ status: 'downloading', updated_at: new Date().toISOString() })
      .eq('id', pointId)

    const result = await downloadGoogleImage(lat, lng, heading, apiKey)

    if (result.noCoverage) {
      await supabase.from('scan_points')
        .update({ status: 'no_coverage', updated_at: new Date().toISOString() })
        .eq('id', pointId)
      return { pointId, status: 'no_coverage' }
    }

    const { buffer } = result

    const storagePath = `${projectId}/${pointId}/F.jpg`
    const { error: upErr } = await supabase.storage
      .from('street-view-images')
      .upload(storagePath, buffer, { contentType: 'image/jpeg', upsert: true })

    if (upErr) {
      await supabase.from('scan_points')
        .update({ status: 'failed', error_msg: upErr.message, updated_at: new Date().toISOString() })
        .eq('id', pointId)
      return { pointId, status: 'failed' }
    }

    const { data: { publicUrl } } = supabase.storage.from('street-view-images').getPublicUrl(storagePath)

    await supabase.from('images').insert({
      scan_point_id: pointId,
      direction:     'F',
      heading,
      storage_path:  storagePath,
      storage_url:   publicUrl,
      image_hash:    crypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex'),
      image_source:  'google',
      size_bytes:    buffer.byteLength,
    })

    await supabase.from('scan_points')
      .update({ status: 'downloaded', error_msg: null, updated_at: new Date().toISOString() })
      .eq('id', pointId)

    await supabase.from('usage_logs').insert({
      user_id:  userId,
      service:  'street_view',
      action:   'image_download',
      count:    1,
      cost_usd: 0.007,
      metadata: { projectId, pointId },
    })

    return { pointId, status: 'downloaded' }
  } catch (e) {
    console.error(`processPoint failed ${pointId}:`, e.message)
    // Re-throw API key errors so the handler can return a 503 to the frontend
    if (e.message.includes('API key error')) throw e
    await supabase.from('scan_points')
      .update({ status: 'failed', error_msg: e.message, updated_at: new Date().toISOString() })
      .eq('id', pointId)
    return { pointId, status: 'failed' }
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  let projectId, pointIds
  try { ({ projectId, pointIds } = JSON.parse(event.body || '{}')) }
  catch { return err('Invalid request body', 400) }
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

  const { ownKey, ownKeyCapacity, platformKey, deductPurchased, remaining } = await resolveApiKeyAndMode(user.id, supabase)
  if (!ownKey && !platformKey) return err('No API key or credits available. Contact your admin.', 503)
  if (remaining <= 0) return err('Insufficient credits — contact your admin to add more credits.', 429)

  const ids = validIds.slice(0, Math.min(CAP, remaining === Infinity ? CAP : remaining))

  const { data: pts } = await supabase
    .from('scan_points')
    .select('id, lat, lng, road_bearing, property_lat, property_lng')
    .in('id', ids)

  if (!pts?.length) return ok({ results: [] })

  const settled = await Promise.allSettled(
    pts.map((pt, i) => processPoint(pt, projectId, user.id, i < ownKeyCapacity ? ownKey : platformKey, supabase))
  )

  // Surface API key errors as 503 so the frontend scan aborts with a clear message
  const keyError = settled.find(s => s.status === 'rejected' && s.reason?.message?.includes('API key error'))
  if (keyError) return err(keyError.reason.message, 503)

  const results = settled.map(s =>
    s.status === 'fulfilled' ? s.value : { pointId: null, status: 'error' }
  )

  // Non-admin users always deduct from their lifetime purchased/granted credit
  // balance, regardless of which key was billed (deductPurchased is false only
  // for admins — see resolveApiKeyAndMode).
  const downloadedCount = results.filter(r => r.status === 'downloaded').length
  if (deductPurchased && downloadedCount > 0) {
    await supabase.rpc('increment_purchased_credits_used', {
      p_user_id: user.id,
      p_points:  downloadedCount,
    })
  }

  const { count: completed } = await supabase
    .from('scan_points')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .in('status', ['downloaded', 'analyzing', 'complete'])

  await supabase.from('projects').update({
    completed_points: completed || 0,
    status:           'collecting',
    updated_at:       new Date().toISOString(),
  }).eq('id', projectId)

  return ok({ results })
}
