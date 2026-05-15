import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Shared fixtures ───────────────────────────────────────────────────────────

const COMPLETE_POINTS = [
  {
    id: 'pt-1', lat: 33.451, lng: -112.075, address: '123 Main St, Phoenix, AZ',
    status: 'complete',
    ai_analyses: [{ overall_score: 0.80, confidence: 0.9, signals: ['boarded_windows', 'tall_grass'], notes: 'Severely distressed' }],
  },
  {
    id: 'pt-2', lat: 33.452, lng: -112.074, address: '456 Oak Ave, Phoenix, AZ',
    status: 'complete',
    ai_analyses: [{ overall_score: 0.15, confidence: 0.95, signals: [], notes: 'Good condition' }],
  },
  {
    id: 'pt-3', lat: 33.453, lng: -112.073, address: '789 Elm Rd, Phoenix, AZ',
    status: 'complete',
    ai_analyses: [{ overall_score: 0.50, confidence: 0.85, signals: ['junk_in_yard'], notes: 'Moderate issues' }],
  },
]

// ── Mock supabase ─────────────────────────────────────────────────────────────

function mockSupabase(points = COMPLETE_POINTS, projectExists = true) {
  const single = vi.fn().mockResolvedValue(
    projectExists ? { data: { id: 'proj-1', name: 'Test Project' } } : { data: null }
  )

  const fromMock = vi.fn((table) => {
    if (table === 'projects') {
      return { select: () => ({ eq: () => ({ eq: () => ({ single }) }) }) }
    }
    if (table === 'scan_points') {
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ data: points, error: null }) }),
        }),
      }
    }
  })

  return { from: fromMock }
}

// ── Mock module dependencies ──────────────────────────────────────────────────

vi.mock('../utils/supabase.js', () => ({
  requireAuth:  vi.fn().mockResolvedValue({ user: { id: 'user-1' }, error: null }),
  adminSupabase: vi.fn(),
  ok:  (body)        => ({ statusCode: 200, body: JSON.stringify(body) }),
  err: (msg, code=400) => ({ statusCode: code, body: JSON.stringify({ error: msg }) }),
  options: () => ({ statusCode: 204 }),
}))

import * as supabaseUtils from '../utils/supabase.js'
import { handler } from '../export-project.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(body, method = 'POST') {
  return { httpMethod: method, body: JSON.stringify(body), headers: { authorization: 'Bearer tok' } }
}

