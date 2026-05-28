import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

function maskKey(key) {
  if (!key || key.length < 12) return '••••••••'
  return `${key.slice(0, 8)}••••${key.slice(-4)}`
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  const supabase = adminSupabase()

  // ── GET: check if key is configured (never returns the actual key) ──────────
  if (event.httpMethod === 'GET') {
    const { data } = await supabase
      .from('user_keys')
      .select('google_maps_key, updated_at')
      .eq('user_id', user.id)
      .maybeSingle()

    return ok({
      configured: !!(data?.google_maps_key),
      maskedKey:  data?.google_maps_key ? maskKey(data.google_maps_key) : null,
      updatedAt:  data?.updated_at ?? null,
    })
  }

  // ── POST: save or update key ─────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    const { googleMapsKey } = JSON.parse(event.body || '{}')
    if (!googleMapsKey?.trim()) return err('googleMapsKey required')

    const key = googleMapsKey.trim()
    if (!key.startsWith('AIza')) return err('Invalid Google Maps API key — should start with AIza')

    const { error: dbErr } = await supabase
      .from('user_keys')
      .upsert({ user_id: user.id, google_maps_key: key, updated_at: new Date().toISOString() },
               { onConflict: 'user_id' })
    if (dbErr) return err(dbErr.message)

    return ok({ configured: true, maskedKey: maskKey(key) })
  }

  // ── DELETE: remove key (fall back to platform key) ──────────────────────────
  if (event.httpMethod === 'DELETE') {
    await supabase.from('user_keys').delete().eq('user_id', user.id)
    return ok({ configured: false })
  }

  return err('Method not allowed', 405)
}
