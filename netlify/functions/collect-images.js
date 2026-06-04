import crypto from 'crypto'
import { requireAuth, adminSupabase, ok, err, options, isValidUUID } from './utils/supabase.js'
import { getUserUsage } from './utils/usage.js'

const PLATFORM_KEY = process.env.GOOGLE_MAPS_KEY
const CAP          = 20

// Resolves which API key to use for this batch and whether to deduct purchased credits.
// Admin           → platform key, no credit deduction.
// Non-admin within monthly quota + has own key → own key, no credit deduction.
// Non-admin beyond monthly quota OR no own key, with purchased credits → platform key, deduct credits.
// Otherwise       → null (blocked).
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
  const withinMonthlyQuota = used < limit

  if (withinMonthlyQuota && keyRow?.google_maps_key) {
    return { apiKey: keyRow.google_maps_key, deductPurchased: false, remaining: limit - used }
  }

  if (purchasedRemaining > 0) {
    return { apiKey: PLATFORM_KEY, deductPurchased: true, remaining: purchasedRemaining }
  }

  return { apiKey: null, deductPurchased: false, remaining: 0 }
}

async function downloadGoogleImage(lat, lng, heading, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${lat},${lng}&heading=${heading}&pitch=15&fov=80&return_error_code=true&key=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) return null
  if (!(res.headers.get('content-type') || '').includes('image')) return null
  return res.arrayBuffer()
}

async function processPoint(pt, projectId, userId, apiKey, supabase) {
  const { id: pointId, lat, lng, road_bearing } = pt

  try {
    if (!apiKey) return { pointId, status: 'error', error: 'No Google Maps API key configured' }

    // Road bearing stored at generation time from OSM geometry.
    // Rotate 90° perpendicular to face properties across the street.
    const heading = ((road_bearing ?? 0) + 90) % 360

    await supabase.from('scan_points')
      .update({ status: 'downloading', updated_at: new Date().toISOString() })
      .eq('id', pointId)

    // Single API call: image download only ($0.007)
    const buffer = await downloadGoogleImage(lat, lng, heading, apiKey)
    if (!buffer) {
      await supabase.from('scan_points')
        .update({ status: 'no_coverage', updated_at: new Date().toISOString() })
        .eq('id', pointId)
      return { pointId, status: 'no_coverage' }
    }

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
