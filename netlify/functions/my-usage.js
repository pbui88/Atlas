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
  // can_scan = "can this user scan"
  // Non-admin needs purchased/granted credits to scan (every image costs 1 credit).
  // Having a Google key is for billing routing only, not for access — a saved
  // key never unlocks scanning on its own.
  // usage.purchasedRemaining already accounts for both purchased AND granted
  // credits (see getUserUsage) — do not recompute it from purchasedCredits alone.
  const can_scan = (usage.purchasedRemaining ?? 0) > 0  // has credits to scan
                 || profile.data?.role === 'admin'      // admin is never blocked
  return ok({ ...usage, can_scan })
}
