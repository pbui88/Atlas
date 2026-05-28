import crypto from 'crypto'
import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'
import { getUserUsage } from './utils/usage.js'

const GOOGLE_KEY = process.env.GOOGLE_MAPS_KEY
const CAP        = 20

async function downloadGoogleImage(lat, lng, heading) {
  const url = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${lat},${lng}&heading=${heading}&pitch=15&fov=80&return_error_code=true&key=${GOOGLE_KEY}`
  const res = await fetch(url)
  if (!res.ok) return null
  if (!(res.headers.get('content-type') || '').includes('image')) return null
  return res.arrayBuffer()
}

async function processPoint(pt, projectId, userId, supabase) {
  const { id: pointId, lat, lng, road_bearing } = pt

  try {
    if (!GOOGLE_KEY) return { pointId, status: 'error', error: 'GOOGLE_MAPS_KEY not configured' }

    // Road bearing stored at generation time from OSM geometry.
    // Rotate 90° perpendicular to face properties across the street.
    const heading = ((road_bearing ?? 0) + 90) % 360

    await supabase.from('scan_points')
      .update({ status: 'downloading', updated_at: new Date().toISOString() })
      .eq('id', pointId)

    // Single API call: image download only ($0.007)
    const buffer = await downloadGoogleImage(lat, lng, heading)
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

  if (!GOOGLE_KEY) return err('GOOGLE_MAPS_KEY not configured', 503)

  const { projectId, pointIds } = JSON.parse(event.body || '{}')
  if (!projectId || !Array.isArray(pointIds) || !pointIds.length) {
    return err('projectId and pointIds required')
  }

  const supabase = adminSupabase()

  const { remaining, used, limit } = await getUserUsage(user.id, supabase)
  if (remaining <= 0) {
    return err(`Monthly limit reached — ${used.toLocaleString()} / ${limit.toLocaleString()} points used this cycle.`, 429)
  }

  const ids = pointIds.slice(0, Math.min(CAP, remaining))

  const { data: pts } = await supabase
    .from('scan_points')
    .select('id, lat, lng, road_bearing')
    .in('id', ids)

  if (!pts?.length) return ok({ results: [] })

  const settled = await Promise.allSettled(
    pts.map(pt => processPoint(pt, projectId, user.id, supabase))
  )

  const results = settled.map(s =>
    s.status === 'fulfilled' ? s.value : { pointId: null, status: 'error' }
  )

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
