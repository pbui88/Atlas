import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  const supabase = adminSupabase()

  // GET — check whether the user has a key saved (never return the key value)
  if (event.httpMethod === 'GET') {
    const { data } = await supabase
      .from('user_keys')
      .select('updated_at')
      .eq('user_id', user.id)
      .not('google_maps_key', 'is', null)
      .maybeSingle()
    return ok({ has_key: !!data, updated_at: data?.updated_at ?? null })
  }

  // POST — save or update the key
  if (event.httpMethod === 'POST') {
    let body = {}
    try { body = JSON.parse(event.body || '{}') } catch { return err('Invalid request body', 400) }

    const key = (body.google_maps_key || '').trim()
    if (!key) return err('google_maps_key is required')
    if (key.length < 20) return err('Invalid API key format')

    const { error: upsertErr } = await supabase
      .from('user_keys')
      .upsert({ user_id: user.id, google_maps_key: key, updated_at: new Date().toISOString() })
    if (upsertErr) return err(upsertErr.message)

    return ok({ has_key: true })
  }

  // DELETE — remove the key
  if (event.httpMethod === 'DELETE') {
    await supabase.from('user_keys').delete().eq('user_id', user.id)
    return ok({ has_key: false })
  }

  return err('Method not allowed', 405)
}
