import { describe, it, expect } from 'vitest'
import {
  generateGridPoints,
  estimateCost,
  scoreColor,
  scoreLabel,
  polygonBbox,
  chunkArray,
} from './geo.js'

// Small square polygon ~1 km × 1 km centred on Phoenix, AZ
const SQUARE = {
  type: 'Polygon',
  coordinates: [[
    [-112.080, 33.450],
    [-112.071, 33.450],
    [-112.071, 33.459],
    [-112.080, 33.459],
    [-112.080, 33.450],
  ]],
}

// Degenerate: too small to contain any grid points at 500 m spacing
const TINY = {
  type: 'Polygon',
  coordinates: [[
    [-112.0001, 33.4500],
    [-112.0000, 33.4500],
    [-112.0000, 33.4501],
    [-112.0001, 33.4501],
    [-112.0001, 33.4500],
  ]],
}

// ── generateGridPoints ───────────────────────────────────────────────────────

describe('generateGridPoints', () => {
  it('returns an array of {lat, lng} objects', () => {
    const pts = generateGridPoints(SQUARE, 100)
    expect(pts.length).toBeGreaterThan(0)
    for (const p of pts) {
      expect(p).toHaveProperty('lat')
      expect(p).toHaveProperty('lng')
      expect(typeof p.lat).toBe('number')
      expect(typeof p.lng).toBe('number')
    }
  })

  it('all returned points are inside the polygon bounds', () => {
    const pts = generateGridPoints(SQUARE, 100)
    for (const p of pts) {
      expect(p.lat).toBeGreaterThanOrEqual(33.450)
      expect(p.lat).toBeLessThanOrEqual(33.459)
      expect(p.lng).toBeGreaterThanOrEqual(-112.080)
      expect(p.lng).toBeLessThanOrEqual(-112.071)
    }
  })

  it('larger spacing produces fewer points', () => {
    const fine   = generateGridPoints(SQUARE, 50)
    const coarse = generateGridPoints(SQUARE, 200)
    expect(fine.length).toBeGreaterThan(coarse.length)
  })

  it('returns empty array for a polygon too small for the spacing', () => {
    const pts = generateGridPoints(TINY, 500)
    expect(pts).toEqual([])
  })

  it('returns empty array for invalid/null geojson without throwing', () => {
    expect(() => generateGridPoints(null, 50)).not.toThrow()
    expect(generateGridPoints(null, 50)).toEqual([])
  })
})

// ── estimateCost ─────────────────────────────────────────────────────────────

describe('estimateCost', () => {
  it('returns all four cost fields', () => {
    const c = estimateCost(100, 1)
    expect(c).toHaveProperty('streetView')
    expect(c).toHaveProperty('geocoding')
    expect(c).toHaveProperty('ai')
    expect(c).toHaveProperty('total')
  })

  it('total equals streetView + geocoding + ai', () => {
    const c = estimateCost(500, 2)
    expect(c.total).toBeCloseTo(c.streetView + c.geocoding + c.ai, 2)
  })

  it('zero points produces zero cost', () => {
    const c = estimateCost(0, 1)
    expect(c.streetView).toBe(0)
    expect(c.ai).toBe(0)
    expect(c.total).toBe(0)
  })

  it('more directions means higher Street View cost', () => {
    const one = estimateCost(100, 1)
    const two = estimateCost(100, 2)
    expect(two.streetView).toBeGreaterThan(one.streetView)
  })

  it('geocoding cost is always 0 (free provider)', () => {
    expect(estimateCost(1000, 4).geocoding).toBe(0)
  })

  it('all values are non-negative numbers', () => {
    const c = estimateCost(250, 2)
    expect(c.streetView).toBeGreaterThanOrEqual(0)
    expect(c.geocoding).toBeGreaterThanOrEqual(0)
    expect(c.ai).toBeGreaterThanOrEqual(0)
    expect(c.total).toBeGreaterThanOrEqual(0)
  })
})

// ── scoreColor ───────────────────────────────────────────────────────────────

