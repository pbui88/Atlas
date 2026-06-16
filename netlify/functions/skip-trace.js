import { requireAuth, adminSupabase, ok, err, options, isValidUUID } from './utils/supabase.js'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  const supabase = adminSupabase()

  // ── GET: list the user's saved records ──────────────────────
  if (event.httpMethod === 'GET') {
    const { data, error: dbErr } = await supabase
      .from('skip_trace_records')
      .select('*, skip_trace_orders(id, status, tracerfy_order_id, cost_usd)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (dbErr) return err(dbErr.message, 500)
    return ok({ records: data || [] })
  }

  // ── POST: save one or more records ──────────────────────────
  if (event.httpMethod === 'POST') {
    let body
    try { body = JSON.parse(event.body || '{}') } catch { return err('Invalid body', 400) }
    const { records } = body
    if (!Array.isArray(records) || records.length === 0) return err('records array required', 400)
    if (records.length > 500) return err('Maximum 500 records per save', 400)

    const rows = records.map(r => ({
      user_id:         user.id,
      source_point_id: isValidUUID(r.source_point_id) ? r.source_point_id : null,
      project_id:      isValidUUID(r.project_id)      ? r.project_id      : null,
      address:         (r.address  || '').slice(0, 500),
      city:            r.city       ? String(r.city).slice(0, 100)       : null,
      state_code:      r.state_code ? String(r.state_code).slice(0, 10)  : null,
      zip:             r.zip        ? String(r.zip).slice(0, 20)         : null,
      first_name:      r.first_name ? String(r.first_name).slice(0, 100) : null,
      last_name:       r.last_name  ? String(r.last_name).slice(0, 100)  : null,
    }))

    const { data, error: dbErr } = await supabase
      .from('skip_trace_records')
      .insert(rows)
      .select()
    if (dbErr) return err(dbErr.message, 500)
    return ok({ records: data || [], count: data?.length || 0 })
  }

  // ── DELETE: remove a single record (must be 'saved' status) ─
  if (event.httpMethod === 'DELETE') {
    const id = new URL(event.rawUrl, 'http://localhost').searchParams.get('id')
    if (!isValidUUID(id)) return err('Valid record id required', 400)

    const { error: dbErr } = await supabase
      .from('skip_trace_records')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('status', 'saved')
    if (dbErr) return err(dbErr.message, 500)
    return ok({ deleted: true })
  }

  return err('Method not allowed', 405)
}
