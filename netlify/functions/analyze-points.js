import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

const GEMINI_KEY   = process.env.GEMINI_API_KEY
const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`
const CAP          = 8   // points analyzed in parallel per function call

const PROMPT = `You are an expert real estate distress analyst for residential properties.
The images were captured facing the houses on each side of the road (not looking along the road).
Analyze each image for visible signs of distress, neglect, or abandonment on the PROPERTIES AND BUILDINGS only.
Focus on: building exteriors, rooftops, windows, doors, gutters, yards, and driveways.
Ignore road surfaces, street markings, traffic signs, and utility infrastructure entirely.

Return ONLY a valid JSON object matching this exact schema — no prose, no markdown:
{
  "overallScore": <float 0.0-1.0, where 0=pristine, 1=severely distressed>,
  "confidence": <float 0.0-1.0>,
  "signals": <array of signal IDs from the allowed list>,
  "notes": <string max 150 chars, plain-text summary of conditions observed>
}

Allowed signal IDs:
- tall_grass: visibly tall, unmowed grass or weeds in yard
- tarp_roof: blue or plastic tarps covering the roof
- peeling_paint: exterior paint is peeling, flaking, or severely faded
- boarded_windows: windows covered with boards or plywood
- abandoned_appearance: house looks vacant/abandoned overall
- broken_gutters: gutters sagging, detached, or missing sections
- junk_in_yard: old furniture, appliances, or large debris in yard
- poor_maintenance: general deterioration — cracked siding, rotting wood, broken steps

If no properties are clearly visible or no distress signals exist, return overallScore 0.0 and empty signals array.
Only flag signals that are clearly and unambiguously visible.`

async function callGemini(imageUrls) {
  const imageParts = await Promise.all(
    imageUrls.map(async (url) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      return { inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } }
    })
  )

  const res = await fetch(GEMINI_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }, ...imageParts] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens:  1024,
        temperature:      0.1,
        thinkingConfig:   { thinkingBudget: 0 },
      },
    }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || `Gemini ${res.status}`)

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Empty Gemini response')

  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const parsed  = JSON.parse(cleaned)
  const inputTokens  = data.usageMetadata?.promptTokenCount     || 0
  const outputTokens = data.usageMetadata?.candidatesTokenCount || 0
  const costUsd      = (inputTokens * 0.0000001) + (outputTokens * 0.0000004)

  return { result: parsed, inputTokens, outputTokens, costUsd }
}

async function analyzePoint(pointId, projectId, userId, supabase) {
  try {
    const { data: images } = await supabase
      .from('images')
      .select('storage_url, direction')
      .eq('scan_point_id', pointId)
      .not('storage_url', 'is', null)

    if (!images?.length) return { pointId, status: 'no_images' }

    await supabase.from('scan_points')
      .update({ status: 'analyzing', updated_at: new Date().toISOString() })
      .eq('id', pointId)

    const { result, inputTokens, outputTokens, costUsd } = await callGemini(images.map(i => i.storage_url))

    await supabase.from('ai_analyses').upsert({
      scan_point_id:      pointId,
      overall_score:      result.overallScore  ?? 0,
      confidence:         result.confidence    ?? 0,
      signals:            result.signals       ?? [],
      notes:              result.notes         ?? '',
      model_used:         GEMINI_MODEL,
      prompt_tokens:      inputTokens,
      completion_tokens:  outputTokens,
      estimated_cost_usd: costUsd,
      raw_response:       result,
      updated_at:         new Date().toISOString(),
    }, { onConflict: 'scan_point_id' })

    await supabase.from('scan_points')
      .update({ status: 'complete', updated_at: new Date().toISOString() })
      .eq('id', pointId)

    await supabase.from('usage_logs').insert({
      user_id:  userId,
      service:  'gemini_vision',
      action:   'analyze_point',
      count:    1,
      cost_usd: costUsd,
      metadata: { projectId, pointId, model: GEMINI_MODEL, inputTokens, outputTokens },
    })

    return { pointId, status: 'complete', score: result.overallScore }
  } catch (e) {
    console.error(`Gemini analysis failed ${pointId}:`, e.message)
    await supabase.from('scan_points')
      .update({ status: 'failed', error_msg: e.message, updated_at: new Date().toISOString() })
      .eq('id', pointId)
    return { pointId, status: 'error', error: e.message }
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  if (!GEMINI_KEY) return err('GEMINI_API_KEY not configured', 503)

  const { projectId, pointIds } = JSON.parse(event.body || '{}')
  if (!projectId || !Array.isArray(pointIds) || !pointIds.length) {
    return err('projectId and pointIds required')
  }

  const supabase = adminSupabase()
  const ids      = pointIds.slice(0, CAP)

  // Process all points in parallel
  const settled = await Promise.allSettled(
    ids.map(pointId => analyzePoint(pointId, projectId, user.id, supabase))
  )

  const results = settled.map(s =>
    s.status === 'fulfilled' ? s.value : { pointId: null, status: 'error' }
  )

  // Update project counters
  const [{ count: completed }, { count: total }] = await Promise.all([
    supabase.from('scan_points').select('*', { count: 'exact', head: true })
      .eq('project_id', projectId).eq('status', 'complete'),
    supabase.from('scan_points').select('*', { count: 'exact', head: true })
      .eq('project_id', projectId),
  ])

  await supabase.from('projects').update({
    completed_points: completed || 0,
    status:           (completed || 0) >= (total || 1) ? 'complete' : 'analyzing',
    updated_at:       new Date().toISOString(),
    ...((completed || 0) >= (total || 1) ? { completed_at: new Date().toISOString() } : {}),
  }).eq('id', projectId)

  return ok({ results })
}
