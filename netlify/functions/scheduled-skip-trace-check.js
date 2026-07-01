import { adminSupabase } from './utils/supabase.js'
import { normalizeResult, matchRecord } from './utils/tracerfy.js'

const TRACERFY_API_KEY = process.env.TRACERFY_API_KEY
const TRACERFY_BASE    = 'https://tracerfy.com/v1/api'

async function fetchQueueStatuses() {
  const queues = []
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(`${TRACERFY_BASE}/queues/?page=${page}`, {
      headers: { Authorization: `Bearer ${TRACERFY_API_KEY}` },
    })
    if (!res.ok) break
    const data = await res.json().catch(() => null)
    if (!Array.isArray(data) || !data.length) break
    queues.push(...data)
    if (data.length < 100) break
  }
  return queues
}

async function fetchQueueResults(queueId) {
  const rows = []
  for (let page = 1; ; page++) {
    const res = await fetch(`${TRACERFY_BASE}/queue/${queueId}?page=${page}`, {
      headers: { Authorization: `Bearer ${TRACERFY_API_KEY}` },
    })
    if (!res.ok) break
    const data = await res.json().catch(() => null)
    if (!Array.isArray(data) || !data.length) break
    rows.push(...data)
    if (data.length < 100) break
  }
  return rows
}

export const handler = async () => {
  if (!TRACERFY_API_KEY) {
    console.error('[scheduled-skip-trace-check] TRACERFY_API_KEY not set')
    return { statusCode: 200 }
  }

  const supabase = adminSupabase()

  // Resolve orphaned orders: processing with no tracerfy_order_id for > 10 min
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: orphaned } = await supabase
    .from('skip_trace_orders')
    .select('id, cost_usd, user_id')
    .eq('status', 'processing')
    .is('tracerfy_order_id', null)
    .lt('created_at', tenMinAgo)

  for (const o of (orphaned || [])) {
    const { data: claimed } = await supabase
      .from('skip_trace_orders')
      .update({ status: 'failed' })
      .eq('id', o.id)
      .eq('status', 'processing')
      .select('id, cost_usd')
    if (!claimed?.length) continue
    await supabase.from('skip_trace_records').update({ status: 'saved' }).eq('order_id', o.id)
    if ((claimed[0].cost_usd || 0) > 0) {
      await supabase.rpc('add_skip_trace_balance', { p_user_id: o.user_id, p_amount: claimed[0].cost_usd })
        .catch(e => console.error('[scheduled] refund failed:', e.message))
    }
    console.log(`[scheduled-skip-trace-check] refunded orphaned order ${o.id}`)
  }

  // Check all processing orders across all users
  const { data: orders } = await supabase
    .from('skip_trace_orders')
    .select('id, tracerfy_order_id, user_id, cost_usd, created_at')
    .eq('status', 'processing')
    .not('tracerfy_order_id', 'is', null)

  if (!orders?.length) {
    console.log('[scheduled-skip-trace-check] no pending orders')
    return { statusCode: 200 }
  }

  console.log(`[scheduled-skip-trace-check] checking ${orders.length} pending order(s)`)

  let queueStatuses = []
  try {
    queueStatuses = await fetchQueueStatuses()
  } catch (e) {
    console.error('[scheduled-skip-trace-check] Tracerfy unreachable:', e.message)
  }

  const statusMap = Object.fromEntries(queueStatuses.map(q => [String(q.id), q]))
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  let completed = 0

  const resolveOrder = async (order, results) => {
    const now = new Date().toISOString()
    if (!results.length) {
      await supabase.from('skip_trace_records')
        .update({ status: 'completed', completed_at: now })
        .eq('order_id', order.id)
    } else {
      const { data: records } = await supabase.from('skip_trace_records')
        .select('id, address').eq('order_id', order.id)
      if (records?.length) {
        const updatedIds = new Set()
        for (const row of results) {
          const match = matchRecord(row, records)
          if (!match || updatedIds.has(match.id)) continue
          updatedIds.add(match.id)
          await supabase.from('skip_trace_records')
            .update({ status: 'completed', completed_at: now, result: normalizeResult(row) })
            .eq('id', match.id)
        }
        const unmatchedIds = records.map(r => r.id).filter(id => !updatedIds.has(id))
        if (unmatchedIds.length) {
          await supabase.from('skip_trace_records')
            .update({ status: 'completed', completed_at: now })
            .in('id', unmatchedIds)
        }
      }
    }
    await supabase.from('skip_trace_orders')
      .update({ status: 'completed', completed_at: now })
      .eq('id', order.id)
  }

  for (const order of orders) {
    const qid = order.tracerfy_order_id
    const fromList = statusMap[qid]

    // Case 1: found in list and marked done
    if (fromList && fromList.pending == false) {
      try {
        const results = await fetchQueueResults(qid)
        await resolveOrder(order, results)
        completed++
        console.log(`[scheduled-skip-trace-check] resolved order ${order.id}`)
      } catch (e) {
        console.error(`[scheduled-skip-trace-check] resolve failed for ${qid}:`, e.message)
      }
      continue
    }

    // Case 2: not in recent list — try fetching results directly
    if (!fromList) {
      try {
        const results = await fetchQueueResults(qid)
        if (results.length > 0) {
          await resolveOrder(order, results)
          completed++
          console.log(`[scheduled-skip-trace-check] resolved via direct fetch: order ${order.id}`)
          continue
        }
      } catch (e) {
        console.error(`[scheduled-skip-trace-check] direct fetch failed for ${qid}:`, e.message)
      }
    }

    // Case 3: stuck > 2 hours with no results — force-complete the job
    if (order.created_at < twoHoursAgo) {
      const now = new Date().toISOString()
      await supabase.from('skip_trace_records')
        .update({ status: 'completed', completed_at: now })
        .eq('order_id', order.id)
      await supabase.from('skip_trace_orders')
        .update({ status: 'completed', completed_at: now })
        .eq('id', order.id)
      console.log(`[scheduled-skip-trace-check] force-completed stuck order ${order.id}`)
      completed++
    }
  }

  console.log(`[scheduled-skip-trace-check] done — ${completed} resolved`)
  return { statusCode: 200 }
}
