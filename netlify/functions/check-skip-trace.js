import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'
import { normalizeResult, matchRecord } from './utils/tracerfy.js'

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

// Normalize a phone string to its last 10 digits for consistent matching.
const normPhone = (s) => (s || '').replace(/\D/g, '').slice(-10)

// Minimal CSV line parser — handles double-quoted fields containing commas.
function splitCsvLine(line) {
  const cols = []
  let field = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { field += '"'; i++ }
      else inQ = !inQ
    } else if (ch === ',' && !inQ) {
      cols.push(field.trim())
      field = ''
    } else {
      field += ch
    }
  }
  cols.push(field.trim())
  return cols
}

// Parse Tracerfy's DNC full-results CSV.
// Returns a Map of { last10Digits → { isClean, national_dnc, state_dnc, dma, litigator } }.
async function parseDncCsv(url) {
  try {
    const res  = await fetch(url)
    if (!res.ok) {
      console.error('parseDncCsv: HTTP', res.status, url)
      return new Map()
    }
    const text = await res.text()
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return new Map()

    const strip     = s => s.trim().replace(/^"|"$/g, '')
    // Handle: true/false, 1/0, yes/no, y/n (Tracerfy may use any of these)
    const parseBool = s => { const v = strip(s || '').toLowerCase(); return v === 'true' || v === '1' || v === 'yes' || v === 'y' }

    // Normalise headers: lowercase + collapse spaces/hyphens to underscores
    const normaliseHeader = h => strip(h).toLowerCase().replace(/[\s\-]+/g, '_')
    const headers = splitCsvLine(lines[0]).map(normaliseHeader)

    console.log('parseDncCsv: headers =', JSON.stringify(headers))
    if (lines.length > 1) {
      console.log('parseDncCsv: first data row =', JSON.stringify(splitCsvLine(lines[1])))
    }

    const col = (...names) => {
      for (const n of names) {
        const i = headers.indexOf(n)
        if (i >= 0) return i
      }
      return -1
    }

    const phoneIdx       = col('phone', 'phone_number', 'number')
    const isCleanIdx     = col('is_clean', 'isclean', 'clean')
    const nationalDncIdx = col('national_dnc', 'national', 'federal_dnc', 'federal')
    const stateDncIdx    = col('state_dnc', 'state')
    const dmaIdx         = col('dma', 'do_not_mail')
    const litigatorIdx   = col('litigator', 'tcpa_litigator', 'tcpa')

    console.log('parseDncCsv: column indices =', { phoneIdx, isCleanIdx, nationalDncIdx, stateDncIdx, dmaIdx, litigatorIdx })

    if (phoneIdx < 0 || isCleanIdx < 0) {
      console.error('parseDncCsv: required columns not found in headers:', headers)
      return new Map()
    }

    const map = new Map()
    for (const line of lines.slice(1)) {
      const cols = splitCsvLine(line)
      const key  = normPhone(strip(cols[phoneIdx] || ''))
      if (!key) continue

      const national_dnc = nationalDncIdx >= 0 ? parseBool(cols[nationalDncIdx]) : undefined
      const state_dnc    = stateDncIdx    >= 0 ? parseBool(cols[stateDncIdx])    : undefined
      const dma          = dmaIdx         >= 0 ? parseBool(cols[dmaIdx])         : undefined
      const litigator    = litigatorIdx   >= 0 ? parseBool(cols[litigatorIdx])   : undefined

      const isClean = isCleanIdx >= 0
        ? parseBool(cols[isCleanIdx])
        : !national_dnc && !state_dnc && !dma && !litigator

      map.set(key, { isClean, national_dnc, state_dnc, dma, litigator })
    }

    console.log(`parseDncCsv: parsed ${map.size} phone entries from ${lines.length - 1} rows`)
    return map
  } catch (e) {
    console.error('parseDncCsv failed:', e.message)
    return new Map()
  }
}

// Apply DNC flags from dncMap to every record in the order.
async function applyDncToRecords(supabase, orderId, dncMap) {
  if (!dncMap.size) {
    console.error('applyDncToRecords: dncMap is empty — skipping to avoid false results')
    return 0
  }

  const { data: records } = await supabase
    .from('skip_trace_records')
    .select('id, result')
    .eq('order_id', orderId)
    .not('result', 'is', null)

  if (!records?.length) return 0

  const updates = []
  for (const record of records) {
    if (!record.result?.phones?.length) continue

    const phones = record.result.phones.map(ph => {
      const key   = normPhone(ph.number)
      if (!key) return ph
      const entry = dncMap.get(key)
      if (!entry) return { ...ph, dnc: false }
      return {
        ...ph,
        dnc:          !entry.isClean,
        national_dnc: entry.national_dnc,
        state_dnc:    entry.state_dnc,
        dma:          entry.dma,
        litigator:    entry.litigator,
      }
    })

    updates.push({ id: record.id, result: { ...record.result, phones, dnc_scrubbed: true } })
  }

  await Promise.all(updates.map(({ id, result }) =>
    supabase.from('skip_trace_records').update({ result }).eq('id', id)
  ))
  return updates.length
}

