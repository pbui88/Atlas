// Temporary debug endpoint — returns raw DNC CSV content for a given order.
// Usage: POST { "orderId": "<uuid>" }
// Remove this file once DNC column parsing is confirmed working.
import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

const TRACERFY_API_KEY = process.env.TRACERFY_API_KEY
const TRACERFY_BASE    = 'https://tracerfy.com/v1/api'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return err('Invalid body', 400) }

  const { orderId } = body
  if (!orderId) return err('orderId required', 400)

  const supabase = adminSupabase()

  const { data: order } = await supabase
    .from('skip_trace_orders')
    .select('id, tracerfy_order_id, dnc_queue_id, scrub_dnc, status')
    .eq('id', orderId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!order) return err('Order not found', 404)

  // Fetch DNC queue status
  let dncQueueId = order.dnc_queue_id

  // If no dnc_queue_id stored, try to look up by tracerfy_order_id
  if (!dncQueueId && !order.tracerfy_order_id) {
    return ok({
      order,
      note: 'No DNC queue ID found for this order',
    })
  }

  // If no queue ID but we have a tracerfy order ID, try scrub-from-queue to get one
  if (!dncQueueId) {
    return ok({
      order: {
        id: order.id,
        tracerfy_order_id: order.tracerfy_order_id,
        dnc_queue_id: null,
        scrub_dnc: order.scrub_dnc,
        status: order.status,
      },
      note: 'No DNC queue ID on order. Start a DNC scrub first.',
    })
  }

  const queueRes = await fetch(`${TRACERFY_BASE}/dnc/queue/${dncQueueId}`, {
    headers: { Authorization: `Bearer ${TRACERFY_API_KEY}` },
  })
  const queueData = await queueRes.json().catch(() => null)

  if (!queueData) return ok({ order, dncQueueId, error: 'Failed to fetch DNC queue status' })

  if (!queueData.download_url) {
    return ok({
      order: { id: order.id, dnc_queue_id: dncQueueId },
      queueStatus: queueData,
      note: 'No download_url yet — DNC may still be processing (pending=' + queueData.pending + ')',
    })
  }

  // Fetch the raw CSV
  const csvRes = await fetch(queueData.download_url)
  const csvText = await csvRes.text()
  const lines = csvText.split(/\r?\n/).filter(l => l.trim())

  return ok({
    order: { id: order.id, dnc_queue_id: dncQueueId },
    queueStatus: { pending: queueData.pending, download_url: queueData.download_url },
    csvRowCount: lines.length,
    headerLine: lines[0] || null,
    sampleRows: lines.slice(1, 6),   // first 5 data rows
  })
}
