import { requireAdmin, adminSupabase, ok, err, options } from './utils/supabase.js'
import { getUserUsage } from './utils/usage.js'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()

  const { user, error } = await requireAdmin(event)
  if (error) return err(error, error === 'Forbidden' ? 403 : 401)

  const supabase = adminSupabase()
  const action   = new URL(event.rawUrl || `http://x${event.path}`, 'http://x').searchParams.get('action')

  // ── GET users (with current-cycle usage) ─────────────────────
  if (event.httpMethod === 'GET' && action === 'users') {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })

    // Sum completed_points from projects per user (last 30 days).
    // More reliable than usage_logs which may be sparse on older scans.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: projects } = await supabase
      .from('projects')
      .select('user_id, completed_points')
      .gte('created_at', since)

    const usageByUser = {}
    for (const proj of projects || []) {
      usageByUser[proj.user_id] = (usageByUser[proj.user_id] || 0) + (proj.completed_points || 0)
    }

    const users = (profiles || []).map(p => ({
      ...p,
      points_limit:      p.points_limit      ?? 10000,
      cycle_anchor_date: p.cycle_anchor_date  ?? p.created_at?.slice(0, 10),
      points_used_cycle: usageByUser[p.id]   || 0,
    }))

    return ok(users)
  }

  // ── GET usage summary ─────────────────────────────────────────
  if (event.httpMethod === 'GET' && action === 'usage') {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const { data: byService } = await supabase
      .from('usage_logs')
      .select('service, count, cost_usd')
      .gte('created_at', since)

    const { count: totalProjects } = await supabase
      .from('projects')
      .select('*', { count: 'exact', head: true })

    const aggregated = {}
    for (const row of byService || []) {
      if (!aggregated[row.service]) aggregated[row.service] = { service: row.service, total_count: 0, total_cost: 0 }
      aggregated[row.service].total_count += row.count || 0
      aggregated[row.service].total_cost  += row.cost_usd || 0
    }

    const totalCalls30d = Object.values(aggregated).reduce((s, r) => s + r.total_count, 0)

    return ok({
      totalProjects,
      totalCalls30d,
      byService: Object.values(aggregated),
    })
  }

  // ── GET per-user usage detail ─────────────────────────────────
  if (event.httpMethod === 'GET' && action === 'user-usage') {
    const userId = new URL(event.rawUrl || `http://x${event.path}`, 'http://x').searchParams.get('userId')
    if (!userId) return err('userId required')
    const usage = await getUserUsage(userId, supabase)
    return ok(usage)
  }

  // ── PATCH: update user role / status / limit ──────────────────
  if (event.httpMethod === 'PATCH') {
    const { userId, role, is_active, points_limit, cycle_anchor_date } = JSON.parse(event.body || '{}')
    if (!userId) return err('userId required')

    const updates = {}
    if (role               !== undefined) updates.role               = role
    if (is_active          !== undefined) updates.is_active          = is_active
    if (points_limit       !== undefined) updates.points_limit       = Math.max(0, parseInt(points_limit, 10))
    if (cycle_anchor_date  !== undefined) updates.cycle_anchor_date  = cycle_anchor_date
    if (!Object.keys(updates).length) return err('Nothing to update')

    const { data, error: dbErr } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single()
    if (dbErr) return err(dbErr.message)
    return ok(data)
  }

  // ── DELETE: delete user and all data ─────────────────────────
  if (event.httpMethod === 'DELETE') {
    const { userId } = JSON.parse(event.body || '{}')
    if (!userId) return err('userId required')
    if (userId === user.id) return err('Cannot delete yourself')

    const { error: delErr } = await supabase.auth.admin.deleteUser(userId)
    if (delErr) return err(delErr.message)
    return ok({ success: true })
  }

  return err('Method not allowed', 405)
}
