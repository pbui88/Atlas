// Trigger a Tracerfy DNC scrub for a set of already-completed skip trace records.
// Groups the records by their Tracerfy queue (order) and calls
// POST /dnc/scrub-from-queue/ once per unique batch.
import { requireAuth, adminSupabase, ok, err, options, isValidUUID } from './utils/supabase.js'

const TRACERFY_API_KEY = process.env.TRACERFY_API_KEY
const TRACERFY_BASE    = 'https://tracerfy.com/v1/api'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, role, error } = await requireAuth(event)
  if (error) return err(error, 401)

  const isAdmin = role === 'admin'

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return err('Invalid body', 400) }

  const { recordIds } = body
  if (!Array.isArray(recordIds) || !recordIds.length) return err('recordIds required', 400)
  if (recordIds.some(id => !isValidUUID(id))) return err('Invalid record id', 400)
  if (recordIds.length > 500) return err('Maximum 500 records', 400)

  if (!TRACERFY_API_KEY) return err('TRACERFY_API_KEY not configured', 503)

  const supabase = adminSupabase()

  // Verify ownership and get order IDs + phone counts for these completed records
  const { data: records, error: recErr } = await supabase
    .from('skip_trace_records')
    .select('id, order_id, result')
    .in('id', recordIds)
    .eq('user_id', user.id)
    .eq('status', 'completed')

  if (recErr) return err(recErr.message, 500)
  if (!records?.length) return err('No eligible completed records found', 400)

  const totalPhones = records.reduce((sum, r) => sum + (r.result?.phones?.length || 0), 0)
  if (totalPhones === 0) return err('No phone numbers found in these records', 400)

  // Fetch orders early — needed to determine which are already queued before charging
  const orderIds = [...new Set(records.map(r => r.order_id).filter(Boolean))]
  if (!orderIds.length) return err('No orders found for these records', 400)

  const { data: orders, error: ordErr } = await supabase
    .from('skip_trace_orders')
    .select('id, tracerfy_order_id, dnc_queue_id')
    .in('id', orderIds)
    .eq('user_id', user.id)

  if (ordErr) return err(ordErr.message, 500)

  // Build per-order phone counts for partial refund logic
  const phonesPerOrder = {}
  for (const record of records) {
    if (!record.order_id) continue
    phonesPerOrder[record.order_id] = (phonesPerOrder[record.order_id] || 0) + (record.result?.phones?.length || 0)
  }

  // Orders already having dnc_queue_id are in-progress — don't charge again.
  const alreadyQueuedIds = new Set((orders || []).filter(o => o.dnc_queue_id).map(o => o.id))
  const needsClaimIds    = (orders || []).map(o => o.id).filter(id => !alreadyQueuedIds.has(id))

  // Atomically claim the orders that need a NEW scrub with a sentinel value.
  // A single UPDATE statement is evaluated per-row against current DB state
  // under row locks, so two concurrent scrub-dnc requests racing on the same
  // order can't both claim it — only one gets it back from .select(), so only
  // one request charges for and starts the scrub.
  let claimedIds = new Set()
  if (needsClaimIds.length) {
    const { data: claimed } = await supabase
      .from('skip_trace_orders')
      .update({ dnc_queue_id: 'pending' })
      .in('id', needsClaimIds)
      .eq('user_id', user.id)
      .is('dnc_queue_id', null)
      .select('id')
    claimedIds = new Set((claimed || []).map(o => o.id))
  }

  // Only charge for phones in orders this request actually claimed.
  const chargedPhones = records.reduce((sum, r) =>
    !r.order_id || !claimedIds.has(r.order_id) ? sum : sum + (r.result?.phones?.length || 0), 0)

  // ── Deduct DNC balance ($0.02/phone) — skipped for admins ─────────────────
  const COST_PER_PHONE = 0.02
  const cost = isAdmin ? 0 : Math.round(chargedPhones * COST_PER_PHONE * 100) / 100

  if (!isAdmin && chargedPhones > 0) {
    const { data: deducted, error: deductErr } = await supabase
      .rpc('deduct_skip_trace_balance', { p_user_id: user.id, p_amount: cost })

    if (deductErr) return err(deductErr.message, 500)
    if (!deducted) {
      return err(
        `Insufficient skip trace balance. This DNC scrub requires $${cost.toFixed(2)} ` +
        `(${chargedPhones} phone${chargedPhones !== 1 ? 's' : ''} × $${COST_PER_PHONE}/phone). ` +
        `Please add funds on the Credits page.`,
        402
      )
    }
  }

  const refund = () => {
    if (isAdmin || cost === 0) return Promise.resolve()
    return supabase.rpc('add_skip_trace_balance', { p_user_id: user.id, p_amount: cost })
      .catch(e => console.error('Failed to refund skip trace balance:', e.message))
  }

  let started      = 0
  let failedPhones = 0
  const errs       = []

  for (const order of (orders || [])) {
    if (!order.tracerfy_order_id) continue

    // Already in progress (existing scrub, or claimed by a concurrent request
    // just now) — count it as started, no charge, no duplicate Tracerfy call.
    if (alreadyQueuedIds.has(order.id) || !claimedIds.has(order.id)) { started++; continue }

    try {
      const res = await fetch(`${TRACERFY_BASE}/dnc/scrub-from-queue/`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${TRACERFY_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ queue_id: parseInt(order.tracerfy_order_id, 10) }),
      })
      const data = await res.json().catch(() => ({}))

      if (data.dnc_queue_id) {
        await supabase.from('skip_trace_orders')
          .update({ dnc_queue_id: String(data.dnc_queue_id), scrub_dnc: true })
          .eq('id', order.id)
        started++
      } else {
        // Release the claim so a future request can retry this order's scrub.
        await supabase.from('skip_trace_orders').update({ dnc_queue_id: null }).eq('id', order.id)
        failedPhones += phonesPerOrder[order.id] || 0
        errs.push(data.error || data.detail || `Order ${order.id}: unknown error`)
      }
    } catch (e) {
      console.error(`scrub-dnc: failed for order ${order.id}:`, e.message)
      await supabase.from('skip_trace_orders').update({ dnc_queue_id: null }).eq('id', order.id)
      failedPhones += phonesPerOrder[order.id] || 0
      errs.push(e.message)
    }
  }

  if (!started) {
    await refund()
    return err(errs[0] || 'Failed to start DNC scrub', 400)
  }

  // Partial refund for any new orders that failed to start
  if (failedPhones > 0 && !isAdmin) {
    const partialRefund = Math.round(failedPhones * COST_PER_PHONE * 100) / 100
    await supabase.rpc('add_skip_trace_balance', { p_user_id: user.id, p_amount: partialRefund })
      .catch(e => console.error('Failed to refund partial DNC balance:', e.message))
  }

  return ok({
    started,
    totalPhones,
    cost,
    message: `DNC scrub started for ${started} batch${started !== 1 ? 'es' : ''}. Results will update automatically.`,
  })
}
