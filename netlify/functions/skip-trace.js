import { requireAuth, adminSupabase, ok, err, options, isValidUUID, getPathParam } from './utils/supabase.js'

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
    if (records.length > 2500) return err('Maximum 2500 records per save', 400)

    const { list_name } = body
    const listNameVal = list_name ? String(list_name).slice(0, 200) : null

    // Records without an address can't be skip-traced — drop them here so no
    // caller (UI or future integration) can create permanent "No address" rows.
    const skipped = records.length
    const rows = records
      .filter(r => (r.address || '').trim())
      .map(r => ({
        user_id:         user.id,
        source_point_id: isValidUUID(r.source_point_id) ? r.source_point_id : null,
        project_id:      isValidUUID(r.project_id)      ? r.project_id      : null,
        address:         (r.address  || '').slice(0, 500),
        city:            r.city       ? String(r.city).slice(0, 100)       : null,
        state_code:      r.state_code ? String(r.state_code).slice(0, 10)  : null,
        zip:             r.zip        ? String(r.zip).slice(0, 20)         : null,
        first_name:      r.first_name ? String(r.first_name).slice(0, 100) : null,
        last_name:       r.last_name  ? String(r.last_name).slice(0, 100)  : null,
        list_name:       listNameVal,
      }))
    if (!rows.length) return err('No records with a valid address', 400)

    const { data, error: dbErr } = await supabase
      .from('skip_trace_records')
      .insert(rows)
      .select()
    if (dbErr) return err(dbErr.message, 500)
    return ok({ records: data || [], count: data?.length || 0, skipped: skipped - rows.length })
  }

  // ── DELETE: single record or entire group ────────────────────
  if (event.httpMethod === 'DELETE') {
    const pathParam = getPathParam(event, 'skip-trace')
    const isGroup   = pathParam?.startsWith('list/')
    let listName = null
    if (isGroup) {
      try { listName = decodeURIComponent(pathParam.slice(5)) }
      catch { return err('Invalid list name encoding', 400) }
    }
    const id = isGroup ? null : pathParam

    // Group delete
    if (isGroup) {
      let q = supabase
        .from('skip_trace_records')
        .delete()
        .eq('user_id', user.id)
        .in('status', ['saved', 'completed'])

      q = listName === '__uncategorized__'
        ? q.is('list_name', null)
        : q.eq('list_name', listName)

      const { error: dbErr } = await q
      if (dbErr) return err(dbErr.message, 500)
      return ok({ deleted: true })
    }

    // Single record delete (saved or completed)
    if (!isValidUUID(id)) return err('Valid record id or listName required', 400)
    const { error: dbErr } = await supabase
      .from('skip_trace_records')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
      .in('status', ['saved', 'completed'])
    if (dbErr) return err(dbErr.message, 500)
    return ok({ deleted: true })
  }

  return err('Method not allowed', 405)
}
