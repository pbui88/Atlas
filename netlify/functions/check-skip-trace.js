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
  const makePhone = (number, type, field) => {
    if (!number) return null
    const dncKey = `${field}_dnc`
    return dncKey in row ? { number, type, dnc: !!row[dncKey] } : { number, type }
  }

  const phoneFields = [
    ['primary_phone', 'primary',  'primary_phone'],
    ['mobile_1',      'mobile',   'mobile_1'],
    ['mobile_2',      'mobile',   'mobile_2'],
    ['mobile_3',      'mobile',   'mobile_3'],
    ['mobile_4',      'mobile',   'mobile_4'],
    ['mobile_5',      'mobile',   'mobile_5'],
    ['landline_1',    'landline', 'landline_1'],
    ['landline_2',    'landline', 'landline_2'],
    ['landline_3',    'landline', 'landline_3'],
  ]
  const phones = phoneFields.map(([f, t, k]) => makePhone(row[f], t, k)).filter(Boolean)

  const dncScrubbed = phoneFields.some(([,, k]) => `${k}_dnc` in row)

  const emails = [row.email_1, row.email_2, row.email_3, row.email_4, row.email_5].filter(Boolean)

  return {
    first_name:   row.first_name  || null,
    last_name:    row.last_name   || null,
    full_name:    [row.first_name, row.last_name].filter(Boolean).join(' ') || null,
    phones,
    emails,
    mail_address: row.mail_address || null,
    ...(dncScrubbed ? { dnc_scrubbed: true } : {}),
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

// ── DNC helpers ───────────────────────────────────────────────────────────────

// Start a DNC scrub-from-queue for a completed trace order.
// Returns the Tracerfy dnc_queue_id on success, null on failure.
async function startDncScrub(tracerfyQueueId) {
  try {
    const res = await fetch(`${TRACERFY_BASE}/dnc/scrub-from-queue/`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${TRACERFY_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ queue_id: parseInt(tracerfyQueueId, 10) }),
    })
    const data = await res.json().catch(() => ({}))
    return data.dnc_queue_id ? String(data.dnc_queue_id) : null
  } catch (e) {
    console.error('startDncScrub failed:', e.message)
    return null
  }
}

// Normalize a phone string to its last 10 digits for consistent matching.
// Handles formats like "+15551234567", "(555) 123-4567", "5551234567".
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
    const parseBool = s => { const v = strip(s || '').toLowerCase(); return v === 'true' || v === '1' || v === 'yes' }

    // Normalise headers: lowercase + collapse spaces/hyphens to underscores
    // so "National DNC", "national-dnc", "national_dnc" all become "national_dnc"
    const normaliseHeader = h => strip(h).toLowerCase().replace(/[\s\-]+/g, '_')
    const headers = splitCsvLine(lines[0]).map(normaliseHeader)

    console.log('parseDncCsv: headers =', JSON.stringify(headers))
    if (lines.length > 1) {
      console.log('parseDncCsv: first data row =', JSON.stringify(splitCsvLine(lines[1])))
    }

    // Accept multiple possible header names for each field
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
      map.set(key, {
        isClean:      parseBool(nationalDncIdx >= 0 ? cols[isCleanIdx]     : ''),
        national_dnc: nationalDncIdx >= 0 ? parseBool(cols[nationalDncIdx]) : false,
        state_dnc:    stateDncIdx    >= 0 ? parseBool(cols[stateDncIdx])    : false,
        dma:          dmaIdx         >= 0 ? parseBool(cols[dmaIdx])         : false,
        litigator:    litigatorIdx   >= 0 ? parseBool(cols[litigatorIdx])   : false,
      })
    }

    // Re-derive isClean from flags when the column was found
    for (const [key, entry] of map) {
      if (isCleanIdx >= 0) {
        // Already set from CSV — leave as-is
      } else {
        // Fall back: clean if none of the flags are set
        entry.isClean = !entry.national_dnc && !entry.state_dnc && !entry.dma && !entry.litigator
      }
    }

    console.log(`parseDncCsv: parsed ${map.size} phone entries from ${lines.length - 1} rows`)
    return map
  } catch (e) {
    console.error('parseDncCsv failed:', e.message)
    return new Map()
  }
}

// Apply DNC flags from dncMap to every record in the order.
// Sets phone.dnc and result.dnc_scrubbed = true.
// Only marks a phone dnc:true/false if it was found in the DNC map;
// phones not found in the map are left with dnc:false (conservatively clean).
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
  let updated = 0

  for (const record of records) {
    if (!record.result?.phones?.length) continue

    const phones = record.result.phones.map(ph => {
      const key   = normPhone(ph.number)
      if (!key) return ph
      const entry = dncMap.get(key)
      if (!entry) return { ...ph, dnc: false }  // not returned by DNC scrub → treat as clean
      return {
        ...ph,
        dnc:          !entry.isClean,
        national_dnc: entry.national_dnc,
        state_dnc:    entry.state_dnc,
        dma:          entry.dma,
        litigator:    entry.litigator,
      }
    })

    await supabase.from('skip_trace_records')
      .update({ result: { ...record.result, phones, dnc_scrubbed: true } })
      .eq('id', record.id)

    updated++
  }
  return updated
}

// ─────────────────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  if (!TRACERFY_API_KEY) return err('TRACERFY_API_KEY not configured', 503)

  const supabase = adminSupabase()

  // ── Phase 1: check pending trace orders ─────────────────────────────────

  const { data: orders, error: ordersErr } = await supabase
    .from('skip_trace_orders')
    .select('id, tracerfy_order_id, scrub_dnc')
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
  const dncStarted   = []   // orders that need DNC scrub kicked off

  for (const order of (orders || [])) {
    const queueStatus = statusMap[order.tracerfy_order_id]
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
      await supabase
        .from('skip_trace_records')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('order_id', order.id)
    } else {
      const { data: records } = await supabase
        .from('skip_trace_records')
        .select('id, address')
        .eq('order_id', order.id)

      if (records?.length) {
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

        const unmatchedIds = records.map(r => r.id).filter(id => !updatedIds.has(id))
        if (unmatchedIds.length) {
          await supabase
            .from('skip_trace_records')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .in('id', unmatchedIds)
        }
      }
    }

    // If DNC scrub was requested, kick it off now (results are ready in Tracerfy)
    if (order.scrub_dnc) {
      dncStarted.push({ orderId: order.id, tracerfyQueueId: order.tracerfy_order_id })
    }
  }

  // Start DNC scrubs for newly-completed trace orders
  for (const { orderId, tracerfyQueueId } of dncStarted) {
    const dncQueueId = await startDncScrub(tracerfyQueueId)
    if (dncQueueId) {
      await supabase.from('skip_trace_orders')
        .update({ dnc_queue_id: dncQueueId })
        .eq('id', orderId)
    }
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

      if (!dncStatus || dncStatus.pending !== false) continue  // still processing
      if (!dncStatus.download_url) continue

      // DNC complete — parse full-results CSV and apply flags
      const dncMap = await parseDncCsv(dncStatus.download_url)
      dncRecordsUpdated += await applyDncToRecords(supabase, dncOrder.id, dncMap)

      // Clear queue ID so we don't reprocess on the next check
      await supabase.from('skip_trace_orders')
        .update({ dnc_queue_id: null })
        .eq('id', dncOrder.id)
    } catch (e) {
      console.error(`Failed to check DNC queue ${dncOrder.dnc_queue_id}:`, e.message)
    }
  }

  return ok({ checked: orders?.length ?? 0, completed, recordsUpdated, dncRecordsUpdated })
}
