import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../utils/supabase.js', () => ({
  requireAuth:   vi.fn().mockResolvedValue({ user: { id: 'user-1' }, error: null }),
  adminSupabase: vi.fn(),
  ok:      (body)          => ({ statusCode: 200, body: JSON.stringify(body) }),
  err:     (msg, code=400) => ({ statusCode: code, body: JSON.stringify({ error: msg }) }),
  options: () => ({ statusCode: 204 }),
}))

import * as supabaseUtils from '../utils/supabase.js'
import { handler } from '../projects.js'

function parseBody(res) { return JSON.parse(res.body) }

const FAKE_PROJECT = { id: 'proj-1', user_id: 'user-1', name: 'Test Project', status: 'draft' }

function makeEvent(method, body = null, id = null) {
  const url = id
    ? `http://localhost/.netlify/functions/projects?id=${id}`
    : `http://localhost/.netlify/functions/projects`
  return {
    httpMethod: method,
    rawUrl: url,
    path: id ? `/projects?id=${id}` : '/projects',
    body: body != null ? JSON.stringify(body) : null,
    headers: { authorization: 'Bearer tok' },
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /projects', () => {
  it('returns list of user projects', async () => {
    supabaseUtils.adminSupabase.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            order: vi.fn().mockResolvedValue({ data: [FAKE_PROJECT], error: null }),
          }),
        }),
      }),
    })
    const res = await handler(makeEvent('GET'))
    expect(res.statusCode).toBe(200)
    expect(parseBody(res)).toEqual([FAKE_PROJECT])
  })

  it('returns 401 when auth fails', async () => {
    supabaseUtils.requireAuth.mockResolvedValueOnce({ user: null, error: 'Unauthorized' })
    const res = await handler(makeEvent('GET'))
    expect(res.statusCode).toBe(401)
  })
})

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /projects', () => {
  it('creates a project and returns it', async () => {
    supabaseUtils.adminSupabase.mockReturnValue({
      from: () => ({
        insert: () => ({
          select: () => ({
            single: vi.fn().mockResolvedValue({ data: FAKE_PROJECT, error: null }),
          }),
        }),
      }),
    })
    const res = await handler(makeEvent('POST', { name: 'Test Project' }))
    expect(res.statusCode).toBe(200)
    expect(parseBody(res).name).toBe('Test Project')
  })

  it('returns 400 when name is missing', async () => {
    supabaseUtils.adminSupabase.mockReturnValue({ from: vi.fn() })
    const res = await handler(makeEvent('POST', { description: 'no name' }))
    expect(res.statusCode).toBe(400)
    expect(parseBody(res).error).toMatch(/name/)
  })

  it('returns 400 when name is whitespace only', async () => {
    supabaseUtils.adminSupabase.mockReturnValue({ from: vi.fn() })
    const res = await handler(makeEvent('POST', { name: '   ' }))
    expect(res.statusCode).toBe(400)
  })

  it('trims name before saving', async () => {
    let insertedName
    supabaseUtils.adminSupabase.mockReturnValue({
      from: () => ({
        insert: (rows) => {
          insertedName = rows.name
          return {
            select: () => ({
              single: vi.fn().mockResolvedValue({ data: { ...FAKE_PROJECT, name: rows.name }, error: null }),
            }),
          }
        },
      }),
    })
    await handler(makeEvent('POST', { name: '  Trimmed Name  ' }))
    expect(insertedName).toBe('Trimmed Name')
  })
})

// ── PATCH ─────────────────────────────────────────────────────────────────────