// ─────────────────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  if (!TRACERFY_API_KEY) return err('TRACERFY_API_KEY not configured', 503)

  const supabase = adminSupabase()

  // Clean up orphaned orders: stuck in 'processing' with no tracerfy_order_id for > 10 min.
  // These occur when a Netlify function timeout fires after balance deduction but before the
  // Tracerfy API call completes. Reset records to 'saved' so the user can resubmit.
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: orphaned } = await supabase
    .from('skip_trace_orders')
    .select('id, cost_usd')
    .eq('user_id', user.id)
    .eq('status', 'processing')
    .is('tracerfy_order_id', null)
    .lt('created_at', tenMinAgo)

  if (orphaned?.length) {
    await Promise.all(orphaned.map(async o => {
      // Atomically claim by filtering on status='processing' — prevents double-refund
      // if two concurrent check requests find the same orphaned order.
      const { data: claimed } = await supabase
        .from('skip_trace_orders')
        .update({ status: 'failed' })
        .eq('id', o.id)
        .eq('status', 'processing')
        .select('id, cost_usd')
      if (!claimed?.length) return // another concurrent call already handled this order
      const cost_usd = claimed[0].cost_usd
      await supabase.from('skip_trace_records').update({ status: 'saved' }).eq('order_id', o.id)
      if ((cost_usd || 0) > 0) {
        await supabase.rpc('add_skip_trace_balance', { p_user_id: user.id, p_amount: cost_usd })
          .catch(e => console.error('Failed to refund orphaned order balance:', e.message))
      }
    }))
  }

  // ── Phase 1: check pending trace orders ─────────────────────────────────

  const { data: orders, error: ordersErr } = await supabase
    .from('skip_trace_orders')
    .select('id, tracerfy_order_id')
    .eq('user_id', user.id)
    .eq('status', 'processing')
    .not('tracerfy_order_id', 'is', null)

  if (ordersErr) return err(ordersErr.message, 500)

  let queueStatuses = []
  if (orders?.length) {
    try {
      queueStatuses = await fetchQueueStatuses()
    } catch (e) {
      return err('Failed to reach Tracerfy: ' + e.message, 502)
    }
  }

  const statusMap = Object.fromEntries(queueStatuses.map(q => [String(q.id), q]))

  let completed      = 0
  let recordsUpdated = 0

  for (const order of (orders || [])) {
    const queueStatus = statusMap[order.tracerfy_order_id]
    // Use loose equality so pending: 0 (number) is treated the same as pending: false (boolean)
    if (!queueStatus || queueStatus.pending != false) continue

    let results = []
    try {
      results = await fetchQueueResults(order.tracerfy_order_id)
    } catch (e) {
      console.error(`Failed to fetch results for queue ${order.tracerfy_order_id}:`, e.message)
      continue
    }

    const now = new Date().toISOString()

    // Write records first, then mark order complete — keeps order 'processing' if
    // a timeout fires mid-loop so check-skip-trace will re-attempt on next call.
    if (!results.length) {
      await supabase
        .from('skip_trace_records')
        .update({ status: 'completed', completed_at: now })
        .eq('order_id', order.id)
    } else {
      const { data: records } = await supabase
        .from('skip_trace_records')
        .select('id, address')
        .eq('order_id', order.id)

      if (records?.length) {
        const updatedIds   = new Set()
        const matchUpdates = []
        for (const row of results) {
          const match = matchRecord(row, records)
          if (!match || updatedIds.has(match.id)) continue
          updatedIds.add(match.id)
          matchUpdates.push({ id: match.id, result: normalizeResult(row) })
        }

        // Parallel writes for matched records
        await Promise.all(matchUpdates.map(({ id, result }) =>
          supabase.from('skip_trace_records')
            .update({ status: 'completed', completed_at: now, result })
            .eq('id', id)
        ))
        recordsUpdated += matchUpdates.length

        const unmatchedIds = records.map(r => r.id).filter(id => !updatedIds.has(id))
        if (unmatchedIds.length) {
          await supabase
            .from('skip_trace_records')
            .update({ status: 'completed', completed_at: now })
            .in('id', unmatchedIds)
        }
      }
    }

    await supabase
      .from('skip_trace_orders')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', order.id)

    completed++
  }

  // ── Phase 2: check pending DNC queues ────────────────────────────────────

  const { data: dncOrders } = await supabase
    .from('skip_trace_orders')
    .select('id, dnc_queue_id')
    .eq('user_id', user.id)
    .eq('status', 'completed')
    .not('dnc_queue_id', 'is', null)

  let dncRecordsUpdated = 0

  for (const dncOrder of (dncOrders || [])) {
    try {
      const res = await fetch(`${TRACERFY_BASE}/dnc/queue/${dncOrder.dnc_queue_id}`, {
        headers: { Authorization: `Bearer ${TRACERFY_API_KEY}` },
      })
      const dncStatus = await res.json().catch(() => null)

      // Use loose equality so pending: 0 (number) is treated the same as pending: false (boolean)
      if (!dncStatus || dncStatus.pending != false) continue
      if (!dncStatus.download_url) continue

      const dncMap = await parseDncCsv(dncStatus.download_url)
      // Only clear the queue ID when the CSV parsed successfully (dncMap.size > 0).
      // An empty map means the CSV was unreadable — leave dnc_queue_id set so the
      // next check retries rather than silently losing the DNC results.
      if (dncMap.size > 0) {
        dncRecordsUpdated += await applyDncToRecords(supabase, dncOrder.id, dncMap)
        const { error: clearErr } = await supabase.from('skip_trace_orders')
          .update({ dnc_queue_id: null })
          .eq('id', dncOrder.id)
        if (clearErr) console.error(`Failed to clear dnc_queue_id for order ${dncOrder.id}:`, clearErr.message)
      } else {
        console.error(`parseDncCsv returned empty map for order ${dncOrder.id} — will retry on next check`)
      }
    } catch (e) {
      console.error(`Failed to check DNC queue ${dncOrder.dnc_queue_id}:`, e.message)
    }
  }

  return ok({ checked: orders?.length ?? 0, completed, recordsUpdated, dncRecordsUpdated })
}
