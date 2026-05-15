import crypto from 'crypto'
import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

const GOOGLE_KEY     = process.env.GOOGLE_MAPS_KEY
const MAPILLARY_KEY  = process.env.MAPILLARY_ACCESS_TOKEN
const CAP            = 20    // points processed in parallel per function call
const MAPILLARY_RADIUS_M = 50 // search radius for Mapillary imagery

// ── Mapillary (primary, free) ────────────────────────────────────────────────

async function fetchMapillaryImage(lat, lng) {
  if (!MAPILLARY_KEY) return null

  // Build a small bbox (~50m) around the point
  const d = MAPILLARY_RADIUS_M / 111320
  const bbox = [lng - d, lat - d, lng + d, lat + d].join(',')

  const metaUrl = `https://graph.mapillary.com/images?fields=id,thumb_2048_url,compass_angle,computed_compass_angle,geometry&bbox=${bbox}&limit=5`
  const metaRes = await fetch(metaUrl, {
    headers: { Authorization: `OAuth ${MAPILLARY_KEY}` },
  })
  if (!metaRes.ok) return null
  const meta = await metaRes.json()
  if (!meta.data?.length) return null

  // Pick the closest image to our target point
  const best = meta.data
    .map(img => {
      const [imgLng, imgLat] = img.geometry?.coordinates || [0, 0]
      const dist = Math.hypot((imgLat - lat) * 111320, (imgLng - lng) * 111320)
      return { img, dist }
    })
    .sort((a, b) => a.dist - b.dist)[0]?.img

  if (!best?.thumb_2048_url) return null

  const imgRes = await fetch(best.thumb_2048_url)
  if (!imgRes.ok) return null
  const ct = imgRes.headers.get('content-type') || ''
  if (!ct.includes('image')) return null

  const heading = best.computed_compass_angle ?? best.compass_angle ?? 0
  return {
    buffer:  await imgRes.arrayBuffer(),
    heading,
    source:  'mapillary',
    panoId:  best.id,
  }
}

// ── Google Street View (fallback, paid) ──────────────────────────────────────

async function fetchGoogleImage(lat, lng) {
  if (!GOOGLE_KEY) return null

  const metaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${GOOGLE_KEY}`
  const metaRes = await fetch(metaUrl)
  const meta    = await metaRes.json()
  if (meta.status !== 'OK') return null

  const heading = ((meta.heading ?? 0) + 90) % 360
  const imgUrl  = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${lat},${lng}&heading=${heading}&pitch=15&fov=72&return_error_code=true&key=${GOOGLE_KEY}`
  const imgRes  = await fetch(imgUrl)
  if (!imgRes.ok) return null
  const ct = imgRes.headers.get('content-type') || ''
  if (!ct.includes('image')) return null

  return {
    buffer:  await imgRes.arrayBuffer(),
    heading,
    source:  'google',
    panoId:  meta.pano_id || null,
  }
}

// ── Per-point pipeline ───────────────────────────────────────────────────────

async function processPoint(pt, projectId, userId, supabase) {
  const { id: pointId, lat, lng } = pt

  try {
    // 1. Try Mapillary first, fall back to Google
    let img = null
    try { img = await fetchMapillaryImage(lat, lng) } catch { /* fall through */ }
    if (!img) {
      try { img = await fetchGoogleImage(lat, lng) } catch { /* fall through */ }
    }

    if (!img) {
      await supabase.from('scan_points')
        .update({ status: 'no_coverage', updated_at: new Date().toISOString() })
        .eq('id', pointId)
      return { pointId, status: 'no_coverage' }
    }

    await supabase.from('scan_points')
      .update({ status: 'downloading', updated_at: new Date().toISOString() })
      .eq('id', pointId)

    const buffer      = img.buffer
    const imageHash   = crypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex')
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

    const { data: { publicUrl } } = supabase.storage
      .from('street-view-images')
      .getPublicUrl(storagePath)

    await supabase.from('images').insert({
      scan_point_id: pointId,
      direction:     'F',
      heading:       img.heading,
      storage_path:  storagePath,
      storage_url:   publicUrl,
      panorama_id:   img.panoId,
      image_hash:    imageHash,
      image_source:  img.source,
      size_bytes:    buffer.byteLength,
    })

    await supabase.from('scan_points')
      .update({ status: 'downloaded', error_msg: null, updated_at: new Date().toISOString() })
      .eq('id', pointId)

    // Mapillary is free; Google Street View is $7 / 1k = $0.007 per call
    const costUsd = img.source === 'google' ? 0.007 : 0
    await supabase.from('usage_logs').insert({
      user_id:  userId,
      service:  img.source === 'google' ? 'street_view' : 'mapillary',
      action:   'image_download',
      count:    1,
      cost_usd: costUsd,
      metadata: { projectId, pointId, source: img.source },
    })

    return { pointId, status: 'downloaded', source: img.source }
  } catch (e) {
    await supabase.from('scan_points')
      .update({ status: 'failed', error_msg: e.message, updated_at: new Date().toISOString() })
      .eq('id', pointId)
    return { pointId, status: 'failed' }
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  if (!GOOGLE_KEY && !MAPILLARY_KEY) {
    return err('No image provider configured (MAPILLARY_ACCESS_TOKEN or GOOGLE_MAPS_KEY)', 503)
  }

  const { projectId, pointIds } = JSON.parse(event.body || '{}')
  if (!projectId || !Array.isArray(pointIds) || !pointIds.length) {
    return err('projectId and pointIds required')
  }

  const supabase = adminSupabase()
  const ids      = pointIds.slice(0, CAP)

  const { data: pts } = await supabase
    .from('scan_points')
    .select('id, lat, lng, project_id')
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
