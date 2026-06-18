// Computes the start of the user's current 30-day cycle from their anchor date.
function currentCycleStart(anchorDateStr) {
  const anchor = new Date(anchorDateStr)
  anchor.setUTCHours(0, 0, 0, 0)
  const elapsed = Math.floor((Date.now() - anchor.getTime()) / (30 * 24 * 60 * 60 * 1000))
  const start   = new Date(anchor)
  start.setUTCDate(start.getUTCDate() + elapsed * 30)
  return start
}

// Returns { used, limit, remaining, cycleStart, purchasedCredits, purchasedCreditsUsed, purchasedRemaining }.
// remaining = purchasedRemaining — purchased/granted credits are the access gate for non-admin users.
// The monthly limit (10k) only controls which Google API key is used for billing, not access.
export async function getUserUsage(userId, supabase) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('points_limit, purchased_credits, purchased_credits_used, cycle_anchor_date, skip_trace_balance')
    .eq('id', userId)
    .maybeSingle()

  const monthlyLimit          = profile?.points_limit           ?? 10000
  const purchasedCredits      = profile?.purchased_credits      ?? 0
  const purchasedCreditsUsed  = profile?.purchased_credits_used ?? 0
  const skipTraceBalance      = parseFloat(profile?.skip_trace_balance ?? 0)
  const anchor                = profile?.cycle_anchor_date      ?? new Date().toISOString().slice(0, 10)
  const cycleStart            = currentCycleStart(anchor)

  const { count } = await supabase
    .from('usage_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('service', ['street_view', 'mapillary'])
    .gte('created_at', cycleStart.toISOString())

  const cycleUsed          = count ?? 0
  const purchasedRemaining = Math.max(0, purchasedCredits - purchasedCreditsUsed)

  return {
    used:                 cycleUsed,
    limit:                monthlyLimit,
    remaining:            purchasedRemaining,
    cycleStart:           cycleStart.toISOString(),
    purchasedCredits,
    purchasedCreditsUsed,
    purchasedRemaining,
    skipTraceBalance,
  }
}
