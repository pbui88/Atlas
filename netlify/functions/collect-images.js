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

// Cache lookup by panorama ID + direction (R/L/F) so each side is stored once
async function getCachedImage(panoId, source, direction, supabase) {
  if (!panoId) return null
  const { data } = await supabase
    .from('images')
    .select('storage_url, storage_path, image_hash, size_bytes, heading')
    .eq('panorama_id', panoId)
    .eq('image_source', source)
    .eq('direction', direction)
    .limit(1)
    .maybeSingle()
  return data || null
}

async function processPoint(pt, projectId, userId, supabase) {
  const { id: pointId, lat, lng } = pt

  try {
    const imagesToStore = []   // all images collected for this point
    let   totalCost     = 0
    let   imgSource     = null
    let   roadBearing   = null

    // ── 1. Google Street View (primary) ──────────────────────────────────────
    try {
      const meta = await fetchGoogleMetadata(lat, lng)   // $0.007
      if (meta) {
        roadBearing = meta.roadHeading

        // Exact road direction from the panorama's actual position toward the scan point
        const dist    = Math.hypot((meta.panoLat - lat) * 111320, (meta.panoLng - lng) * 111320)
        const roadDir = dist > 3 ? bearingTo(meta.panoLat, meta.panoLng, lat, lng) : meta.roadHeading

        totalCost += 0.007   // metadata call
        imgSource  = 'google'

        // Capture BOTH perpendicular sides so every property facing the road is covered
        const sides = [
          { dir: 'R', heading: (roadDir + 90)  % 360 },  // right side of road
          { dir: 'L', heading: (roadDir + 270) % 360 },  // left side of road
        ]

        for (const side of sides) {
          const cached = await getCachedImage(meta.panoId, 'google', side.dir, supabase)
          if (cached) {
            imagesToStore.push({
              direction:    side.dir,
              heading:      side.heading,
              panorama_id:  meta.panoId,
              image_source: 'google',
              storage_path: cached.storage_path,
              storage_url:  cached.storage_url,
              image_hash:   cached.image_hash,
              size_bytes:   cached.size_bytes,
              cacheHit:     true,
            })
          } else {
            const buffer = await downloadGoogleImage(lat, lng, side.heading)   // $0.007
            if (buffer) {
              totalCost += 0.007
              imagesToStore.push({
                direction:    side.dir,
                heading:      side.heading,
                panorama_id:  meta.panoId,
                image_source: 'google',
                image_hash:   crypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex'),
                size_bytes:   buffer.byteLength,
                _buffer:      buffer,
                cacheHit:     false,
              })
            }
          }
        }
      }
    } catch (e) {
      console.warn(`[google] threw at ${lat},${lng}: ${e.message}`)
    }

    // ── 2. Mapillary fallback (free) ──────────────────────────────────────────
    if (imagesToStore.length === 0) {
      try {
        const mapRes = await fetchMapillaryImage(lat, lng)
        if (mapRes.image) {
          const { image: img } = mapRes
          if (!roadBearing) roadBearing = mapRes.roadBearing
          imgSource = 'mapillary'

          const cached = await getCachedImage(img.panoId, 'mapillary', 'F', supabase)
          if (cached) {
            imagesToStore.push({
              direction: 'F', heading: img.heading, panorama_id: img.panoId,
              image_source: 'mapillary', ...cached, cacheHit: true,
            })
          } else {
            imagesToStore.push({
              direction:    'F',
              heading:      img.heading,
              panorama_id:  img.panoId,
              image_source: 'mapillary',
              image_hash:   crypto.createHash('sha256').update(Buffer.from(img.buffer)).digest('hex'),
              size_bytes:   img.buffer.byteLength,
              _buffer:      img.buffer,
              cacheHit:     false,
            })
          }
        }
      } catch (e) {
        console.warn(`[mapillary] threw at ${lat},${lng}: ${e.message}`)
      }
    }

    if (imagesToStore.length === 0) {
      await supabase.from('scan_points')
        .update({ status: 'no_coverage', updated_at: new Date().toISOString() })
        .eq('id', pointId)
      return { pointId, status: 'no_coverage' }
    }

    await supabase.from('scan_points')
      .update({ status: 'downloading', updated_at: new Date().toISOString() })
      .eq('id', pointId)

    // Upload cache-miss images to shared storage keyed by panoId + direction
    for (const img of imagesToStore) {
      if (img.cacheHit || !img._buffer) continue
      const folder      = img.panorama_id || pointId
      img.storage_path  = `shared/${folder}/${img.direction}.jpg`
      const { error: upErr } = await supabase.storage
        .from('street-view-images')
        .upload(img.storage_path, img._buffer, { contentType: 'image/jpeg', upsert: true })
      if (upErr) {
        console.warn(`[upload] ${img.direction} failed: ${upErr.message}`)
        img._failed = true
        continue
      }
      img.storage_url = supabase.storage.from('street-view-images').getPublicUrl(img.storage_path).data.publicUrl
    }

    const ready = imagesToStore.filter(img => !img._failed && img.storage_url)
    if (ready.length === 0) {
      await supabase.from('scan_points')
        .update({ status: 'failed', error_msg: 'All uploads failed', updated_at: new Date().toISOString() })
        .eq('id', pointId)
      return { pointId, status: 'failed' }
    }

    await supabase.from('images').insert(
      ready.map(img => ({
        scan_point_id: pointId,
        direction:     img.direction,
        heading:       img.heading,
        storage_path:  img.storage_path,
        storage_url:   img.storage_url,
        panorama_id:   img.panorama_id,
        image_hash:    img.image_hash,
        image_source:  img.image_source,
        size_bytes:    img.size_bytes,
      }))
    )

    await supabase.from('scan_points')
      .update({ status: 'downloaded', error_msg: null, updated_at: new Date().toISOString() })
      .eq('id', pointId)

    await supabase.from('usage_logs').insert({
      user_id:  userId,
      service:  imgSource === 'google' ? 'street_view' : 'mapillary',
      action:   ready.every(i => i.cacheHit) ? 'image_cache_hit' : 'image_download',
      count:    1,
      cost_usd: totalCost,
      metadata: { projectId, pointId, source: imgSource, imageCount: ready.length },
    })

    return { pointId, status: 'downloaded', source: imgSource, imageCount: ready.length }
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
