// Returns the 1st of the current UTC month — matches Google Street View API billing cycle.
function currentCycleStart() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

// Returns { used, limit, remaining, cycleStart, purchasedCredits, purchasedCreditsUsed, purchasedRemaining }.
// remaining = purchasedRemaining — purchased/granted credits are the access gate for non-admin users.
// The monthly limit (10k) only controls which Google API key is used for billing, not access.
export async function getUserUsage(userId, supabase) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('points_limit, purchased_credits, granted_credits, purchased_credits_used, cycle_anchor_date, skip_trace_balance')
    .eq('id', userId)
    .maybeSingle()

  const monthlyLimit          = profile?.points_limit           ?? 10000
  const purchasedCredits      = profile?.purchased_credits      ?? 0
  const grantedCredits        = profile?.granted_credits        ?? 0
  const purchasedCreditsUsed  = profile?.purchased_credits_used ?? 0
  const skipTraceBalance      = parseFloat(profile?.skip_trace_balance ?? 0)
  const cycleStart            = currentCycleStart()

  const { count } = await supabase
    .from('usage_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('service', ['street_view', 'mapillary'])
    .gte('created_at', cycleStart.toISOString())

  const cycleUsed          = count ?? 0
  const totalCredits       = purchasedCredits + grantedCredits
  const purchasedRemaining = Math.max(0, totalCredits - purchasedCreditsUsed)

  return {
    used:                 cycleUsed,
    limit:                monthlyLimit,
    remaining:            purchasedRemaining,
    cycleStart:           cycleStart.toISOString(),
    purchasedCredits,
    grantedCredits,
    totalCredits,
    purchasedCreditsUsed,
    purchasedRemaining,
    skipTraceBalance,
  }
}