describe('PATCH /projects?id=:id', () => {
  it('returns 400 when id is missing', async () => {
    supabaseUtils.adminSupabase.mockReturnValue({ from: vi.fn() })
    const res = await handler(makeEvent('PATCH', { name: 'New Name' }, null))
    expect(res.statusCode).toBe(400)
    expect(parseBody(res).error).toMatch(/id/)
  })

  it('updates allowed fields and returns updated project', async () => {
    supabaseUtils.adminSupabase.mockReturnValue({
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                single: vi.fn().mockResolvedValue({ data: { ...FAKE_PROJECT, name: 'Updated' }, error: null }),
              }),
            }),
          }),
        }),
      }),
    })
    const res = await handler(makeEvent('PATCH', { name: 'Updated' }, 'proj-1'))
    expect(res.statusCode).toBe(200)
    expect(parseBody(res).name).toBe('Updated')
  })

  it('strips fields not in the allowed list', async () => {
    let updatedFields = {}
    supabaseUtils.adminSupabase.mockReturnValue({
      from: () => ({
        update: (fields) => {
          updatedFields = fields
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: vi.fn().mockResolvedValue({ data: FAKE_PROJECT, error: null }),
                }),
              }),
            }),
          }
        },
      }),
    })
    await handler(makeEvent('PATCH', { name: 'OK', role: 'admin', __proto__: 'bad' }, 'proj-1'))
    expect(updatedFields).not.toHaveProperty('role')
    expect(updatedFields).toHaveProperty('name', 'OK')
  })

  it('always sets updated_at in PATCH payload', async () => {
    let updatedFields = {}
    supabaseUtils.adminSupabase.mockReturnValue({
      from: () => ({
        update: (fields) => {
          updatedFields = fields
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: vi.fn().mockResolvedValue({ data: FAKE_PROJECT, error: null }),
                }),
              }),
            }),
          }
        },
      }),
    })
    await handler(makeEvent('PATCH', { name: 'Test' }, 'proj-1'))
    expect(updatedFields).toHaveProperty('updated_at')
    expect(typeof updatedFields.updated_at).toBe('string')
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /projects?id=:id', () => {
  it('returns 400 when id is missing', async () => {
    supabaseUtils.adminSupabase.mockReturnValue({ from: vi.fn() })
    const res = await handler(makeEvent('DELETE', null, null))
    expect(res.statusCode).toBe(400)
  })

  it('deletes project and returns success', async () => {
    const storage = { remove: vi.fn().mockResolvedValue({}) }
    supabaseUtils.adminSupabase.mockReturnValue({
      from: vi.fn((table) => {
        if (table === 'scan_points') {
          return {
            select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: [] }) })),
            delete: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })) })),
          }
        }
        if (table === 'images') {
          return { select: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: [] }) })) }
        }
        if (table === 'projects') {
          return {
            delete: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })) })),
          }
        }
      }),
      storage: { from: () => storage },
    })
    const res = await handler(makeEvent('DELETE', null, 'proj-1'))
    expect(res.statusCode).toBe(200)
    expect(parseBody(res).success).toBe(true)
  })

  it('removes storage images before deleting DB rows', async () => {
    const removeSpy = vi.fn().mockResolvedValue({})
    const fakeImages = [{ storage_path: 'proj-1/pt-1/F.jpg' }]

    supabaseUtils.adminSupabase.mockReturnValue({
      from: vi.fn((table) => {
        if (table === 'scan_points') {
          return {
            select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: [{ id: 'pt-1' }] }) })),
            delete: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({}) })) })),
          }
        }
        if (table === 'images') {
          return { select: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: fakeImages }) })) }
        }
        if (table === 'projects') {
          return {
            delete: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })) })),
          }
        }
      }),
      storage: { from: () => ({ remove: removeSpy }) },
    })

    await handler(makeEvent('DELETE', null, 'proj-1'))
    expect(removeSpy).toHaveBeenCalledWith(['proj-1/pt-1/F.jpg'])
  })
})

// ── OPTIONS ───────────────────────────────────────────────────────────────────

describe('OPTIONS /projects', () => {
  it('returns 204 for preflight', async () => {
    const res = await handler({ httpMethod: 'OPTIONS', headers: {} })
    expect(res.statusCode).toBe(204)
  })
})

// ── unknown method ────────────────────────────────────────────────────────────

describe('Unknown HTTP method', () => {
  it('returns 405', async () => {
    supabaseUtils.adminSupabase.mockReturnValue({ from: vi.fn() })
    const res = await handler(makeEvent('PUT', {}, 'proj-1'))
    expect(res.statusCode).toBe(405)
  })
})
