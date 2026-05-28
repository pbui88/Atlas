import crypto from 'crypto'
import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'
import { getUserUsage } from './utils/usage.js'

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

// ── Google Street View ───────────────────────────────────────────────────────

// Compass bearing (0–360°) from point A → point B
function bearingTo(lat1, lng1, lat2, lng2) {
  const R = Math.PI / 180
  const y = Math.sin((lng2 - lng1) * R) * Math.cos(lat2 * R)
  const x = Math.cos(lat1 * R) * Math.sin(lat2 * R)
          - Math.sin(lat1 * R) * Math.cos(lat2 * R) * Math.cos((lng2 - lng1) * R)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

async function fetchGoogleMetadata(lat, lng) {
  if (!GOOGLE_KEY) return null
  const res  = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${GOOGLE_KEY}`)
  const meta = await res.json()
  if (meta.status !== 'OK') return null
  return {
    panoId:      meta.pano_id || null,
    roadHeading: meta.heading ?? 0,
    panoLat:     meta.location?.lat ?? lat,
    panoLng:     meta.location?.lng ?? lng,
  }
}

async function downloadGoogleImage(lat, lng, heading) {
  const url = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${lat},${lng}&heading=${heading}&pitch=15&fov=80&return_error_code=true&key=${GOOGLE_KEY}`
  const res = await fetch(url)
  if (!res.ok) return null
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('image')) return null
  return res.arrayBuffer()
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

// Look up a previously stored image by panorama ID (shared across all projects/users)
async function getCachedImage(panoId, source, supabase) {
  if (!panoId) return null
  const { data } = await supabase
    .from('images')
    .select('storage_url, storage_path, image_hash, size_bytes, heading')
    .eq('panorama_id', panoId)
    .eq('image_source', source)
    .limit(1)
    .maybeSingle()
  return data || null
}

async function processPoint(pt, projectId, userId, supabase) {
  const { id: pointId, lat, lng } = pt

  try {
    let imageRow   = null   // final fields to insert into images table
    let costUsd    = 0
    let cacheHit   = false
    let imgSource  = null

    // ── 1. Google Street View (primary) ──────────────────────────────────────
    let roadBearing = null
    try {
      const meta = await fetchGoogleMetadata(lat, lng)  // $0.007
      if (meta) {
        roadBearing = meta.roadHeading

        // Compute the exact road direction from the panorama's actual position
        // toward the scan point (both are on the road centerline). Fall back to
        // meta.roadHeading if the panorama is essentially co-located with the scan point.
        const dist    = Math.hypot((meta.panoLat - lat) * 111320, (meta.panoLng - lng) * 111320)
        const roadDir = dist > 3 ? bearingTo(meta.panoLat, meta.panoLng, lat, lng) : meta.roadHeading

        // Rotate exactly 90° perpendicular to the road — facing directly at the property
        const heading = (roadDir + 90) % 360

        // Check shared pano cache — skips the $0.007 image download on hit
        const cached = meta.panoId ? await getCachedImage(meta.panoId, 'google', supabase) : null

        if (cached) {
          imageRow  = { ...cached, panorama_id: meta.panoId, image_source: 'google' }
          costUsd   = 0.007   // metadata only
          cacheHit  = true
          imgSource = 'google'
        } else {
          const buffer = await downloadGoogleImage(lat, lng, heading)  // $0.007
          if (buffer) {
            imageRow = {
              heading,
              panorama_id:  meta.panoId,
              image_source: 'google',
              image_hash:   crypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex'),
              size_bytes:   buffer.byteLength,
              _buffer:      buffer,
            }
            costUsd   = 0.014
            imgSource = 'google'
          }
        }
      }
    } catch (e) {
      console.warn(`[google] threw at ${lat},${lng}: ${e.message}`)
    }

    // ── 2. Mapillary fallback (free) ──────────────────────────────────────────
    if (!imageRow) {
      try {
        const mapRes = await fetchMapillaryImage(lat, lng)
        if (mapRes.image) {
          const { image: img } = mapRes
          if (!roadBearing) roadBearing = mapRes.roadBearing

          const cached = img.panoId ? await getCachedImage(img.panoId, 'mapillary', supabase) : null

          if (cached) {
            imageRow  = { ...cached, panorama_id: img.panoId, image_source: 'mapillary' }
            cacheHit  = true
            imgSource = 'mapillary'
          } else {
            imageRow = {
              heading:      img.heading,
              panorama_id:  img.panoId,
              image_source: 'mapillary',
              image_hash:   crypto.createHash('sha256').update(Buffer.from(img.buffer)).digest('hex'),
              size_bytes:   img.buffer.byteLength,
              _buffer:      img.buffer,
            }
            imgSource = 'mapillary'
          }
        }
      } catch (e) {
        console.warn(`[mapillary] threw at ${lat},${lng}: ${e.message}`)
      }
    }

    if (!imageRow) {
      await supabase.from('scan_points')
        .update({ status: 'no_coverage', updated_at: new Date().toISOString() })
        .eq('id', pointId)
      return { pointId, status: 'no_coverage' }
    }

    await supabase.from('scan_points')
      .update({ status: 'downloading', updated_at: new Date().toISOString() })
      .eq('id', pointId)

    // Upload to storage only on cache miss
    let storagePath = imageRow.storage_path
    let storageUrl  = imageRow.storage_url

    if (!cacheHit && imageRow._buffer) {
      // Store under shared/panoId so future users can reuse
      const folder = imageRow.panorama_id || pointId
      storagePath  = `shared/${folder}/F.jpg`

      const { error: upErr } = await supabase.storage
        .from('street-view-images')
        .upload(storagePath, imageRow._buffer, { contentType: 'image/jpeg', upsert: true })

      if (upErr) {
        await supabase.from('scan_points')
          .update({ status: 'failed', error_msg: upErr.message, updated_at: new Date().toISOString() })
          .eq('id', pointId)
        return { pointId, status: 'failed' }
      }

      storageUrl = supabase.storage.from('street-view-images').getPublicUrl(storagePath).data.publicUrl
    }

    await supabase.from('images').insert({
      scan_point_id: pointId,
      direction:     'F',
      heading:       imageRow.heading,
      storage_path:  storagePath,
      storage_url:   storageUrl,
      panorama_id:   imageRow.panorama_id,
      image_hash:    imageRow.image_hash,
      image_source:  imageRow.image_source,
      size_bytes:    imageRow.size_bytes,
    })

    await supabase.from('scan_points')
      .update({ status: 'downloaded', error_msg: null, updated_at: new Date().toISOString() })
      .eq('id', pointId)

    await supabase.from('usage_logs').insert({
      user_id:  userId,
      service:  imgSource === 'google' ? 'street_view' : 'mapillary',
      action:   cacheHit ? 'image_cache_hit' : 'image_download',
      count:    1,
      cost_usd: costUsd,
      metadata: { projectId, pointId, source: imgSource, cacheHit },
    })

    return { pointId, status: 'downloaded', source: imgSource, cacheHit }
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

  // Quota check — cap batch to whatever the user has remaining this cycle
  const { remaining, used, limit } = await getUserUsage(user.id, supabase)
  if (remaining <= 0) {
    return err(`Monthly limit reached — ${used.toLocaleString()} / ${limit.toLocaleString()} points used this cycle.`, 429)
  }

  const ids = pointIds.slice(0, Math.min(CAP, remaining))

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
