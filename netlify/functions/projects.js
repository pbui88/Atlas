import { requireAuth, adminSupabase, ok, err, options, getPathParam, chunkArray } from './utils/supabase.js'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  const supabase = adminSupabase()
  const projectId = getPathParam(event, 'projects')

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
    // Fix 2 + 3: guard malformed body, validate name length
    let body = {}
    try { body = JSON.parse(event.body || '{}') } catch { return err('Invalid request body', 400) }
    const { name, description } = body
    const trimmedName = name?.trim()
    if (!trimmedName) return err('name is required')
    if (trimmedName.length > 255) return err('Name must be 255 characters or less')

    const { data, error: dbErr } = await supabase
      .from('projects')
      .insert({ user_id: user.id, name: trimmedName, description: description || null })
      .select()
      .single()
    if (dbErr) return err(dbErr.message)
    return ok(data)
  }

  // ── PATCH: update project ────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    if (!projectId) return err('id required')
    // Fix 2: guard malformed body
    let body = {}
    try { body = JSON.parse(event.body || '{}') } catch { return err('Invalid request body', 400) }
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

    // Delete images from storage first. Page through scan_points and images —
    // PostgREST caps a single request at 1000 rows, and large projects (or
    // points with several images each) can exceed that, leaving orphaned
    // files in storage after the project row is gone.
    const pointIds = []
    for (let from = 0; ; from += 1000) {
      const { data: points } = await supabase
        .from('scan_points')
        .select('id')
        .eq('project_id', projectId)
        .range(from, from + 999)
      if (!points?.length) break
      pointIds.push(...points.map(p => p.id))
      if (points.length < 1000) break
    }

    if (pointIds.length) {
      const paths = []
      // Chunk the .in() filter list to keep each request under Supabase's
      // request-line limit (a plain 500-UUID chunk can exceed it and fail
      // with a bare "Bad Request" — see chunkArray's default size), and page
      // each chunk's result in case it alone has 1000+ images.
      for (const chunk of chunkArray(pointIds)) {
        for (let from = 0; ; from += 1000) {
          const { data: imgs } = await supabase
            .from('images')
            .select('storage_path')
            .in('scan_point_id', chunk)
            .range(from, from + 999)
          if (!imgs?.length) break
          paths.push(...imgs.filter(i => i.storage_path).map(i => i.storage_path))
          if (imgs.length < 1000) break
        }
      }

      for (let i = 0; i < paths.length; i += 1000) {
        await supabase.storage.from('street-view-images').remove(paths.slice(i, i + 1000))
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
