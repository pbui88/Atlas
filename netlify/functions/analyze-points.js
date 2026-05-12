import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

const GEMINI_KEY = process.env.GEMINI_API_KEY
const GEMINI_MODEL = 'gemini-2.0-flash'
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`

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
  // Fetch images and encode as base64 for Gemini inline data
  const imageParts = await Promise.all(
    imageUrls.map(async (url) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      return {
        inlineData: {
          mimeType: 'image/jpeg',
          data: buf.toString('base64'),
        },
      }
    })
  )

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: PROMPT },
          ...imageParts,
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 512,
        temperature: 0.1,
      },
    }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || `Gemini ${res.status}`)

  const text   = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Empty Gemini response')

  const parsed       = JSON.parse(text)
  const inputTokens  = data.usageMetadata?.promptTokenCount     || 0
  const outputTokens = data.usageMetadata?.candidatesTokenCount || 0

  // gemini-2.0-flash pricing: $0.10/1M input, $0.40/1M output tokens
  const costUsd = (inputTokens * 0.0000001) + (outputTokens * 0.0000004)

  return { result: parsed, inputTokens, outputTokens, costUsd }
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
  const results  = []

  for (const pointId of pointIds.slice(0, 5)) {
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

      const imageUrls = images.map(i => i.storage_url)
      const { result, inputTokens, outputTokens, costUsd } = await callGemini(imageUrls)

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
        user_id:  user.id,
        service:  'gemini_vision',
        action:   'analyze_point',
        count:    1,
        cost_usd: costUsd,
        metadata: { projectId, pointId, model: GEMINI_MODEL, inputTokens, outputTokens },
      })

      results.push({ pointId, status: 'complete', score: result.overallScore })
    } catch (ptErr) {
      console.error(`Gemini analysis failed ${pointId}:`, ptErr.message)
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