describe('scoreColor', () => {
  it('returns grey for null score', () => {
    expect(scoreColor(null)).toBe('#64748b')
    expect(scoreColor(undefined)).toBe('#64748b')
  })

  it('returns green for low distress (< 0.20)', () => {
    expect(scoreColor(0)).toBe('#22c55e')
    expect(scoreColor(0.19)).toBe('#22c55e')
  })

  it('returns yellow for moderate distress (0.20–0.44)', () => {
    expect(scoreColor(0.20)).toBe('#eab308')
    expect(scoreColor(0.44)).toBe('#eab308')
  })

  it('returns orange for high distress (0.45–0.69)', () => {
    expect(scoreColor(0.45)).toBe('#f97316')
    expect(scoreColor(0.69)).toBe('#f97316')
  })

  it('returns red for severe distress (≥ 0.70)', () => {
    expect(scoreColor(0.70)).toBe('#ef4444')
    expect(scoreColor(1.0)).toBe('#ef4444')
  })

  it('handles boundary values exactly', () => {
    expect(scoreColor(0.20)).toBe('#eab308')
    expect(scoreColor(0.45)).toBe('#f97316')
    expect(scoreColor(0.70)).toBe('#ef4444')
  })
})

// ── scoreLabel ───────────────────────────────────────────────────────────────

describe('scoreLabel', () => {
  it('returns -- for null or undefined', () => {
    expect(scoreLabel(null)).toBe('--')
    expect(scoreLabel(undefined)).toBe('--')
  })

  it('converts 0–1 float to 0–100 integer', () => {
    expect(scoreLabel(0)).toBe(0)
    expect(scoreLabel(1)).toBe(100)
    expect(scoreLabel(0.5)).toBe(50)
  })

  it('rounds to nearest integer', () => {
    expect(scoreLabel(0.756)).toBe(76)
    expect(scoreLabel(0.754)).toBe(75)
    expect(scoreLabel(0.005)).toBe(1)
  })

  it('handles 0.0 correctly (not null-falsy confusion)', () => {
    expect(scoreLabel(0.0)).toBe(0)
  })
})

// ── polygonBbox ──────────────────────────────────────────────────────────────

describe('polygonBbox', () => {
  it('returns correct bounding box for a known polygon', () => {
    const bbox = polygonBbox(SQUARE)
    expect(bbox.minLat).toBeCloseTo(33.450, 3)
    expect(bbox.maxLat).toBeCloseTo(33.459, 3)
    expect(bbox.minLng).toBeCloseTo(-112.080, 3)
    expect(bbox.maxLng).toBeCloseTo(-112.071, 3)
  })

  it('returns all four bbox keys', () => {
    const bbox = polygonBbox(SQUARE)
    expect(bbox).toHaveProperty('minLat')
    expect(bbox).toHaveProperty('maxLat')
    expect(bbox).toHaveProperty('minLng')
    expect(bbox).toHaveProperty('maxLng')
  })
})

// ── chunkArray ───────────────────────────────────────────────────────────────

describe('chunkArray', () => {
  it('splits an array into chunks of size n', () => {
    const chunks = chunkArray([1, 2, 3, 4, 5, 6], 2)
    expect(chunks).toEqual([[1, 2], [3, 4], [5, 6]])
  })

  it('last chunk is smaller when length is not divisible', () => {
    const chunks = chunkArray([1, 2, 3, 4, 5], 2)
    expect(chunks).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns single chunk when array fits within n', () => {
    expect(chunkArray([1, 2, 3], 10)).toEqual([[1, 2, 3]])
  })

  it('returns empty array for empty input', () => {
    expect(chunkArray([], 5)).toEqual([])
  })

  it('chunk size of 1 produces one item per chunk', () => {
    expect(chunkArray([7, 8, 9], 1)).toEqual([[7], [8], [9]])
  })

  it('preserves element order', () => {
    const arr    = Array.from({ length: 10 }, (_, i) => i)
    const chunks = chunkArray(arr, 3)
    expect(chunks.flat()).toEqual(arr)
  })
})
