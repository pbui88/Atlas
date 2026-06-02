// Computes the start of the user's current 30-day cycle from their anchor date.
function currentCycleStart(anchorDateStr) {
  const anchor = new Date(anchorDateStr)
  anchor.setUTCHours(0, 0, 0, 0)
  const elapsed = Math.floor((Date.now() - anchor.getTime()) / (30 * 24 * 60 * 60 * 1000))
  const start   = new Date(anchor)
  start.setUTCDate(start.getUTCDate() + elapsed * 30)
  return start
}

// Returns { used, limit, remaining, cycleStart } for a given user.
// "used" counts every image_download or image_cache_hit in the current 30-day window.
export async function getUserUsage(userId, supabase) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('points_limit, purchased_credits, cycle_anchor_date')
    .eq('id', userId)
    .maybeSingle()

  const monthlyLimit      = profile?.points_limit      ?? 10000
  const purchasedCredits  = profile?.purchased_credits ?? 0
  const limit             = monthlyLimit + purchasedCredits
  const anchor            = profile?.cycle_anchor_date ?? new Date().toISOString().slice(0, 10)
  const cycleStart = currentCycleStart(anchor)

  const { count } = await supabase
    .from('usage_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('service', ['street_view', 'mapillary'])
    .gte('created_at', cycleStart.toISOString())

  const used = count ?? 0
  return {
    used,
    limit,
    remaining:        Math.max(0, limit - used),
    cycleStart:       cycleStart.toISOString(),
    purchasedCredits,
  }
}
