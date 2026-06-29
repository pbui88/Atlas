import { requireAdmin, adminSupabase, ok, err, options, isValidUUID, getPathParam, fetchAllRows } from './utils/supabase.js'
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

    // Compute each user's current cycle start date (cycles are 30 days).
    const userCycleStarts = Object.fromEntries(
      (profiles || []).map(p => {
        const anchor = new Date(p.cycle_anchor_date ?? p.created_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10))
        anchor.setUTCHours(0, 0, 0, 0)
        const elapsed    = Math.floor((Date.now() - anchor.getTime()) / (30 * 24 * 60 * 60 * 1000))
        const cycleStart = new Date(anchor)
        cycleStart.setUTCDate(cycleStart.getUTCDate() + elapsed * 30)
        return [p.id, cycleStart]
      })
    )

    // Single batch query for all usage in the last 30 days, then filter
    // per user to their specific cycle window client-side. Replaces N
    // parallel queries that could exhaust Supabase connection pools.
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const recentLogs = await fetchAllRows((from, to) =>
      supabase.from('usage_logs')
        .select('user_id, count, created_at')
        .in('service', ['street_view', 'streetlevel_gsv', 'mapillary'])
        .gte('created_at', since30.toISOString())
        .range(from, to)
    )

    const usageByUser = {}
    for (const log of recentLogs) {
      const cycleStart = userCycleStarts[log.user_id]
      if (cycleStart && new Date(log.created_at) >= cycleStart) {
        usageByUser[log.user_id] = (usageByUser[log.user_id] || 0) + (log.count || 0)
      }
    }

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

    const [[logs, nonAdminProfiles], { count: totalProjects }] = await Promise.all([
      Promise.all([
        fetchAllRows((from, to) =>
          supabase.from('usage_logs').select('service, count, cost_usd, user_id').gte('created_at', since).range(from, to)
        ),
        supabase.from('profiles').select('id').neq('role', 'admin').eq('is_active', true).then(r => r.data || []),
      ]),
      supabase.from('projects').select('*', { count: 'exact', head: true }),
    ])

    const aggregated   = {}
    const byUserSvcMap = {}

    // Seed every active non-admin user with zero usage so they always appear
    const byUserMap = Object.fromEntries(
      nonAdminProfiles.map(p => [p.id, { userId: p.id, total_count: 0, total_cost: 0 }])
    )

    for (const row of logs) {
      if (!aggregated[row.service]) aggregated[row.service] = { service: row.service, total_count: 0, total_cost: 0 }
      aggregated[row.service].total_count += row.count || 0
      aggregated[row.service].total_cost  += row.cost_usd || 0

      if (!byUserMap[row.user_id]) byUserMap[row.user_id] = { userId: row.user_id, total_count: 0, total_cost: 0 }
      byUserMap[row.user_id].total_count += row.count || 0
      byUserMap[row.user_id].total_cost  += row.cost_usd || 0

      const svcKey = `${row.user_id}:${row.service}`
      if (!byUserSvcMap[svcKey]) byUserSvcMap[svcKey] = { userId: row.user_id, service: row.service, total_count: 0, total_cost: 0 }
      byUserSvcMap[svcKey].total_count += row.count || 0
      byUserSvcMap[svcKey].total_cost  += row.cost_usd || 0
    }

    const totalCalls30d = Object.values(aggregated).reduce((s, r) => s + r.total_count, 0)

    const byUser = Object.values(byUserMap)
      .sort((a, b) => b.total_cost - a.total_cost)
      .map(u => ({
        ...u,
        services: Object.values(byUserSvcMap)
          .filter(s => s.userId === u.userId)
          .sort((a, b) => b.total_count - a.total_count),
      }))

    return ok({
      totalProjects,
      totalCalls30d,
      byService: Object.values(aggregated),
      byUser,
    })
  }

  // ── GET skip-trace-stats: platform liability metrics ─────────────────────
  if (event.httpMethod === 'GET' && action === 'skip-trace-stats') {
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const [balancesRes, pendingRes, spent30dRes, spentAllRes] = await Promise.all([
      supabase.from('profiles').select('skip_trace_balance').neq('role', 'admin'),
      supabase.from('skip_trace_orders').select('id, cost_usd').eq('status', 'processing'),
      supabase.rpc('get_skip_trace_spend_since', { p_since: since30 }),
      supabase.rpc('get_skip_trace_total_spend'),
    ])

    if (balancesRes.error) console.error('[skip-trace-stats] balances:', balancesRes.error.message)
    if (pendingRes.error)  console.error('[skip-trace-stats] pending:',  pendingRes.error.message)
    if (spent30dRes.error) console.error('[skip-trace-stats] spent30d:', spent30dRes.error.message)
    if (spentAllRes.error) console.error('[skip-trace-stats] spentAll:', spentAllRes.error.message)

    const totalUserBalance = (balancesRes.data || []).reduce((s, r) => s + (Number(r.skip_trace_balance) || 0), 0)
    const pendingJobs      = pendingRes.data || []
    const pendingCost      = pendingJobs.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0)
    const spent30d         = Number(spent30dRes.data) || 0
    const spentAllTime     = Number(spentAllRes.data) || 0

    return ok({
      platform: {
        totalUserBalance:  Math.round(totalUserBalance * 100) / 100,
        pendingJobsCount:  pendingJobs.length,
        pendingJobsCost:   Math.round(pendingCost      * 100) / 100,
        totalSpent30d:     Math.round(spent30d         * 100) / 100,
        totalSpentAllTime: Math.round(spentAllTime     * 100) / 100,
      },
    })
  }

  // ── GET system monitor: API cost trends + Supabase storage/DB size ──
  if (event.httpMethod === 'GET' && action === 'monitor') {
    const DAY     = 24 * 60 * 60 * 1000
    const since30 = new Date(Date.now() - 30 * DAY)

    // Wrap each RPC individually so a single slow/failed query doesn't block the whole response.
    const safeRpc = (p) => p.then(r => r).catch(() => ({ data: null, error: null }))

    const [summaryRes, trendRes, dbSizeRes, tableSizesRes, storageRes] = await Promise.all([
      safeRpc(supabase.rpc('get_usage_summary',    { p_since: since30.toISOString() })),
      safeRpc(supabase.rpc('get_daily_cost_trend', { p_since: since30.toISOString() })),
      safeRpc(supabase.rpc('get_database_size')),
      safeRpc(supabase.rpc('get_table_sizes')),
      safeRpc(supabase.rpc('get_storage_usage')),
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

  // ── GET street-view quota: per-user own-key vs platform-key split ──
  if (event.httpMethod === 'GET' && action === 'street-view-quota') {
    const MARKUP_PER_POINT   = 0.014
    const API_COST_PER_POINT = 0.007

    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const FREE_TIER          = 10000
    const [profilesRes, adminProfilesRes, keyRowsRes, svLogs] = await Promise.all([
      supabase.from('profiles')
        .select('id, full_name, email, points_limit, cycle_anchor_date')
        .neq('role', 'admin')
        .eq('is_active', true),
      supabase.from('profiles')
        .select('id, full_name, email, cycle_anchor_date')
        .eq('role', 'admin'),
      supabase.from('user_keys').select('user_id').not('google_maps_key', 'is', null),
      fetchAllRows((from, to) =>
        supabase.from('usage_logs')
          .select('user_id, count, created_at')
          .in('service', ['street_view', 'streetlevel_gsv'])
          .gte('created_at', since30.toISOString())
          .range(from, to)
      ),
    ])

    const usersWithKey = new Set((keyRowsRes.data || []).map(r => r.user_id))

    // Compute each user's cycle start (same rolling-30-day logic as usage.js)
    const cycleStartOf = (anchorStr) => {
      const a = new Date(anchorStr)
      a.setUTCHours(0, 0, 0, 0)
      const elapsed = Math.floor((Date.now() - a.getTime()) / (30 * 24 * 60 * 60 * 1000))
      const s = new Date(a)
      s.setUTCDate(s.getUTCDate() + elapsed * 30)
      return s
    }

    const allProfiles = [...(profilesRes.data || []), ...(adminProfilesRes.data || [])]
    const cycleStarts = {}
    for (const p of allProfiles) {
      cycleStarts[p.id] = cycleStartOf(p.cycle_anchor_date ?? new Date().toISOString().slice(0, 10))
    }

    const cycleUsage = {}
    for (const log of svLogs) {
      const start = cycleStarts[log.user_id]
      if (start && new Date(log.created_at) >= start) {
        cycleUsage[log.user_id] = (cycleUsage[log.user_id] || 0) + (log.count || 0)
      }
    }

    // Non-admin users: own-key vs platform-key split
    const users = (profilesRes.data || []).map(p => {
      const hasOwnKey        = usersWithKey.has(p.id)
      const limit            = p.points_limit ?? FREE_TIER
      const used             = cycleUsage[p.id] || 0
      const ownKeyUsed       = hasOwnKey ? Math.min(used, limit) : 0
      const platformOverflow = hasOwnKey ? Math.max(0, used - limit) : used
      const markupRevenue    = Math.round(used * MARKUP_PER_POINT * 10000) / 10000
      return { userId: p.id, fullName: p.full_name, email: p.email, hasOwnKey, limit, used, ownKeyUsed, platformOverflow, markupRevenue }
    }).sort((a, b) => b.platformOverflow - a.platformOverflow || b.used - a.used)

    // Admin users: first 10k free, over 10k at $0.007
    const adminUsers = (adminProfilesRes.data || []).map(p => {
      const used          = cycleUsage[p.id] || 0
      const freePoints    = Math.min(used, FREE_TIER)
      const billable      = Math.max(0, used - FREE_TIER)
      const estimatedCost = Math.round(billable * API_COST_PER_POINT * 10000) / 10000
      return { userId: p.id, fullName: p.full_name, email: p.email, used, freePoints, billable, estimatedCost }
    }).sort((a, b) => b.used - a.used)

    const usersOverQuota        = users.filter(u => u.hasOwnKey && u.used > u.limit).length
    const totalPlatformOverflow = users.reduce((s, u) => s + u.platformOverflow, 0)
    const platformApiCost       = Math.round(totalPlatformOverflow * API_COST_PER_POINT * 10000) / 10000
    const totalMarkupRevenue    = Math.round(users.reduce((s, u) => s + u.markupRevenue, 0) * 10000) / 10000
    const adminTotalBillable    = adminUsers.reduce((s, u) => s + u.billable, 0)
    const adminTotalCost        = Math.round(adminTotalBillable * API_COST_PER_POINT * 10000) / 10000

    return ok({
      summary:      { usersOverQuota, totalPlatformOverflow, platformApiCost, totalMarkupRevenue },
      adminSummary: { totalBillable: adminTotalBillable, totalCost: adminTotalCost },
      users,
      adminUsers,
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
    const { userId, role, is_active, points_limit, cycle_anchor_date, googleMapsKey, grantCredits, setCredits, billing_state } = patchBody
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

    // Handle direct credit override — sets purchased_credits to an exact value to correct mistakes
    if (setCredits !== undefined) {
      const pts = parseInt(setCredits, 10)
      if (isNaN(pts) || pts < 0) return err('setCredits must be a non-negative integer')
      const { error: setErr } = await supabase.from('profiles').update({ purchased_credits: pts }).eq('id', userId)
      if (setErr) return err(setErr.message)
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
