import { createClient } from '@supabase/supabase-js'

export function adminSupabase() {
  return createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function getUserFromToken(token) {
  const client = adminSupabase()
  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user) return null
  return user
}

export async function requireAuth(event) {
  const token = event.headers.authorization?.replace('Bearer ', '') ||
                event.headers.Authorization?.replace('Bearer ', '')
  if (!token) return { user: null, error: 'Unauthorized' }
  const user = await getUserFromToken(token)
  if (!user) return { user: null, error: 'Invalid token' }
  return { user, error: null }
}

export async function requireAdmin(event) {
  const { user, error } = await requireAuth(event)
  if (error) return { user: null, error }
  const supabase = adminSupabase()
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return { user: null, error: 'Forbidden' }
  return { user, error: null }
}

export const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

export function ok(body)              { return { statusCode: 200, headers: CORS, body: JSON.stringify(body) } }
export function err(msg, code = 400)  { return { statusCode: code, headers: CORS, body: JSON.stringify({ error: msg }) } }
export function options()             { return { statusCode: 204, headers: CORS } }
