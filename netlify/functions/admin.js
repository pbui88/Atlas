import { requireAdmin, adminSupabase, ok, err, options, isValidUUID, getPathParam } from './utils/supabase.js'
import { getUserUsage } from './utils/usage.js'

// Default monitoring thresholds (Supabase Pro tier) — overridable via env vars.
const DB_LIMIT_BYTES      = parseInt(process.env.SUPABASE_DB_LIMIT_BYTES, 10)      || 8   * 1024 ** 3
const STORAGE_LIMIT_BYTES = parseInt(process.env.SUPABASE_STORAGE_LIMIT_BYTES, 10) || 100 * 1024 ** 3
const MONTHLY_BUDGET_USD  = parseFloat(process.env.MONTHLY_API_BUDGET_USD) || 0

function fmtBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function pushUsageAlert(alerts, label, used, limit) {
  if (limit <= 0) return
  const pct = used / limit
  if (pct >= 0.9)      alerts.push({ level: 'critical', message: `${label} is ${(pct * 100).toFixed(0)}% full (${fmtBytes(used)} / ${fmtBytes(limit)})` })
  else if (pct >= 0.75) alerts.push({ level: 'warning', message: `${label} is ${(pct * 100).toFixed(0)}% full (${fmtBytes(used)} / ${fmtBytes(limit)})` })
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()

  const { user, error } = await requireAdmin(event)
  if (error) return err(error, error === 'Forbidden' ? 403 : 401)

  const supabase = adminSupabase()
  const pathParam    = getPathParam(event, 'admin') || ''
  const pathSegments = pathParam.split('/')
  const action       = pathSegments[0] || null
  const pathUserId   = pathSegments[1] || null

  // ── GET users (with current-cycle usage) ─────────────────────
  if (event.httpMethod === 'GET' && action === 'users') {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })

    // Parallel count queries — one per user using their specific cycle window.
    // Avoids PostgREST's default 1000-row cap that would truncate a single
    // bulk fetch of all usage_logs, causing every count to come back wrong.
    const usageCounts = await Promise.all(
      (profiles || []).map(async p => {
        const anchor = new Date(p.cycle_anchor_date ?? p.created_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10))
        anchor.setUTCHours(0, 0, 0, 0)
        const elapsed    = Math.floor((Date.now() - anchor.getTime()) / (30 * 24 * 60 * 60 * 1000))
        const cycleStart = new Date(anchor)
        cycleStart.setUTCDate(cycleStart.getUTCDate() + elapsed * 30)
        const { count } = await supabase
          .from('usage_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', p.id)
          .in('service', ['street_view', 'mapillary'])
          .gte('created_at', cycleStart.toISOString())
        return { id: p.id, count: count ?? 0 }
      })
    )
    const usageByUser = Object.fromEntries(usageCounts.map(r => [r.id, r.count]))

    // Fetch which users have their own Google Maps key configured
    const { data: keyRows } = await supabase
      .from('user_keys')
      .select('user_id')
      .not('google_maps_key', 'is', null)

    const usersWithKey = new Set((keyRows || []).map(r => r.user_id))

    const users = (profiles || []).map(p => ({
      ...p,
      points_limit:      p.points_limit      ?? 10000,
      cycle_anchor_date: p.cycle_anchor_date  ?? p.created_at?.slice(0, 10),
      points_used_cycle: usageByUser[p.id]   || 0,
      has_own_key:       usersWithKey.has(p.id),
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

  // ── GET system monitor: API cost trends + Supabase storage/DB size ──
  if (event.httpMethod === 'GET' && action === 'monitor') {
    const DAY     = 24 * 60 * 60 * 1000
    const since30 = new Date(Date.now() - 30 * DAY)

    const [summaryRes, trendRes, dbSizeRes, tableSizesRes, storageRes] = await Promise.all([
      supabase.rpc('get_usage_summary',    { p_since: since30.toISOString() }),
      supabase.rpc('get_daily_cost_trend', { p_since: since30.toISOString() }),
      supabase.rpc('get_database_size'),
      supabase.rpc('get_table_sizes'),
      supabase.rpc('get_storage_usage'),
    ])

    const byService = (summaryRes.data || []).map(r => ({
      service:    r.service,
      totalCount: Number(r.total_count) || 0,
      totalCost:  Number(r.total_cost)  || 0,
    }))
    const cost30d = byService.reduce((s, r) => s + r.totalCost, 0)

    // Roll the per-service daily trend into per-day totals + today/7d windows
    const todayKey  = new Date().toISOString().slice(0, 10)
    const since7Key = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10)
    const dailyMap  = {}
    let costToday = 0, cost7d = 0
    for (const row of trendRes.data || []) {
      const dayKey = String(row.day)
      const cost   = Number(row.total_cost) || 0
      dailyMap[dayKey] = (dailyMap[dayKey] || 0) + cost
      if (dayKey === todayKey) costToday += cost
      if (dayKey >= since7Key) cost7d    += cost
    }
    const dailyTrend = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, cost]) => ({ date, cost }))

    const dbBytes = Number(dbSizeRes.data) || 0
    const storageBuckets = (storageRes.data || []).map(r => ({
      name:      r.bucket_id,
      sizeBytes: Number(r.total_bytes) || 0,
      fileCount: Number(r.file_count)  || 0,
    }))
    const storageBytes = storageBuckets.reduce((s, r) => s + r.sizeBytes, 0)

    const alerts = []
    pushUsageAlert(alerts, 'Database', dbBytes, DB_LIMIT_BYTES)
    pushUsageAlert(alerts, 'Storage',  storageBytes, STORAGE_LIMIT_BYTES)
    if (MONTHLY_BUDGET_USD > 0) {
      const pct = cost30d / MONTHLY_BUDGET_USD
      if (pct >= 1)        alerts.push({ level: 'critical', message: `30-day API spend ($${cost30d.toFixed(2)}) has exceeded the $${MONTHLY_BUDGET_USD.toFixed(2)} budget` })
      else if (pct >= 0.9) alerts.push({ level: 'warning',  message: `30-day API spend ($${cost30d.toFixed(2)}) is at ${(pct * 100).toFixed(0)}% of the $${MONTHLY_BUDGET_USD.toFixed(2)} budget` })
    }

    return ok({
      costs: {
        today:         costToday,
        last7d:        cost7d,
        last30d:       cost30d,
        byService,
        dailyTrend,
        monthlyBudget: MONTHLY_BUDGET_USD || null,
      },
      database: {
        sizeBytes:  dbBytes,
        limitBytes: DB_LIMIT_BYTES,
        tables: (tableSizesRes.data || []).map(t => ({ name: t.table_name, sizeBytes: Number(t.size_bytes) || 0 })),
      },
      storage: {
        sizeBytes:  storageBytes,
        limitBytes: STORAGE_LIMIT_BYTES,
        buckets:    storageBuckets,
      },
      alerts,
    })
  }

  // ── GET per-user usage detail ─────────────────────────────────
  if (event.httpMethod === 'GET' && action === 'user-usage') {
    const userId = pathUserId
    if (!isValidUUID(userId)) return err('userId required')
    const usage = await getUserUsage(userId, supabase)
    return ok(usage)
  }

  // ── PATCH: update user role / status / limit / API key ──────────────────
  if (event.httpMethod === 'PATCH') {
    // Fix 2: guard against malformed request body
    let patchBody = {}
    try { patchBody = JSON.parse(event.body || '{}') } catch { return err('Invalid request body', 400) }
    const { userId, role, is_active, points_limit, cycle_anchor_date, googleMapsKey, grantCredits, billing_state } = patchBody
    if (!isValidUUID(userId)) return err('userId required')

    // Handle manual credit grant — increments purchased_credits via RPC
    if (grantCredits !== undefined) {
      const pts = parseInt(grantCredits, 10)
      if (isNaN(pts) || pts <= 0) return err('grantCredits must be a positive integer')
      const { error: rpcErr } = await supabase.rpc('increment_purchased_credits', { p_user_id: userId, p_points: pts })
      if (rpcErr) return err(rpcErr.message)
      const { data: updated } = await supabase.from('profiles').select('purchased_credits').eq('id', userId).maybeSingle()
      return ok({ purchased_credits: updated?.purchased_credits ?? 0 })
    }

    // Handle Google Maps key separately (stored in user_keys, not profiles)
    if (googleMapsKey !== undefined) {
      if (googleMapsKey) {
        const { error: keyErr } = await supabase
          .from('user_keys')
          .upsert({ user_id: userId, google_maps_key: googleMapsKey, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
        if (keyErr) return err(keyErr.message)
        return ok({ has_own_key: true })
      } else {
        await supabase.from('user_keys').delete().eq('user_id', userId)
        return ok({ has_own_key: false })
      }
    }

    const updates = {}
    // Fix 1: validate role value to prevent arbitrary strings being stored
    if (role !== undefined) {
      if (!['admin', 'user'].includes(role)) return err('Invalid role')
      updates.role = role
    }
    if (is_active          !== undefined) updates.is_active          = is_active
    if (points_limit       !== undefined) updates.points_limit       = Math.max(0, parseInt(points_limit, 10))
    if (cycle_anchor_date  !== undefined) updates.cycle_anchor_date  = cycle_anchor_date
    if (billing_state      !== undefined) updates.billing_state      = billing_state || null
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
    // Fix 2: guard against malformed request body
    let deleteBody = {}
    try { deleteBody = JSON.parse(event.body || '{}') } catch { return err('Invalid request body', 400) }
    const { userId } = deleteBody
    if (!isValidUUID(userId)) return err('userId required')
    if (userId === user.id) return err('Cannot delete yourself')

    const { error: delErr } = await supabase.auth.admin.deleteUser(userId)
    if (delErr) return err(delErr.message)
    return ok({ success: true })
  }

  return err('Method not allowed', 405)
}
