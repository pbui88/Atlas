import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

const MAPILLARY_TOKEN = process.env.MAPILLARY_ACCESS_TOKEN

// Bearing (degrees, 0=N, 90=E) from one lat/lng to another.
function bearingTo(fromLat, fromLng, toLat, toLng) {
  const φ1 = fromLat * Math.PI / 180
  const φ2 = toLat   * Math.PI / 180
  const Δλ = (toLng - fromLng) * Math.PI / 180
  const y   = Math.sin(Δλ) * Math.cos(φ2)
  const x   = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}

// Haversine distance in meters.
function distMeters(lat1, lng1, lat2, lng2) {
  const R    = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a    = Math.sin(dLat / 2) ** 2
              + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Shortest angular difference between two bearings (0–180).
function angleDiff(a, b) {
  const d = Math.abs((a - b + 360) % 360)
  return d > 180 ? 360 - d : d
}

// Search Mapillary for images near a point. closeto uses lng,lat (GeoJSON order).
async function getMapillaryImages(lat, lng, radius = 50) {
  const url = `https://graph.mapillary.com/images?fields=id,geometry,thumb_1024_url,compass_angle,captured_at&closeto=${lng},${lat}&radius=${radius}&limit=20&access_token=${MAPILLARY_TOKEN}`
  const res  = await fetch(url)
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || 'Mapillary API error')
  return data.data || []
}

async function downloadImage(thumbUrl) {
  const res = await fetch(thumbUrl)
  if (!res.ok) throw new Error(`Image download failed (${res.status})`)
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('image')) throw new Error('Not an image')
  return res.arrayBuffer()
}

// Pick up to 3 images covering F/L/R directions relative to the scan point.
// Uses each image's compass_angle to find the best match per direction.
function selectDirectionImages(images, scanLat, scanLng) {
  if (!images.length) return []

  // Annotate with distance and bearing from image toward scan point
  const annotated = images
    .map(img => {
      const [imgLng, imgLat] = img.geometry.coordinates
      const dist = distMeters(imgLat, imgLng, scanLat, scanLng)
      const towardProperty = bearingTo(imgLat, imgLng, scanLat, scanLng)
      return { ...img, imgLat, imgLng, dist, towardProperty }
    })
    .sort((a, b) => a.dist - b.dist)

  // Reference "toward property" bearing from the closest image
  const refBearing = annotated[0].towardProperty

  const targets = [
    { label: 'F', targetAngle: refBearing },
    { label: 'L', targetAngle: (refBearing + 90) % 360 },
    { label: 'R', targetAngle: (refBearing - 90 + 360) % 360 },
  ]

  const selected = []
  const usedIds  = new Set()

  for (const { label, targetAngle } of targets) {
    let best     = null
    let bestDiff = Infinity

    for (const img of annotated) {
      if (usedIds.has(img.id)) continue
      const diff = angleDiff(img.compass_angle, targetAngle)
      if (diff < bestDiff) { bestDiff = diff; best = img }
    }

    // Skip if no image is within 90° of the target direction
    if (best && bestDiff <= 90) {
      selected.push({ label, image: best })
      usedIds.add(best.id)
    }
  }

  return selected
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  if (!MAPILLARY_TOKEN) return err('MAPILLARY_ACCESS_TOKEN not configured', 503)

  const { projectId, pointIds } = JSON.parse(event.body || '{}')
  if (!projectId || !Array.isArray(pointIds) || !pointIds.length) {
    return err('projectId and pointIds required')
  }

  const supabase = adminSupabase()
  const results  = []

  for (const pointId of pointIds.slice(0, 10)) {
    let pointStatus = 'failed'
    let errorMsg    = null
    let imageRows   = []

    try {
      const { data: pt } = await supabase
        .from('scan_points')
        .select('id, lat, lng, project_id')
        .eq('id', pointId)
        .single()

      if (!pt) { results.push({ pointId, status: 'not_found' }); continue }

      const images = await getMapillaryImages(pt.lat, pt.lng)
      if (!images.length) {
        await supabase.from('scan_points').update({ status: 'no_coverage', updated_at: new Date().toISOString() }).eq('id', pointId)
        results.push({ pointId, status: 'no_coverage' }); continue
      }

      await supabase.from('scan_points').update({ status: 'downloading', updated_at: new Date().toISOString() }).eq('id', pointId)

      const selected = selectDirectionImages(images, pt.lat, pt.lng)
      if (!selected.length) {
        await supabase.from('scan_points').update({ status: 'no_coverage', updated_at: new Date().toISOString() }).eq('id', pointId)
        results.push({ pointId, status: 'no_coverage' }); continue
      }

      imageRows = []
      for (const { label, image } of selected) {
        try {
          const buffer      = await downloadImage(image.thumb_1024_url)
          const storagePath = `${projectId}/${pointId}/${label}.jpg`

          const { error: upErr } = await supabase.storage
            .from('street-view-images')
            .upload(storagePath, buffer, { contentType: 'image/jpeg', upsert: true })

          if (upErr) { console.warn(`Upload failed ${label}:`, upErr.message); continue }

          const { data: { publicUrl } } = supabase.storage
            .from('street-view-images')
            .getPublicUrl(storagePath)

          imageRows.push({
            scan_point_id: pointId,
            direction:     label,
            heading:       Math.round(image.compass_angle),
            storage_path:  storagePath,
            storage_url:   publicUrl,
            size_bytes:    buffer.byteLength,
          })
        } catch (dirErr) {
          console.warn(`Dir ${label} failed for ${pointId}:`, dirErr.message)
        }
      }

      if (imageRows.length > 0) {
        await supabase.from('images').insert(imageRows)
        pointStatus = 'downloaded'
      } else {
        errorMsg = 'All direction downloads failed'
      }
    } catch (ptErr) {
      errorMsg = ptErr.message
    }

    await supabase.from('scan_points').update({
      status:     pointStatus,
      error_msg:  errorMsg,
      updated_at: new Date().toISOString(),
    }).eq('id', pointId)

    // Mapillary is free — log count with $0 cost
    if (pointStatus === 'downloaded') {
      await supabase.from('usage_logs').insert({
        user_id:  user.id,
        service:  'street_view',
        action:   'image_download',
        count:    imageRows.length,
        cost_usd: 0,
        metadata: { projectId, pointId, provider: 'mapillary' },
      })
    }

    results.push({ pointId, status: pointStatus })
  }

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
