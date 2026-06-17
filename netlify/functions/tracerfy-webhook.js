// Receives POST from Tracerfy when a skip trace queue completes.
// Configure your webhook URL in Tracerfy account settings:
//   https://your-atlas-app.netlify.app/.netlify/functions/tracerfy-webhook
import { adminSupabase, ok, err, options } from './utils/supabase.js'

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
    if (data.length < 100) break   // Tracerfy pages at 100
    page++
  }
  return rows
}

// Normalize a result row from Tracerfy into what we store in skip_trace_records.result
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
    first_name:   row.first_name    || null,
    last_name:    row.last_name     || null,
    full_name:    [row.first_name, row.last_name].filter(Boolean).join(' ') || null,
    phones,
    emails,
    mail_address: row.mail_address  || null,
    address:      row.address       || null,
    city:         row.city          || null,
    state:        row.state         || null,
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return err('Invalid body', 400) }

  // Tracerfy sends different payloads for normal traces vs parcel traces
  // For normal/advanced trace: { id, pending, download_url, rows_uploaded, credits_deducted, trace_type }
  const queueId = payload.id != null ? String(payload.id) : null
  if (!queueId) {
    console.log('tracerfy-webhook: no queue id in payload', JSON.stringify(payload))
    return ok({ ignored: true })
  }
  if (payload.pending !== false) {
    // Still processing — Tracerfy shouldn't send this but guard anyway
    return ok({ ignored: true, reason: 'still pending' })
  }

  const supabase = adminSupabase()

  // Find the order matching this Tracerfy queue
  const { data: order, error: orderErr } = await supabase
    .from('skip_trace_orders')
    .select('id, user_id')
    .eq('tracerfy_order_id', queueId)
    .maybeSingle()

  if (orderErr || !order) {
    console.log('tracerfy-webhook: no matching order for queue', queueId)
    return ok({ ignored: true, reason: 'order not found' })
  }

  // Mark order completed
  await supabase
    .from('skip_trace_orders')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', order.id)

  // Fetch detailed results from Tracerfy if API key is available
  if (!TRACERFY_API_KEY) return ok({ ok: true })

  try {
    const results = await fetchQueueResults(queueId)

    // Fetch the submitted records for this order so we can match by address
    const { data: records } = await supabase
      .from('skip_trace_records')
      .select('id, address, city, state_code')
      .eq('order_id', order.id)

    if (records?.length && results.length) {
      // Match results to records by address (case-insensitive prefix match)
      const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

      for (const record of records) {
        const addrKey = normalize(record.address)
        const match = results.find(r =>
          normalize(r.address).startsWith(addrKey.slice(0, 10)) ||
          addrKey.startsWith(normalize(r.address).slice(0, 10))
        )
        if (match) {
          await supabase
            .from('skip_trace_records')
            .update({
              status:       'completed',
              completed_at: new Date().toISOString(),
              result:       normalizeResult(match),
            })
            .eq('id', record.id)
        }
      }

      // Any unmatched records → mark completed without result
      await supabase
        .from('skip_trace_records')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('order_id', order.id)
        .eq('status', 'submitted')
    } else {
      // No results at all — still mark records complete
      await supabase
        .from('skip_trace_records')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('order_id', order.id)
    }
  } catch (e) {
    console.error('tracerfy-webhook: failed to fetch results:', e.message)
    // Don't return an error — Tracerfy may retry. Order is already marked complete.
  }

  return ok({ ok: true })
}
