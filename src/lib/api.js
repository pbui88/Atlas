import { supabase } from './supabase'

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) return session.access_token
  // Session missing or expired — attempt silent refresh
  const { data } = await supabase.auth.refreshSession()
  return data?.session?.access_token ?? null
}

async function call(fn, method = 'GET', body = null) {
  const token = await getToken()
  const res = await fetch(`/.netlify/functions/${fn}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  })
  if (res.status === 401) {
    // Token gone or invalid — sign out and reload so user re-authenticates
    await supabase.auth.signOut()
    window.location.reload()
    throw new Error('Session expired. Please sign in again.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = new Error(data.error || `Request failed (${res.status})`)
    e.status = res.status
    throw e
  }
  return data
}

// ── Projects ────────────────────────────────────────────────
export const getProjects      = ()         => call('projects')
export const createProject    = (body)     => call('projects', 'POST', body)
export const updateProject    = (id, body) => call(`projects?id=${id}`, 'PATCH', body)
export const deleteProject    = (id)       => call(`projects?id=${id}`, 'DELETE')

// ── Point Generation ────────────────────────────────────────
export const generatePoints   = (projectId, body) =>
  call(`generate-points?projectId=${projectId}`, 'POST', body)

// ── Image Collection (batch of point IDs) ───────────────────
export const collectImages    = (projectId, pointIds) =>
  call('collect-images', 'POST', { projectId, pointIds })

// ── AI Analysis (batch of point IDs) ────────────────────────
export const analyzePoints    = (projectId, pointIds) =>
  call('analyze-points', 'POST', { projectId, pointIds })

// ── Reverse Geocoding ────────────────────────────────────────
export const geocodePoints    = (projectId, pointIds) =>
  call('geocode-points', 'POST', { projectId, pointIds })

// ── Export ──────────────────────────────────────────────────
export const exportProject    = (projectId, format, filters = {}) =>
  call('export-project', 'POST', { projectId, format, filters })

// ── Usage (current user) ─────────────────────────────────────
export const getMyUsage = () => call('my-usage')

// ── Credits / Authorize.net ───────────────────────────────────
export const createPayment          = (points) => call('create-payment', 'POST', { points })
export const createSkipTracePayment = (amount) => call('create-skip-trace-payment', 'POST', { amount })

// ── User Keys (BYOK) ─────────────────────────────────────────
export const getUserKeyStatus = ()    => call('user-keys')
export const saveUserKey      = (key) => call('user-keys', 'POST', { google_maps_key: key })
export const deleteUserKey    = ()    => call('user-keys', 'DELETE')

// ── Skip Trace ───────────────────────────────────────────────
export const getSkipTraceRecords   = ()          => call('skip-trace')
export const saveSkipTraceRecords  = (records, list_name) => call('skip-trace', 'POST', { records, list_name })
export const deleteSkipTraceRecord = (id)        => call(`skip-trace?id=${id}`, 'DELETE')
export const deleteSkipTraceGroup  = (listKey)   => call(`skip-trace?listName=${encodeURIComponent(listKey)}`, 'DELETE')
export const submitSkipTrace       = (recordIds, traceType = 'advanced') => call('submit-skip-trace', 'POST', { recordIds, traceType })
export const checkSkipTraceResults = ()          => call('check-skip-trace', 'POST')
export const submitDncScrub        = (recordIds) => call('scrub-dnc', 'POST', { recordIds })

// ── Admin ────────────────────────────────────────────────────
export const adminGetUsers       = ()                      => call('admin?action=users')
export const adminUpdateUser     = (userId, updates)       => call('admin', 'PATCH', { userId, ...updates })
export const adminGetUsage       = ()                      => call('admin?action=usage')
export const adminGetMonitor     = ()                      => call('admin?action=monitor')
export const adminDeleteUser     = (userId)                => call('admin', 'DELETE', { userId })
export const adminGetUserUsage   = (userId)                => call(`admin?action=user-usage&userId=${userId}`)
export const adminResetUserCycle = (userId)                => call('admin', 'PATCH', { userId, cycle_anchor_date: new Date().toISOString().slice(0, 10) })
export const adminSetUserKey     = (userId, key)           => call('admin', 'PATCH', { userId, googleMapsKey: key || null })
export const adminGrantCredits   = (userId, points)        => call('admin', 'PATCH', { userId, grantCredits: points })
