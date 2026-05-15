import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../utils/supabase.js', () => ({
  requireAuth:   vi.fn().mockResolvedValue({ user: { id: 'user-1' }, error: null }),
  adminSupabase: vi.fn(),
  ok:      (body)          => ({ statusCode: 200, body: JSON.stringify(body) }),
  err:     (msg, code=400) => ({ statusCode: code, body: JSON.stringify({ error: msg }) }),
  options: () => ({ statusCode: 204 }),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import * as supabaseUtils from '../utils/supabase.js'
import { handler } from '../generate-points.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

// ~1km² square in Phoenix
const VALID_GEOJSON = {
  type: 'Polygon',
  coordinates: [[
    [-112.080, 33.450], [-112.071, 33.450],
    [-112.071, 33.459], [-112.080, 33.459],
    [-112.080, 33.450],
  ]],
}

// Overpass OSM response with one simple road segment
function makeOsmResponse() {
  return {
    ok: true,
    json: async () => ({
      elements: [
        { type: 'node', id: 1, lat: 33.453, lon: -112.077 },
        { type: 'node', id: 2, lat: 33.453, lon: -112.073 },
        { type: 'way',  id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
      ],
    }),
  }
}

function makeSupabase({ projectExists = true, insertError = null } = {}) {
  return {
    from: vi.fn((table) => {
      if (table === 'projects') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue(
                  projectExists ? { data: { id: 'proj-1', user_id: 'user-1' } } : { data: null }
                ),
              })),
            })),
          })),
        }
      }
      if (table === 'scan_points') {
        return {
          delete: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({}) })) })),
          insert: vi.fn().mockResolvedValue({ error: insertError }),
        }
      }
      if (table === 'projects') {
        return { update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({}) })) }
      }
      return { update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({}) })) }
    }),
  }
}

function makeEvent(body, projectId = 'proj-1') {
  return {
    httpMethod: 'POST',
    rawUrl: `http://localhost/.netlify/functions/generate-points?projectId=${projectId}`,
    path: `/generate-points?projectId=${projectId}`,
    body: JSON.stringify(body),
    headers: { authorization: 'Bearer tok' },
  }
}

function parseBody(res) { return JSON.parse(res.body) }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generate-points handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseUtils.adminSupabase.mockReturnValue(makeSupabase())
  })

  it('returns 405 for non-POST requests', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {}, rawUrl: 'http://x?projectId=p', path: '?projectId=p' })
    expect(res.statusCode).toBe(405)
  })

  it('returns 400 when projectId query param is missing', async () => {
    const res = await handler({
      httpMethod: 'POST',
      rawUrl: 'http://localhost/.netlify/functions/generate-points',
      path: '/generate-points',
      body: JSON.stringify({ geojson: VALID_GEOJSON }),
      headers: { authorization: 'Bearer tok' },
    })
    expect(res.statusCode).toBe(400)
    expect(parseBody(res).error).toMatch(/projectId/)
  })

  it('returns 400 when geojson body is missing', async () => {
    const res = await handler(makeEvent({}))
    expect(res.statusCode).toBe(400)
    expect(parseBody(res).error).toMatch(/geojson/)
  })

  it('returns 404 when project is not found or not owned', async () => {
    supabaseUtils.adminSupabase.mockReturnValue(makeSupabase({ projectExists: false }))
    const res = await handler(makeEvent({ geojson: VALID_GEOJSON }))
    expect(res.statusCode).toBe(404)
  })

  it('uses road-based generation when OSM returns roads', async () => {
    fetchMock.mockResolvedValue(makeOsmResponse())
    const res = await handler(makeEvent({ geojson: VALID_GEOJSON, spacingMeters: 40 }))
    expect(res.statusCode).toBe(200)
    const body = parseBody(res)
    expect(body.method).toBe('road')
    expect(body.pointsGenerated).toBeGreaterThan(0)
  })

  it('falls back to grid when OSM returns no roads', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [] }),   // no nodes or ways
    })
    const res = await handler(makeEvent({ geojson: VALID_GEOJSON, spacingMeters: 100 }))
    expect(res.statusCode).toBe(200)
    const body = parseBody(res)
    expect(body.method).toBe('grid')
    expect(body.pointsGenerated).toBeGreaterThan(0)
  })

  it('falls back to grid when OSM fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'))
    const res = await handler(makeEvent({ geojson: VALID_GEOJSON, spacingMeters: 100 }))
    expect(res.statusCode).toBe(200)
    expect(parseBody(res).method).toBe('grid')
  })

  it('clamps spacingMeters below 20 to 20', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ elements: [] }) })
    // Very small spacing would produce too many points unless clamped
    const res = await handler(makeEvent({ geojson: VALID_GEOJSON, spacingMeters: 5 }))
    expect(res.statusCode).toBe(200)
  })

  it('clamps spacingMeters above 500 to 500', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ elements: [] }) })
    const res = await handler(makeEvent({ geojson: VALID_GEOJSON, spacingMeters: 9999 }))
    expect(res.statusCode).toBe(200)
  })

  it('returns 400 when point count exceeds 10 000 limit', async () => {
    // Use an unrealistically tiny spacing to force huge count — but since we clamp
    // spacing at 20 m, use a very large polygon instead. We simulate by mocking
    // the OSM empty response (forces grid) and a deliberately large polygon.
    const bigPolygon = {
      type: 'Polygon',
      coordinates: [[
        [-113.0, 32.0], [-110.0, 32.0],
        [-110.0, 35.0], [-113.0, 35.0],
        [-113.0, 32.0],
      ]],
    }
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ elements: [] }) })
    const res = await handler(makeEvent({ geojson: bigPolygon, spacingMeters: 20 }, 'proj-1'))
    expect(res.statusCode).toBe(400)
    expect(parseBody(res).error).toMatch(/Too many points/)
  })

  it('returns correct pointsGenerated count in response', async () => {
    fetchMock.mockResolvedValue(makeOsmResponse())
    const res  = await handler(makeEvent({ geojson: VALID_GEOJSON }))
    const body = parseBody(res)
    expect(typeof body.pointsGenerated).toBe('number')
    expect(body.pointsGenerated).toBeGreaterThan(0)
  })
})
