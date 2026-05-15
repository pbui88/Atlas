import crypto from 'crypto'
import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

const GOOGLE_KEY     = process.env.GOOGLE_MAPS_KEY
const MAPILLARY_KEY  = process.env.MAPILLARY_ACCESS_TOKEN
const CAP            = 20
const MAPILLARY_RADIUS_M    = 50
const PERPENDICULAR_TOL_DEG = 65

function angularDiff(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360)
  return d > 180 ? 360 - d : d
}

function estimateRoadBearing(angles) {
  const sorted = [...angles].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

// ── Google Street View (fallback, paid) ──────────────────────────────────────

async function fetchGoogleImage(lat, lng, roadBearing = null) {
  if (!GOOGLE_KEY) return { image: null, roadBearing: null }

  const metaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${GOOGLE_KEY}`
  const metaRes = await fetch(metaUrl)
  const meta    = await metaRes.json()
  if (meta.status !== 'OK') return { image: null, roadBearing: null }

  const baseHeading = roadBearing != null ? roadBearing : (meta.heading ?? 0)
  const heading     = (baseHeading + 90) % 360

  const imgUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${lat},${lng}&heading=${heading}&pitch=15&fov=80&return_error_code=true&key=${GOOGLE_KEY}`
  const imgRes = await fetch(imgUrl)
  if (!imgRes.ok) return { image: null, roadBearing: null }
  const ct = imgRes.headers.get('content-type') || ''
  if (!ct.includes('image')) return { image: null, roadBearing: null }

  return {
    image: {
      buffer:  await imgRes.arrayBuffer(),
      heading,
      source:  'google',
      panoId:  meta.pano_id || null,
    },
    roadBearing: meta.heading ?? null,
  }
}

// ── Mapillary (primary, free) ─────────────────────────────────────────────────

async function fetchMapillaryImage(lat, lng) {
  if (!MAPILLARY_KEY) {
    console.warn('[mapillary] MAPILLARY_ACCESS_TOKEN not set — skipping')
    return { image: null, roadBearing: null }
  }

  const d    = MAPILLARY_RADIUS_M / 111320
  const bbox = [lng - d, lat - d, lng + d, lat + d].join(',')

  const metaUrl = `https://graph.mapillary.com/images?fields=id,thumb_2048_url,compass_angle,computed_compass_angle,geometry,is_pano&bbox=${bbox}&limit=15`
  const metaRes = await fetch(metaUrl, {
    headers: { Authorization: `OAuth ${MAPILLARY_KEY}` },
  })
  if (!metaRes.ok) {
    const body = await metaRes.text().catch(() => '')
    console.warn(`[mapillary] meta ${metaRes.status} at ${lat},${lng}: ${body.slice(0, 200)}`)
    return { image: null, roadBearing: null }
  }
  const meta = await metaRes.json()
  if (!meta.data?.length) return { image: null, roadBearing: null }

  const candidates = meta.data
    .map(img => {
      const [imgLng, imgLat] = img.geometry?.coordinates || [0, 0]
      const dist  = Math.hypot((imgLat - lat) * 111320, (imgLng - lng) * 111320)
      const angle = img.computed_compass_angle ?? img.compass_angle ?? 0
      return { img, dist, angle }
    })
    .filter(c => c.img.thumb_2048_url)

  if (!candidates.length) return { image: null, roadBearing: null }

  const roadBearing = estimateRoadBearing(candidates.map(c => c.angle))
  const targetAngle = (roadBearing + 90) % 360

  candidates.sort((a, b) => {
    const aScore = (a.img.is_pano ? -90 : 0) + angularDiff(a.angle, targetAngle)
    const bScore = (b.img.is_pano ? -90 : 0) + angularDiff(b.angle, targetAngle)
    if (Math.abs(aScore - bScore) > 5) return aScore - bScore
    return a.dist - b.dist
  })

  const best     = candidates[0]
  const bestDiff = angularDiff(best.angle, targetAngle)

  if (!best.img.is_pano && bestDiff > PERPENDICULAR_TOL_DEG) {
    console.info(`[mapillary] best off-perpendicular by ${bestDiff.toFixed(0)}° — skipping`)
    return { image: null, roadBearing }
  }

  const imgRes = await fetch(best.img.thumb_2048_url)
  if (!imgRes.ok) return { image: null, roadBearing }
  const ct = imgRes.headers.get('content-type') || ''
  if (!ct.includes('image')) return { image: null, roadBearing }

  return {
    image: {
      buffer:  await imgRes.arrayBuffer(),
      heading: best.angle,
      source:  'mapillary',
      panoId:  best.img.id,
    },
    roadBearing,
  }
}

// ── Per-point pipeline ───────────────────────────────────────────────────────

async function processPoint(pt, projectId, userId, supabase) {
  const { id: pointId, lat, lng } = pt

  try {
    // 1. Mapillary (primary, free)
    let img = null
    let roadBearing = null
    try {
      const mapRes = await fetchMapillaryImage(lat, lng)
      img         = mapRes.image
      roadBearing = mapRes.roadBearing
    } catch (e) {
      console.warn(`[mapillary] threw at ${lat},${lng}: ${e.message}`)
    }

    // 2. Google Street View (fallback)
    if (!img) {
      try {
        const gsvRes = await fetchGoogleImage(lat, lng, roadBearing)
        img = gsvRes.image
      } catch (e) {
        console.warn(`[google] threw at ${lat},${lng}: ${e.message}`)
      }
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
    return err('No image provider configured (GOOGLE_MAPS_KEY or MAPILLARY_ACCESS_TOKEN)', 503)
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
