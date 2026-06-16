import { requireAuth, adminSupabase, ok, err, options, isValidUUID } from './utils/supabase.js'

const PRICE_PER_RECORD = parseFloat(process.env.TRACERFY_PRICE_PER_RECORD || '0.18')
const TRACERFY_API_KEY = process.env.TRACERFY_API_KEY
const TRACERFY_API_URL = process.env.TRACERFY_API_URL || 'https://api.tracerfy.com/v1/orders'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return err('Invalid body', 400) }

  const { recordIds } = body
  if (!Array.isArray(recordIds) || recordIds.length === 0) return err('recordIds required', 400)
  if (recordIds.some(id => !isValidUUID(id))) return err('Invalid record id', 400)
  if (recordIds.length > 500) return err('Maximum 500 records per submission', 400)

  const supabase = adminSupabase()

  // Fetch only the user's 'saved' records matching the requested IDs
  const { data: records, error: fetchErr } = await supabase
    .from('skip_trace_records')
    .select('*')
    .in('id', recordIds)
    .eq('user_id', user.id)
    .eq('status', 'saved')

  if (fetchErr) return err(fetchErr.message, 500)
  if (!records?.length) return err('No eligible records found', 400)

  const costUsd = +(records.length * PRICE_PER_RECORD).toFixed(2)

  // ── Submit to Tracerfy ──────────────────────────────────────
  let tracerfyOrderId = null

  if (TRACERFY_API_KEY) {
    const payload = {
      records: records.map(r => ({
        first_name: r.first_name || undefined,
        last_name:  r.last_name  || undefined,
        address:    r.address    || undefined,
        city:       r.city       || undefined,
        state:      r.state_code || undefined,
        zip:        r.zip        || undefined,
      })),
    }

    try {
      const res = await fetch(TRACERFY_API_URL, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${TRACERFY_API_KEY}`,
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = data.message || data.error || `Tracerfy error (${res.status})`
        console.error('Tracerfy error:', msg)
        return err(`Skip trace service error: ${msg}`, 502)
      }
      tracerfyOrderId = data.orderId || data.id || data.order_id || null
    } catch (e) {
      console.error('Tracerfy request failed:', e.message)
      return err('Failed to contact skip trace service. Please try again.', 502)
    }
  } else {
    // No API key configured — record the order as pending for manual processing
    console.warn('TRACERFY_API_KEY not set — order saved without API submission')
  }

  // ── Persist the order ───────────────────────────────────────
  const { data: order, error: orderErr } = await supabase
    .from('skip_trace_orders')
    .insert({
      user_id:           user.id,
      tracerfy_order_id: tracerfyOrderId,
      record_count:      records.length,
      cost_usd:          costUsd,
      status:            TRACERFY_API_KEY ? 'processing' : 'pending',
    })
    .select()
    .single()

  if (orderErr) return err(orderErr.message, 500)

  // Mark records as submitted
  const { error: updateErr } = await supabase
    .from('skip_trace_records')
    .update({
      status:       'submitted',
      order_id:     order.id,
      submitted_at: new Date().toISOString(),
    })
    .in('id', records.map(r => r.id))
    .eq('user_id', user.id)

  if (updateErr) return err(updateErr.message, 500)

  return ok({ order, recordCount: records.length, costUsd, pricePerRecord: PRICE_PER_RECORD })
}
