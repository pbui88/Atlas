import { requireAuth, adminSupabase, ok, err, options, isValidUUID } from './utils/supabase.js'

const TRACERFY_API_KEY = process.env.TRACERFY_API_KEY
const TRACERFY_BASE    = 'https://tracerfy.com/v1/api'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return err('Invalid body', 400) }

  const { recordIds, traceType = 'advanced', scrubDnc = false } = body
  if (!Array.isArray(recordIds) || recordIds.length === 0) return err('recordIds required', 400)
  if (recordIds.some(id => !isValidUUID(id))) return err('Invalid record id', 400)
  if (recordIds.length > 500) return err('Maximum 500 records per submission', 400)
  if (!['normal', 'advanced'].includes(traceType)) return err('traceType must be normal or advanced', 400)

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

  const creditsPerLead = traceType === 'advanced' ? 2 : 1

  // ── Create order row first ─────────────────────────────────
  const { data: order, error: orderErr } = await supabase
    .from('skip_trace_orders')
    .insert({
      user_id:      user.id,
      record_count: records.length,
      cost_usd:     0,
      status:       TRACERFY_API_KEY ? 'processing' : 'pending',
      scrub_dnc:    !!scrubDnc,
    })
    .select()
    .single()

  if (orderErr) return err(orderErr.message, 500)

  // Mark records as submitted immediately so they can't be double-submitted
  await supabase
    .from('skip_trace_records')
    .update({ status: 'submitted', order_id: order.id, submitted_at: new Date().toISOString() })
    .in('id', records.map(r => r.id))
    .eq('user_id', user.id)

  // ── Submit to Tracerfy ──────────────────────────────────────
  if (TRACERFY_API_KEY) {
    // Build row objects — Tracerfy uses column-name mapping
    const rows = records.map(r => ({
      address: r.address || '',
      city:    r.city    || '',
      state:   r.state_code || '',
      zip:     r.zip     || '',
    }))

    // Tracerfy requires multipart/form-data — do NOT set Content-Type manually
    // so fetch can attach the correct boundary for the FormData body.
    const form = new FormData()
    form.append('json_data',      JSON.stringify(rows))
    form.append('address_column', 'address')
    form.append('city_column',    'city')
    form.append('state_column',   'state')
    form.append('zip_column',     'zip')
    form.append('trace_type',     traceType)
    // DNC scrub is a separate Tracerfy step (dnc/scrub-from-queue/) run after trace completes

    try {
      const res = await fetch(`${TRACERFY_BASE}/trace/`, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${TRACERFY_API_KEY}` },
        body:    form,
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const msg = data.error || data.detail || `Tracerfy error (${res.status})`
        console.error('Tracerfy /trace/ error:', msg)
        // Mark order as failed but don't block the response — records are already submitted
        await supabase.from('skip_trace_orders').update({ status: 'failed' }).eq('id', order.id)
        await supabase.from('skip_trace_records').update({ status: 'failed' }).eq('order_id', order.id)
        return err(`Skip trace service error: ${msg}`, 502)
      }

      // Store the Tracerfy queue_id so the webhook can match back
      await supabase
        .from('skip_trace_orders')
        .update({ tracerfy_order_id: String(data.queue_id) })
        .eq('id', order.id)

    } catch (e) {
      console.error('Tracerfy request failed:', e.message)
      await supabase.from('skip_trace_orders').update({ status: 'failed' }).eq('id', order.id)
      await supabase.from('skip_trace_records').update({ status: 'failed' }).eq('order_id', order.id)
      return err('Failed to contact skip trace service. Please try again.', 502)
    }
  }

  return ok({
    orderId:      order.id,
    recordCount:  records.length,
    creditsPerLead,
    traceType,
    status:       TRACERFY_API_KEY ? 'processing' : 'pending',
  })
}
