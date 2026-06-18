// Receives POST from Tracerfy when a skip trace queue completes.
// Configure your webhook URL in Tracerfy account settings.
// Preferred: pass the secret via Authorization header (not visible in server logs):
//   Authorization: Bearer <TRACERFY_WEBHOOK_SECRET>
// Fallback (query string — appears in logs, use only if header is unsupported):
//   https://your-atlas-app.netlify.app/.netlify/functions/tracerfy-webhook?secret=<TRACERFY_WEBHOOK_SECRET>
import { timingSafeEqual } from 'crypto'
import { adminSupabase, ok, err, options } from './utils/supabase.js'
import { normalizeResult, matchRecord } from './utils/tracerfy.js'

const WEBHOOK_SECRET   = process.env.TRACERFY_WEBHOOK_SECRET
const TRACERFY_API_KEY = process.env.TRACERFY_API_KEY
const TRACERFY_BASE    = 'https://tracerfy.com/v1/api'

async function fetchQueueResults(queueId) {
  const rows = []
  let page = 1
  while (true) {
    const res  = await fetch(`${TRACERFY_BASE}/queue/${queueId}?page=${page}`, {
      headers: { 'Authorization': `Bearer ${TRACERFY_API_KEY}` },
    })
    if (!res.ok) break
    const data = await res.json().catch(() => null)
    if (!data || !Array.isArray(data) || data.length === 0) break
    rows.push(...data)
    if (data.length < 100) break
    page++
  }
  return rows
}

function checkSecret(provided) {
  if (!provided || !WEBHOOK_SECRET) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(WEBHOOK_SECRET)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  // Return 503 if the secret env var is absent — misconfiguration, not a caller auth failure
  if (!WEBHOOK_SECRET) return err('Webhook secret not configured', 503)

  // Accept secret via Authorization: Bearer header (preferred — not logged) or
  // query string fallback (visible in server logs, use only if header is unsupported).
  const authHeader = event.headers?.authorization || event.headers?.Authorization || ''
  const provided   = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : event.queryStringParameters?.secret || ''
  if (!checkSecret(provided)) return err('Unauthorized', 401)

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return err('Invalid body', 400) }

  const queueId = payload.id != null ? String(payload.id) : null
  if (!queueId) {
    console.log('tracerfy-webhook: no queue id in payload', JSON.stringify(payload))
    return ok({ ignored: true })
  }
  // Use loose equality so pending: 0 (number) is treated the same as pending: false (boolean)
  if (payload.pending != false) {
    return ok({ ignored: true, reason: 'still pending' })
  }

  const supabase = adminSupabase()

  const { data: order, error: orderErr } = await supabase
    .from('skip_trace_orders')
    .select('id, user_id')
    .eq('tracerfy_order_id', queueId)
    .maybeSingle()

  if (orderErr || !order) {
    console.log('tracerfy-webhook: no matching order for queue', queueId)
    return ok({ ignored: true, reason: 'order not found' })
  }

  if (!TRACERFY_API_KEY) {
    // No API key configured — mark complete with no result data
    await supabase
      .from('skip_trace_orders')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', order.id)
    return ok({ ok: true })
  }

  try {
    const results = await fetchQueueResults(queueId)
    const { data: records } = await supabase
      .from('skip_trace_records')
      .select('id, address')
      .eq('order_id', order.id)

    const now = new Date().toISOString()

    if (records?.length && results.length) {
      // Collect matched updates first, then write in parallel to avoid N+1 round-trips
      const matchedIds  = new Set()
      const matchUpdates = []
      for (const row of results) {
        const match = matchRecord(row, records)
        if (!match || matchedIds.has(match.id)) continue
        matchedIds.add(match.id)
        matchUpdates.push({ id: match.id, result: normalizeResult(row) })
      }

      await Promise.all(matchUpdates.map(({ id, result }) =>
        supabase.from('skip_trace_records')
          .update({ status: 'completed', completed_at: now, result })
          .eq('id', id)
      ))

      // Update unmatched records by explicit ID list — avoids a race with concurrent webhook retries
      const unmatchedIds = records.map(r => r.id).filter(id => !matchedIds.has(id))
      if (unmatchedIds.length) {
        await supabase
          .from('skip_trace_records')
          .update({ status: 'completed', completed_at: now })
          .in('id', unmatchedIds)
      }
    } else {
      await supabase
        .from('skip_trace_records')
        .update({ status: 'completed', completed_at: now })
        .eq('order_id', order.id)
    }

    // Mark the order complete only after all record writes succeed
    await supabase
      .from('skip_trace_orders')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', order.id)

    return ok({ ok: true })
  } catch (e) {
    console.error('tracerfy-webhook: failed to process results:', e.message)
    // Return 500 so Tracerfy retries the webhook — order remains 'processing'
    return err('Processing failed, will retry', 500)
  }
}
