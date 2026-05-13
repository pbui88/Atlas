import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

const GOOGLE_KEY = process.env.GOOGLE_MAPS_KEY
const CAP        = 20   // points processed in parallel per function call

async function getPanoInfo(lat, lng) {
  try {
    const url  = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${GOOGLE_KEY}`
    const res  = await fetch(url)
    const data = await res.json()
    if (data.status !== 'OK') return null
    return { heading: data.heading ?? 0 }
  } catch {
    return null
  }
}

async function downloadImage(lat, lng, heading) {
  const url = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${lat},${lng}&heading=${heading}&pitch=15&fov=72&return_error_code=true&key=${GOOGLE_KEY}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Street View ${res.status}`)
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('image')) throw new Error('Not an image (no coverage?)')
  return res.arrayBuffer()
}

async function processPoint(pt, projectId, userId, supabase) {
  const { id: pointId, lat, lng } = pt

  try {
    const pano = await getPanoInfo(lat, lng)
    if (!pano) {
      await supabase.from('scan_points')
        .update({ status: 'no_coverage', updated_at: new Date().toISOString() })
        .eq('id', pointId)
      return { pointId, status: 'no_coverage' }
    }

    await supabase.from('scan_points')
      .update({ status: 'downloading', updated_at: new Date().toISOString() })
      .eq('id', pointId)

    const heading     = (pano.heading + 90) % 360
    const storagePath = `${projectId}/${pointId}/F.jpg`

    let buffer
    try {
      buffer = await downloadImage(lat, lng, heading)
    } catch (dlErr) {
      await supabase.from('scan_points')
        .update({ status: 'failed', error_msg: dlErr.message, updated_at: new Date().toISOString() })
        .eq('id', pointId)
      return { pointId, status: 'failed' }
    }

    const { error: upErr } = await supabase.storage
      .from('street-view-images')
      .upload(storagePath, buffer, { contentType: 'image/jpeg', upsert: true })

    if (upErr) {
      await supabase.from('scan_points')
        .update({ status: 'failed', error_msg: upErr.message, updated_at: new Date().toISOString() })
        .eq('id', pointId)
      return { pointId, status: 'failed' }
    }

    const { data: { publicUrl } } = supabase.storage
      .from('street-view-images')
      .getPublicUrl(storagePath)

    await supabase.from('images').insert({
      scan_point_id: pointId,
      direction:     'F',
      heading,
      storage_path:  storagePath,
      storage_url:   publicUrl,
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
  const ids      = pointIds.slice(0, CAP)

  // Batch-fetch all point data in one query
  const { data: pts } = await supabase
    .from('scan_points')
    .select('id, lat, lng, project_id')
    .in('id', ids)

  if (!pts?.length) return ok({ results: [] })

  // Process all points in parallel
  const settled = await Promise.allSettled(
    pts.map(pt => processPoint(pt, projectId, user.id, supabase))
  )

  const results = settled.map(s =>
    s.status === 'fulfilled' ? s.value : { pointId: null, status: 'error' }
  )

  // Update project completed_points counter
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
