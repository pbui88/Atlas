import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

const TRACERFY_API_KEY = process.env.TRACERFY_API_KEY
const TRACERFY_BASE    = 'https://tracerfy.com/v1/api'

// Fetch queue metadata pages until we've seen all recent queues (up to 3 pages / 300 queues)
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

// Fetch all result rows for a completed queue (paginated at 100)
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

// Build normalised result object stored per skip_trace_record
function normalizeResult(row) {
  const phones = [
    row.primary_phone && { number: row.primary_phone, type: 'primary' },
    row.mobile_1   && { number: row.mobile_1,   type: 'mobile' },
    row.mobile_2   && { number: row.mobile_2,   type: 'mobile' },
    row.mobile_3   && { number: row.mobile_3,   type: 'mobile' },
    row.mobile_4   && { number: row.mobile_4,   type: 'mobile' },
    row.mobile_5   && { number: row.mobile_5,   type: 'mobile' },
    row.landline_1 && { number: row.landline_1, type: 'landline' },
    row.landline_2 && { number: row.landline_2, type: 'landline' },
    row.landline_3 && { number: row.landline_3, type: 'landline' },
  ].filter(Boolean)

  const emails = [
    row.email_1 || null,
    row.email_2 || null,
    row.email_3 || null,
    row.email_4 || null,
    row.email_5 || null,
  ].filter(Boolean)

  return {
    first_name:   row.first_name  || null,
    last_name:    row.last_name   || null,
    full_name:    [row.first_name, row.last_name].filter(Boolean).join(' ') || null,
    phones,
    emails,
    mail_address: row.mail_address || null,
  }
}

// Match a Tracerfy result row back to one of our saved records by address
function matchRecord(tracerfyRow, records) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const rowKey = norm(tracerfyRow.address)
  if (!rowKey) return null
  return records.find(r => {
    const recKey = norm(r.address)
    return recKey && (
      rowKey.startsWith(recKey.slice(0, 8)) ||
      recKey.startsWith(rowKey.slice(0, 8))
    )
  }) || null
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  if (!TRACERFY_API_KEY) return err('TRACERFY_API_KEY not configured', 503)

  const supabase = adminSupabase()

  // Find all orders for this user that are still marked processing
  const { data: orders, error: ordersErr } = await supabase
    .from('skip_trace_orders')
    .select('id, tracerfy_order_id')
    .eq('user_id', user.id)
    .eq('status', 'processing')
    .not('tracerfy_order_id', 'is', null)

  if (ordersErr) return err(ordersErr.message, 500)
  if (!orders?.length) return ok({ checked: 0, completed: 0, recordsUpdated: 0 })

  // Pull queue statuses from Tracerfy
  let queueStatuses
  try {
    queueStatuses = await fetchQueueStatuses()
  } catch (e) {
    return err('Failed to reach Tracerfy: ' + e.message, 502)
  }

  const statusMap = Object.fromEntries(queueStatuses.map(q => [String(q.id), q]))

  let completed      = 0
  let recordsUpdated = 0

  for (const order of orders) {
    const queueStatus = statusMap[order.tracerfy_order_id]

    // If we can't find the queue or it's still pending, skip
    if (!queueStatus || queueStatus.pending !== false) continue

    // Queue is done — fetch results
    let results = []
    try {
      results = await fetchQueueResults(order.tracerfy_order_id)
    } catch (e) {
      console.error(`Failed to fetch results for queue ${order.tracerfy_order_id}:`, e.message)
      continue
    }

    // Mark order complete
    await supabase
      .from('skip_trace_orders')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', order.id)

    completed++

    if (!results.length) {
      // No matches — still mark records as completed
      await supabase
        .from('skip_trace_records')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('order_id', order.id)
      continue
    }

    // Fetch submitted records for this order so we can match by address
    const { data: records } = await supabase
      .from('skip_trace_records')
      .select('id, address')
      .eq('order_id', order.id)

    if (!records?.length) continue

    const updatedIds = new Set()

    for (const row of results) {
      const match = matchRecord(row, records)
      if (!match || updatedIds.has(match.id)) continue
      updatedIds.add(match.id)

      await supabase
        .from('skip_trace_records')
        .update({
          status:       'completed',
          completed_at: new Date().toISOString(),
          result:       normalizeResult(row),
        })
        .eq('id', match.id)

      recordsUpdated++
    }

    // Any records that didn't get a match — mark completed without result
    const unmatchedIds = records.map(r => r.id).filter(id => !updatedIds.has(id))
    if (unmatchedIds.length) {
      await supabase
        .from('skip_trace_records')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .in('id', unmatchedIds)
    }
  }

  return ok({ checked: orders.length, completed, recordsUpdated })
}
