import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  const supabase = adminSupabase()
  const projectId = new URL(event.rawUrl || `http://x${event.path}`, 'http://x').searchParams.get('id')

  // ── GET: list projects ───────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { data, error: dbErr } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (dbErr) return err(dbErr.message)
    return ok(data)
  }

  // ── POST: create project ─────────────────────────────────
  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}')
    const { name, description } = body
    if (!name?.trim()) return err('name is required')

    const { data, error: dbErr } = await supabase
      .from('projects')
      .insert({ user_id: user.id, name: name.trim(), description: description || null })
      .select()
      .single()
    if (dbErr) return err(dbErr.message)
    return ok(data)
  }

  // ── PATCH: update project ────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    if (!projectId) return err('id required')
    const body = JSON.parse(event.body || '{}')
    const allowed = ['name', 'description', 'status', 'point_spacing_meters', 'scan_area_geojson',
                     'total_points', 'completed_points', 'failed_points', 'completed_at']
    const updates = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)))
    updates.updated_at = new Date().toISOString()

    const { data, error: dbErr } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', projectId)
      .eq('user_id', user.id)
      .select()
      .single()
    if (dbErr) return err(dbErr.message)
    return ok(data)
  }

  // ── DELETE: delete project ───────────────────────────────
  if (event.httpMethod === 'DELETE') {
    if (!projectId) return err('id required')

    // Delete images from storage first
    const { data: points } = await supabase
      .from('scan_points')
      .select('id')
      .eq('project_id', projectId)

    if (points?.length) {
      const pointIds = points.map(p => p.id)
      const { data: imgs } = await supabase
        .from('images')
        .select('storage_path')
        .in('scan_point_id', pointIds)

      if (imgs?.length) {
        const paths = imgs.filter(i => i.storage_path).map(i => i.storage_path)
        if (paths.length) {
          await supabase.storage.from('street-view-images').remove(paths)
        }
      }
    }

    const { error: dbErr } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId)
      .eq('user_id', user.id)
    if (dbErr) return err(dbErr.message)
    return ok({ success: true })
  }

  return err('Method not allowed', 405)
}
