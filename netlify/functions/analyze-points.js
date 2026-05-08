import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

const OPENAI_KEY = process.env.OPENAI_API_KEY

const SYSTEM_PROMPT = `You are an expert real estate distress analyst for residential properties.
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

Allowed signal IDs and what they mean:
- tall_grass: lawn or yard has visibly tall, unmowed grass or weeds
- tarp_roof: roof has blue or plastic tarps covering it (indicates storm/water damage)
- peeling_paint: exterior paint is peeling, flaking, bubbling, or severely faded
- boarded_windows: windows are covered with boards, plywood, or similar materials
- abandoned_appearance: house looks vacant/abandoned (dark/empty windows, no curtains, overgrown, neglected overall)
- broken_gutters: gutters are sagging, detached, bent, or missing sections
- junk_in_yard: old furniture, appliances, scrap metal, or large debris visible in yard
- poor_maintenance: general visible deterioration — cracked siding, rotting wood, broken steps, etc.

If no properties are clearly visible, or no distress signals are visible, return overallScore 0.0 and empty signals array.
Only flag signals that are clearly and unambiguously visible on buildings or properties.`

async function callOpenAI(imageUrls) {
  const content = [
    { type: 'text', text: SYSTEM_PROMPT },
    ...imageUrls.map(url => ({
      type: 'image_url',
      image_url: { url, detail: 'low' },
    })),
  ]

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content }],
      max_tokens: 400,
      response_format: { type: 'json_object' },
    }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || `OpenAI ${res.status}`)

  const parsed = JSON.parse(data.choices[0].message.content)
  return {
    result:           parsed,
    promptTokens:     data.usage?.prompt_tokens || 0,
    completionTokens: data.usage?.completion_tokens || 0,
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  if (!OPENAI_KEY) return err('OPENAI_API_KEY not configured', 503)

  const { projectId, pointIds } = JSON.parse(event.body || '{}')
  if (!projectId || !Array.isArray(pointIds) || !pointIds.length) {
    return err('projectId and pointIds required')
  }

  const supabase = adminSupabase()
  const results  = []

  for (const pointId of pointIds.slice(0, 5)) {
    try {
      // Get images for this point
      const { data: images } = await supabase
        .from('images')
        .select('storage_url, direction')
        .eq('scan_point_id', pointId)
        .not('storage_url', 'is', null)

      if (!images?.length) {
        results.push({ pointId, status: 'no_images' }); continue
      }

      await supabase.from('scan_points').update({ status: 'analyzing', updated_at: new Date().toISOString() }).eq('id', pointId)

      const imageUrls = images.map(i => i.storage_url)
      const { result, promptTokens, completionTokens } = await callOpenAI(imageUrls)

      const costUsd = (promptTokens * 0.000005) + (completionTokens * 0.000015)

      // Upsert analysis
      await supabase.from('ai_analyses').upsert({
        scan_point_id:      pointId,
        overall_score:      result.overallScore ?? 0,
        confidence:         result.confidence ?? 0,
        signals:            result.signals ?? [],
        notes:              result.notes ?? '',
        model_used:         'gpt-4o',
        prompt_tokens:      promptTokens,
        completion_tokens:  completionTokens,
        estimated_cost_usd: costUsd,
        raw_response:       result,
        updated_at:         new Date().toISOString(),
      }, { onConflict: 'scan_point_id' })

      await supabase.from('scan_points').update({ status: 'complete', updated_at: new Date().toISOString() }).eq('id', pointId)

      // Log usage
      await supabase.from('usage_logs').insert({
        user_id:  user.id,
        service:  'openai_vision',
        action:   'analyze_point',
        count:    1,
        cost_usd: costUsd,
        metadata: { projectId, pointId, model: 'gpt-4o' },
      })

      results.push({ pointId, status: 'complete', score: result.overallScore })
    } catch (ptErr) {
      console.error(`Analysis failed ${pointId}:`, ptErr.message)
      await supabase.from('scan_points').update({
        status: 'failed', error_msg: ptErr.message, updated_at: new Date().toISOString(),
      }).eq('id', pointId)
      results.push({ pointId, status: 'error', error: ptErr.message })
    }
  }

  // Update project completed count
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
