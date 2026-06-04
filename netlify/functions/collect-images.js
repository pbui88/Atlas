import crypto from 'crypto'
import { requireAuth, adminSupabase, ok, err, options, isValidUUID } from './utils/supabase.js'
import { getUserUsage } from './utils/usage.js'

const PLATFORM_KEY = process.env.GOOGLE_MAPS_KEY
const CAP          = 20

// Resolves which Google API key to use for billing and whether to deduct purchased credits.
// Admin           → platform key, no credit deduction.
// Non-admin       → ALWAYS deducts purchased credits.
//   Within 10k/month + has own key → own key (billed to user's Google account).
//   Beyond 10k/month OR no own key → platform key (billed to platform).
//   No purchased credits remaining → blocked.
async function resolveApiKeyAndMode(userId, supabase) {
  const [{ data: keyRow }, { data: profile }, usage] = await Promise.all([
    supabase.from('user_keys').select('google_maps_key').eq('user_id', userId).maybeSingle(),
    supabase.from('profiles').select('role').eq('id', userId).maybeSingle(),
    getUserUsage(userId, supabase),
  ])

  if (profile?.role === 'admin') {
    return { apiKey: PLATFORM_KEY, deductPurchased: false, remaining: Infinity }
  }

  const { used, limit, purchasedRemaining } = usage

  if (purchasedRemaining <= 0) {
    return { apiKey: null, deductPurchased: false, remaining: 0 }
  }

  // Route to own key if within monthly 10k quota and key exists, else platform key
  const useOwnKey = used < limit && !!keyRow?.google_maps_key
  return {
    apiKey:           useOwnKey ? keyRow.google_maps_key : PLATFORM_KEY,
    deductPurchased:  true,
    remaining:        purchasedRemaining,
  }
}

// Compass bearing (degrees) from point A to point B.
function bearingTo(lat1, lng1, lat2, lng2) {
  const R  = Math.PI / 180
  const y  = Math.sin((lng2 - lng1) * R) * Math.cos(lat2 * R)
  const x  = Math.cos(lat1 * R) * Math.sin(lat2 * R)
           - Math.sin(lat1 * R) * Math.cos(lat2 * R) * Math.cos((lng2 - lng1) * R)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

// Offset a lat/lng by distanceMeters in a compass direction.
function offsetCoords(lat, lng, headingDeg, distanceMeters) {
  const R       = 6371000
  const bearing = (headingDeg * Math.PI) / 180
  const lat1    = (lat * Math.PI) / 180
  const lng1    = (lng * Math.PI) / 180
  const lat2    = Math.asin(
    Math.sin(lat1) * Math.cos(distanceMeters / R) +
    Math.cos(lat1) * Math.sin(distanceMeters / R) * Math.cos(bearing)
  )
  const lng2    = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(distanceMeters / R) * Math.cos(lat1),
    Math.cos(distanceMeters / R) - Math.sin(lat1) * Math.sin(lat2)
  )
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI }
}

// Fetch actual panorama position from Street View Metadata API (free — $0).
async function getPanoramaLocation(lat, lng, apiKey) {
  try {
    const res  = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&return_error_code=true&key=${apiKey}`)
    const data = await res.json()
    if (data.status === 'OK' && data.location) return data.location
  } catch {}
  return null
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
  const { id: pointId, lat, lng, road_bearing } = pt

  try {
    if (!apiKey) return { pointId, status: 'error', error: 'No Google Maps API key configured' }

    // Get actual panorama position (free metadata call).
    // The panorama is where the Street View car physically was — slightly off
    // the road center. Compute heading from there directly toward the property
    // so the camera faces the house front exactly, not just "perpendicular to the road."
    const pano        = await getPanoramaLocation(lat, lng, apiKey) ?? { lat, lng }
    const perpDeg     = ((road_bearing ?? 0) + 90) % 360
    const propPos     = offsetCoords(pano.lat, pano.lng, perpDeg, 20)
    const heading     = Math.round(bearingTo(pano.lat, pano.lng, propPos.lat, propPos.lng))

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

  const { apiKey, deductPurchased, remaining } = await resolveApiKeyAndMode(user.id, supabase)
  if (!apiKey) return err('No API key or credits available. Contact your admin.', 503)
  if (remaining <= 0) return err('Insufficient credits — contact your admin to add more credits.', 429)

  const ids = validIds.slice(0, Math.min(CAP, remaining === Infinity ? CAP : remaining))

  const { data: pts } = await supabase
    .from('scan_points')
    .select('id, lat, lng, road_bearing')
    .in('id', ids)

  if (!pts?.length) return ok({ results: [] })

  const settled = await Promise.allSettled(
    pts.map(pt => processPoint(pt, projectId, user.id, apiKey, supabase))
  )

  // Surface API key errors as 503 so the frontend scan aborts with a clear message
  const keyError = settled.find(s => s.status === 'rejected' && s.reason?.message?.includes('API key error'))
  if (keyError) return err(keyError.reason.message, 503)

  const results = settled.map(s =>
    s.status === 'fulfilled' ? s.value : { pointId: null, status: 'error' }
  )

  // Only deduct purchased credits when using the platform key (beyond monthly quota).
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