function parseBody(res) { return JSON.parse(res.body) }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('export-project handler', () => {
  beforeEach(() => {
    supabaseUtils.adminSupabase.mockReturnValue(mockSupabase())
  })

  it('returns 405 for non-POST requests', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {} })
    expect(res.statusCode).toBe(405)
  })

  it('returns 400 when projectId is missing', async () => {
    const res = await handler(makeEvent({}))
    expect(res.statusCode).toBe(400)
    expect(parseBody(res).error).toMatch(/projectId/)
  })

  it('returns 404 when project not found or not owned by user', async () => {
    supabaseUtils.adminSupabase.mockReturnValue(mockSupabase([], false))
    const res = await handler(makeEvent({ projectId: 'bad-id', format: 'CSV' }))
    expect(res.statusCode).toBe(404)
  })

  // ── CSV format ─────────────────────────────────────────────────────────────

  describe('CSV export', () => {
    it('returns 200 with CSV content-type indicator', async () => {
      const res = await handler(makeEvent({ projectId: 'proj-1', format: 'CSV' }))
      expect(res.statusCode).toBe(200)
      const body = parseBody(res)
      expect(body.format).toBe('CSV')
    })

    it('CSV output includes a header row', async () => {
      const res  = await handler(makeEvent({ projectId: 'proj-1', format: 'CSV' }))
      const { data } = parseBody(res)
      const lines = data.split('\n')
      expect(lines[0]).toContain('id')
      expect(lines[0]).toContain('lat')
      expect(lines[0]).toContain('lng')
      expect(lines[0]).toContain('distress_score')
    })

    it('CSV has one data row per point', async () => {
      const res   = await handler(makeEvent({ projectId: 'proj-1', format: 'CSV' }))
      const lines = parseBody(res).data.split('\n')
      // header + 3 data rows
      expect(lines.length).toBe(4)
    })

    it('CSV rows contain point coordinates', async () => {
      const res  = await handler(makeEvent({ projectId: 'proj-1', format: 'CSV' }))
      const csv  = parseBody(res).data
      expect(csv).toContain('33.451')
      expect(csv).toContain('-112.075')
    })

    it('escapes double-quotes inside address fields', async () => {
      const tricky = [{
        id: 'pt-x', lat: 1, lng: 1, address: 'St. "James" Ave',
        status: 'complete',
        ai_analyses: [{ overall_score: 0.1, confidence: 0.9, signals: [], notes: '' }],
      }]
      supabaseUtils.adminSupabase.mockReturnValue(mockSupabase(tricky))
      const res = await handler(makeEvent({ projectId: 'proj-1', format: 'CSV' }))
      expect(parseBody(res).data).toContain('""James""')
    })
  })

  // ── JSON format ────────────────────────────────────────────────────────────

  describe('JSON export', () => {
    it('returns an array of objects', async () => {
      const res  = await handler(makeEvent({ projectId: 'proj-1', format: 'JSON' }))
      const body = parseBody(res)
      expect(body.format).toBe('JSON')
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.data.length).toBe(3)
    })

    it('each JSON object has expected fields', async () => {
      const res  = await handler(makeEvent({ projectId: 'proj-1', format: 'JSON' }))
      const item = parseBody(res).data[0]
      expect(item).toHaveProperty('id')
      expect(item).toHaveProperty('lat')
      expect(item).toHaveProperty('lng')
      expect(item).toHaveProperty('address')
      expect(item).toHaveProperty('distressScore')
      expect(item).toHaveProperty('signals')
      expect(item).toHaveProperty('notes')
    })

    it('distressScore is the raw 0–1 float', async () => {
      const res  = await handler(makeEvent({ projectId: 'proj-1', format: 'JSON' }))
      const item = parseBody(res).data.find(d => d.id === 'pt-1')
      expect(item.distressScore).toBe(0.80)
    })
  })

  // ── GeoJSON format ─────────────────────────────────────────────────────────

  describe('GeoJSON export (default)', () => {
    it('returns a valid FeatureCollection', async () => {
      const res  = await handler(makeEvent({ projectId: 'proj-1', format: 'GEOJSON' }))
      const body = parseBody(res)
      const fc   = body.data
      expect(fc.type).toBe('FeatureCollection')
      expect(Array.isArray(fc.features)).toBe(true)
    })

    it('each feature has Point geometry with [lng, lat] order', async () => {
      const res     = await handler(makeEvent({ projectId: 'proj-1', format: 'GEOJSON' }))
      const feature = parseBody(res).data.features[0]
      expect(feature.geometry.type).toBe('Point')
      // GeoJSON is [longitude, latitude]
      expect(feature.geometry.coordinates[0]).toBe(-112.075)
      expect(feature.geometry.coordinates[1]).toBe(33.451)
    })

    it('feature properties include distressScore and signals', async () => {
      const res   = await handler(makeEvent({ projectId: 'proj-1', format: 'GEOJSON' }))
      const props = parseBody(res).data.features[0].properties
      expect(props).toHaveProperty('distressScore')
      expect(props).toHaveProperty('signals')
      expect(Array.isArray(props.signals)).toBe(true)
    })

    it('defaults to GeoJSON when format is omitted', async () => {
      const res  = await handler(makeEvent({ projectId: 'proj-1' }))
      expect(parseBody(res).format).toBe('GEOJSON')
    })
  })

  // ── Filter: minScore ───────────────────────────────────────────────────────

  describe('minScore filter', () => {
    it('excludes points below minScore threshold', async () => {
      const res  = await handler(makeEvent({ projectId: 'proj-1', format: 'JSON', filters: { minScore: 0.5 } }))
      const body = parseBody(res)
      // Only pt-1 (0.80) and pt-3 (0.50) should pass
      expect(body.data.length).toBe(2)
      expect(body.data.every(d => d.distressScore >= 0.5)).toBe(true)
    })

    it('minScore 0 returns all points', async () => {
      const res  = await handler(makeEvent({ projectId: 'proj-1', format: 'JSON', filters: { minScore: 0 } }))
      expect(parseBody(res).data.length).toBe(3)
    })

    it('minScore 1 returns only perfect-score points', async () => {
      const res  = await handler(makeEvent({ projectId: 'proj-1', format: 'JSON', filters: { minScore: 1.0 } }))
      expect(parseBody(res).data.length).toBe(0)
    })
  })

  // ── Filter: signals ────────────────────────────────────────────────────────

  describe('signals filter', () => {
    it('returns only points matching at least one requested signal', async () => {
      const res  = await handler(makeEvent({ projectId: 'proj-1', format: 'JSON', filters: { signals: ['boarded_windows'] } }))
      const body = parseBody(res)
      // Only pt-1 has boarded_windows
      expect(body.data.length).toBe(1)
      expect(body.data[0].id).toBe('pt-1')
    })

    it('combines multiple signal filters with OR logic', async () => {
      const res  = await handler(makeEvent({ projectId: 'proj-1', format: 'JSON', filters: { signals: ['boarded_windows', 'junk_in_yard'] } }))
      // pt-1 (boarded_windows) and pt-3 (junk_in_yard)
      expect(parseBody(res).data.length).toBe(2)
    })

    it('empty signals array returns all points (no signal filter applied)', async () => {
      const res  = await handler(makeEvent({ projectId: 'proj-1', format: 'JSON', filters: { signals: [] } }))
      expect(parseBody(res).data.length).toBe(3)
    })
  })

  // ── count field ───────────────────────────────────────────────────────────

  it('returns accurate count matching actual filtered data length', async () => {
    const res  = await handler(makeEvent({ projectId: 'proj-1', format: 'JSON', filters: { minScore: 0.5 } }))
    const body = parseBody(res)
    expect(body.count).toBe(body.data.length)
  })
})
