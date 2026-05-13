import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

const GOOGLE_KEY = process.env.GOOGLE_MAPS_KEY


// Returns pano metadata or null if no coverage.
async function getPanoInfo(lat, lng) {
  try {
    const url  = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${GOOGLE_KEY}`
    const res  = await fetch(url)
    const data = await res.json()
    if (data.status !== 'OK') return null
    return {
      heading: data.heading ?? 0,
      panoLat: data.location?.lat ?? lat,
      panoLng: data.location?.lng ?? lng,
    }
  } catch {
    return null
  }
}

async function downloadImage(lat, lng, heading) {
  // fov=72 (narrower than 90) frames building facades without too much sky/road.
  // pitch=15 tilts upward to capture the facade above the curb line.
  const url = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${lat},${lng}&heading=${heading}&pitch=15&fov=72&return_error_code=true&key=${GOOGLE_KEY}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Street View ${res.status}`)
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('image')) throw new Error('Not an image (no coverage?)')
  const buffer = await res.arrayBuffer()
  return buffer
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
  const results  = []

  for (const pointId of pointIds.slice(0, 10)) {  // cap per call
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

      // Coverage check — also returns road heading for perpendicular shots
      const pano = await getPanoInfo(pt.lat, pt.lng)
      if (!pano) {
        await supabase.from('scan_points').update({ status: 'no_coverage', updated_at: new Date().toISOString() }).eq('id', pointId)
        results.push({ pointId, status: 'no_coverage' }); continue
      }

      await supabase.from('scan_points').update({ status: 'downloading', updated_at: new Date().toISOString() }).eq('id', pointId)

      // When the panorama is more than 8 m from the scan point, the scan point
      // is off the road (on a lot / setback) — aim the camera directly from
      // the pano toward the scan point so it faces the property.
      // Otherwise the pano is on the road itself: shoot perpendicular to the
      // travel direction to capture houses on both sides of the street.
      // Always capture all 3 directions: toward property + both sides of road
      // Scan point is on the road centerline — shoot perpendicular (90° left of
      // road travel direction) to face the property front-on from the road.
      const directions = [
        { label: 'F', heading: (pano.heading + 90) % 360 },
      ]

      imageRows = []
      for (const dir of directions) {
        try {
          const buffer      = await downloadImage(pt.lat, pt.lng, dir.heading)
          const storagePath = `${projectId}/${pointId}/${dir.label}.jpg`

          const { error: upErr } = await supabase.storage
            .from('street-view-images')
            .upload(storagePath, buffer, { contentType: 'image/jpeg', upsert: true })

          if (upErr) { console.warn(`Upload failed ${dir.label}:`, upErr.message); continue }

          const { data: { publicUrl } } = supabase.storage
            .from('street-view-images')
            .getPublicUrl(storagePath)

          imageRows.push({
            scan_point_id: pointId,
            direction:     dir.label,
            heading:       dir.heading,
            storage_path:  storagePath,
            storage_url:   publicUrl,
            size_bytes:    buffer.byteLength,
          })
        } catch (dirErr) {
          console.warn(`Dir ${dir.label} failed for ${pointId}:`, dirErr.message)
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

    // Log usage
    if (pointStatus === 'downloaded') {
      const imgCount = imageRows.length || 1
      await supabase.from('usage_logs').insert({
        user_id: user.id,
        service: 'street_view',
        action:  'image_download',
        count:   imgCount,
        cost_usd: imgCount * 0.007,
        metadata: { projectId, pointId },
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
    status: 'collecting',
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)

  return ok({ results })
}
