import { supabase } from './supabase'

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
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
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
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

// ── Admin ────────────────────────────────────────────────────
export const adminGetUsers    = ()                => call('admin?action=users')
export const adminUpdateUser  = (userId, updates) => call('admin', 'PATCH', { userId, ...updates })
export const adminGetUsage    = ()                => call('admin?action=usage')
export const adminDeleteUser  = (userId)          => call('admin', 'DELETE', { userId })
