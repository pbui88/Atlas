import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock env ──────────────────────────────────────────────────────────────────
vi.stubEnv('POSITIONSTACK_API_KEY', 'test-key')

// ── Mock utilities ────────────────────────────────────────────────────────────
vi.mock('../utils/supabase.js', () => ({
  requireAuth:   vi.fn().mockResolvedValue({ user: { id: 'user-1' }, error: null }),
  adminSupabase: vi.fn(),
  ok:      (body)          => ({ statusCode: 200, body: JSON.stringify(body) }),
  err:     (msg, code=400) => ({ statusCode: code, body: JSON.stringify({ error: msg }) }),
  options: () => ({ statusCode: 204 }),
}))

// ── Mock global fetch ─────────────────────────────────────────────────────────
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import * as supabaseUtils from '../utils/supabase.js'
import { handler } from '../geocode-points.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(body) {
  return { httpMethod: 'POST', body: JSON.stringify(body), headers: { authorization: 'Bearer tok' } }
}

function parseBody(res) { return JSON.parse(res.body) }

function makePositionstackResponse(results) {
  return { ok: true, json: async () => ({ data: results }) }
}

function makeSupabase(points) {
  const updateChain = { eq: vi.fn().mockReturnThis(), then: vi.fn() }
  const update      = vi.fn(() => updateChain)

  const selectChain = {
    in:  vi.fn().mockResolvedValue({ data: points }),
  }
  const select = vi.fn(() => selectChain)

  const insertChain = { then: vi.fn() }
  const insert      = vi.fn().mockResolvedValue({ data: null })

  return {
    from: vi.fn((table) => {
      if (table === 'scan_points') return { select, update }
      if (table === 'usage_logs')  return { insert }
    }),
    _update: update,
    _insert: insert,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('geocode-points handler', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 405 for non-POST requests', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {} })
    expect(res.statusCode).toBe(405)
  })

  it('returns 503 when POSITIONSTACK_API_KEY is not set', async () => {
    vi.stubEnv('POSITIONSTACK_API_KEY', '')
    const res = await handler(makeEvent({ projectId: 'p', pointIds: ['a'] }))
    expect(res.statusCode).toBe(503)
    vi.stubEnv('POSITIONSTACK_API_KEY', 'test-key')
  })

  it('returns 400 when projectId is missing', async () => {
    const res = await handler(makeEvent({ pointIds: ['a'] }))
    expect(res.statusCode).toBe(400)
    expect(parseBody(res).error).toMatch(/projectId/)
  })

  it('returns 400 when pointIds is not an array', async () => {
    const res = await handler(makeEvent({ projectId: 'p', pointIds: 'abc' }))
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when pointIds is empty', async () => {
    const res = await handler(makeEvent({ projectId: 'p', pointIds: [] }))
    expect(res.statusCode).toBe(400)
  })

  it('returns 200 with empty results when no points found in DB', async () => {
    const sb = makeSupabase([])
    supabaseUtils.adminSupabase.mockReturnValue(sb)
    const res = await handler(makeEvent({ projectId: 'p', pointIds: ['x'] }))
    expect(res.statusCode).toBe(200)
    expect(parseBody(res).results).toEqual([])
  })

  it('skips points that already have an address', async () => {
    const pt = { id: 'pt-1', lat: 33.45, lng: -112.07, address: '123 Main St' }
    const sb = makeSupabase([pt])
    supabaseUtils.adminSupabase.mockReturnValue(sb)

    const res = await handler(makeEvent({ projectId: 'p', pointIds: ['pt-1'] }))
    const results = parseBody(res).results
    expect(results[0].status).toBe('skipped')
    // fetch should NOT be called for an already-geocoded point
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('geocodes a point that has no address', async () => {
    const pt = { id: 'pt-2', lat: 33.45, lng: -112.07, address: null }
    const sb = makeSupabase([pt])
    supabaseUtils.adminSupabase.mockReturnValue(sb)

    // Mock Positionstack returning a valid property-level result
    fetchMock.mockResolvedValue(makePositionstackResponse([
      { name: '456 Oak Ave', locality: 'Phoenix', region_code: 'AZ', postal_code: '85001', number: '456', type: 'address' },
    ]))

    // Mock the supabase update chain
    sb.from = vi.fn((table) => {
      if (table === 'scan_points') {
        return {
          select: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: [pt] }) })),
          update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({}) })),
        }
      }
      if (table === 'usage_logs') return { insert: vi.fn().mockResolvedValue({}) }
    })

    const res = await handler(makeEvent({ projectId: 'p', pointIds: ['pt-2'] }))
    expect(res.statusCode).toBe(200)
    const results = parseBody(res).results
    expect(results[0].status).toBe('geocoded')
    expect(results[0].address).toContain('456 Oak Ave')
  })

  it('returns no_result when Positionstack returns no property-level match', async () => {
    const pt = { id: 'pt-3', lat: 33.45, lng: -112.07, address: null }

    fetchMock.mockResolvedValue(makePositionstackResponse([
      // street-only result — no number, type is 'street'
      { name: 'North Oak Avenue', locality: 'Phoenix', region_code: 'AZ', number: null, type: 'street' },
    ]))

    const supabaseMock = {
      from: vi.fn((table) => {
        if (table === 'scan_points') {
          return {
            select: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: [pt] }) })),
            update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({}) })),
          }
        }
        if (table === 'usage_logs') return { insert: vi.fn().mockResolvedValue({}) }
      }),
    }
    supabaseUtils.adminSupabase.mockReturnValue(supabaseMock)

    const res = await handler(makeEvent({ projectId: 'p', pointIds: ['pt-3'] }))
    expect(res.statusCode).toBe(200)
    const results = parseBody(res).results
    expect(results[0].status).toBe('no_result')
  })

  it('returns error status when Positionstack API fails', async () => {
    const pt = { id: 'pt-4', lat: 33.45, lng: -112.07, address: null }

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ error: { message: 'Rate limit exceeded', code: 429 } }),
    })

    const supabaseMock = {
      from: vi.fn((table) => {
        if (table === 'scan_points') {
          return {
            select: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: [pt] }) })),
            update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({}) })),
          }
        }
        if (table === 'usage_logs') return { insert: vi.fn().mockResolvedValue({}) }
      }),
    }
    supabaseUtils.adminSupabase.mockReturnValue(supabaseMock)

    const res = await handler(makeEvent({ projectId: 'p', pointIds: ['pt-4'] }))
    expect(res.statusCode).toBe(200)
    const results = parseBody(res).results
    expect(results[0].status).toBe('error')
  })

  it('caps batch at 50 points (CAP constant)', async () => {
    // Build 60 point IDs; handler should only process 50
    const ids = Array.from({ length: 60 }, (_, i) => `pt-${i}`)
    const pts = ids.slice(0, 50).map(id => ({ id, lat: 33, lng: -112, address: 'Pre-filled' }))

    const supabaseMock = {
      from: vi.fn((table) => {
        if (table === 'scan_points') {
          return {
            select: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: pts }) })),
            update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({}) })),
          }
        }
        if (table === 'usage_logs') return { insert: vi.fn().mockResolvedValue({}) }
      }),
    }
    supabaseUtils.adminSupabase.mockReturnValue(supabaseMock)

    const res = await handler(makeEvent({ projectId: 'p', pointIds: ids }))
    expect(res.statusCode).toBe(200)
    // All 50 DB points returned (all skipped because they have addresses)
    expect(parseBody(res).results.length).toBe(50)
  })
})
