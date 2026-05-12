import jpeg from 'jpeg-js'
import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

// ---------------------------------------------------------------------------
// Pixel-level heuristic analysis — no external AI API required
// ---------------------------------------------------------------------------

function analyzePixels(decoded) {
  const { data, width, height } = decoded
  const totalPixels     = width * height
  const lowerStartY     = Math.floor(height * 0.6)   // bottom 40% = ground / yard
  const upperEndY       = Math.floor(height * 0.45)  // top 45% = roof / sky zone
  const lowerPixels     = (height - lowerStartY) * width
  const upperPixels     = upperEndY * width

  let totalLuminance = 0
  let darkPixels     = 0   // very dark  → boarded / abandoned
  let grayPixels     = 0   // desaturated mid-tone → faded / neglected
  let greenGrass     = 0   // green in lower zone → tall grass
  let blueTarp       = 0   // saturated blue in upper zone → tarp

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const r = data[i], g = data[i + 1], b = data[i + 2]

      const lum = r * 0.299 + g * 0.587 + b * 0.114
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const sat = max > 0 ? (max - min) / max : 0

      totalLuminance += lum

      if (lum < 38) darkPixels++

      // Desaturated mid-tone — faded paint, neglected exterior
      if (lum > 55 && lum < 185 && sat < 0.14) grayPixels++

      // Grass green: dominant green, medium brightness, some saturation
      if (y >= lowerStartY && g > r * 1.12 && g > b * 1.05 && g > 55 && g < 225 && sat > 0.1) {
        greenGrass++
      }

      // Tarp blue: saturated blue in roof zone, NOT light sky-blue
      // Sky is high-brightness low-saturation; tarps are mid-brightness high-saturation
      if (y < upperEndY && b > r * 1.35 && b > g * 1.18 && sat > 0.28 && lum < 185) {
        blueTarp++
      }
    }
  }

  const meanLum    = totalLuminance / totalPixels
  const darkRatio  = darkPixels  / totalPixels
  const grayRatio  = grayPixels  / totalPixels
  const greenRatio = lowerPixels > 0 ? greenGrass / lowerPixels : 0
  const blueRatio  = upperPixels > 0 ? blueTarp   / upperPixels : 0

  const signals = []
  let score = 0

  // Abandoned / very dark interior
  if (darkRatio > 0.28) {
    signals.push('abandoned_appearance')
    score += 0.35
  } else if (darkRatio > 0.14) {
    score += 0.12
  }

  // Boarded windows — combine high dark ratio with low overall brightness
  if (darkRatio > 0.38 && meanLum < 65) {
    signals.push('boarded_windows')
    score += 0.20
  }

  // Tall grass in yard / lower zone
  if (greenRatio > 0.22) {
    signals.push('tall_grass')
    score += 0.25
  } else if (greenRatio > 0.12) {
    score += 0.08
  }

  // Blue tarp on roof
  if (blueRatio > 0.055) {
    signals.push('tarp_roof')
    score += 0.35
  }

  // Faded / poor exterior — heavy desaturation over mid-tones
  if (grayRatio > 0.42) {
    signals.push('poor_maintenance')
    score += 0.15
  } else if (grayRatio > 0.28) {
    score += 0.06
  }

  return {
    overallScore: parseFloat(Math.min(1, score).toFixed(3)),
    signals: [...new Set(signals)],
    meta: { meanLum: meanLum.toFixed(1), darkRatio, grayRatio, greenRatio, blueRatio },
  }
}

async function fetchAndDecode(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Image fetch ${res.status}`)
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('image')) throw new Error('Not an image')
  const buf = Buffer.from(await res.arrayBuffer())
  return jpeg.decode(buf, { useTArray: true })
}

function aggregate(results) {
  if (!results.length) return { overallScore: 0, confidence: 0, signals: [], notes: '' }

  const avgScore = results.reduce((s, r) => s + r.overallScore, 0) / results.length
  const signals  = [...new Set(results.flatMap(r => r.signals))]

  const noteParts = results.map(r =>
    `lum=${r.meta.meanLum} dark=${(r.meta.darkRatio * 100).toFixed(0)}% green=${(r.meta.greenRatio * 100).toFixed(0)}% tarp=${(r.meta.blueRatio * 100).toFixed(0)}%`
  )

  return {
    overallScore: parseFloat(avgScore.toFixed(3)),
    confidence:   0.4,   // heuristic is inherently lower confidence than AI vision
    signals,
    notes: noteParts.join(' | ').slice(0, 200),
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  const { projectId, pointIds } = JSON.parse(event.body || '{}')
  if (!projectId || !Array.isArray(pointIds) || !pointIds.length) {
    return err('projectId and pointIds required')
  }

  const supabase = adminSupabase()
  const results  = []

  for (const pointId of pointIds.slice(0, 10)) {
    try {
      const { data: images } = await supabase
        .from('images')
        .select('storage_url, direction')
        .eq('scan_point_id', pointId)
        .not('storage_url', 'is', null)

      if (!images?.length) {
        results.push({ pointId, status: 'no_images' }); continue
      }

      await supabase.from('scan_points')
        .update({ status: 'analyzing', updated_at: new Date().toISOString() })
        .eq('id', pointId)

      // Decode and analyze each image
      const pixelResults = []
      for (const img of images) {
        try {
          const decoded = await fetchAndDecode(img.storage_url)
          pixelResults.push(analyzePixels(decoded))
        } catch (imgErr) {
          console.warn(`Pixel analysis failed for ${img.storage_url}:`, imgErr.message)
        }
      }

      if (!pixelResults.length) {
        await supabase.from('scan_points')
          .update({ status: 'failed', error_msg: 'Image decode failed', updated_at: new Date().toISOString() })
          .eq('id', pointId)
        results.push({ pointId, status: 'error' }); continue
      }

      const result = aggregate(pixelResults)

      await supabase.from('ai_analyses').upsert({
        scan_point_id:      pointId,
        overall_score:      result.overallScore,
        confidence:         result.confidence,
        signals:            result.signals,
        notes:              result.notes,
        model_used:         'heuristic',
        prompt_tokens:      0,
        completion_tokens:  0,
        estimated_cost_usd: 0,
        raw_response:       { images: pixelResults.map(r => r.meta) },
        updated_at:         new Date().toISOString(),
      }, { onConflict: 'scan_point_id' })

      await supabase.from('scan_points')
        .update({ status: 'complete', updated_at: new Date().toISOString() })
        .eq('id', pointId)

      results.push({ pointId, status: 'complete', score: result.overallScore })
    } catch (ptErr) {
      console.error(`Heuristic analysis failed ${pointId}:`, ptErr.message)
      await supabase.from('scan_points').update({
        status: 'failed', error_msg: ptErr.message, updated_at: new Date().toISOString(),
      }).eq('id', pointId)
      results.push({ pointId, status: 'error', error: ptErr.message })
    }
  }

  // Update project counters
  const { count: completed } = await supabase
    .from('scan_points')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('status', 'complete')

  const { count: total } = await supabase
    .from('scan_points')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)

  await supabase.from('projects').update({
    completed_points: completed || 0,
    status: completed >= total ? 'complete' : 'analyzing',
    updated_at: new Date().toISOString(),
    ...(completed >= total ? { completed_at: new Date().toISOString() } : {}),
  }).eq('id', projectId)

  return ok({ results })
}
