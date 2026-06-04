import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'
import { getUserUsage } from './utils/usage.js'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'GET') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  const supabase = adminSupabase()
  const [usage, keyRow, profile] = await Promise.all([
    getUserUsage(user.id, supabase),
    supabase.from('user_keys').select('user_id').eq('user_id', user.id).not('google_maps_key', 'is', null).maybeSingle(),
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
  ])
  const purchasedRemaining = Math.max(0, (usage.purchasedCredits ?? 0) - (usage.purchasedCreditsUsed ?? 0))
  const has_own_key = !!keyRow.data                   // has own Google key (monthly quota)
                   || purchasedRemaining > 0           // has credits → platform key kicks in
                   || profile.data?.role === 'admin'   // admin always uses platform key
  return ok({ ...usage, has_own_key })
}
