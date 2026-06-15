import { describe, it, expect } from 'vitest'
import { US_STATES, US_STATE_TAX_RATES, OUTSIDE_US, getTaxRate, calculateTax } from './taxRates.js'

describe('getTaxRate', () => {
  it('returns the state sales tax rate', () => {
    expect(getTaxRate('CA')).toBeCloseTo(0.0725)
    expect(getTaxRate('TX')).toBeCloseTo(0.0625)
  })

  it('returns 0 for states with no sales tax', () => {
    expect(getTaxRate('OR')).toBe(0)
    expect(getTaxRate('AK')).toBe(0)
  })

  it('returns 0 for OUTSIDE_US and unknown codes', () => {
    expect(getTaxRate(OUTSIDE_US)).toBe(0)
    expect(getTaxRate('XX')).toBe(0)
    expect(getTaxRate(undefined)).toBe(0)
  })
})

describe('calculateTax', () => {
  it('computes tax rounded to the nearest cent', () => {
    expect(calculateTax(35, 'CA')).toBe(2.54)   // 35 * 0.0725 = 2.5375 -> 2.54
    expect(calculateTax(140, 'TX')).toBe(8.75)  // 140 * 0.0625 = 8.75
  })

  it('returns 0 for tax-free states', () => {
    expect(calculateTax(280, 'OR')).toBe(0)
  })

  it('returns 0 for users billed outside the US', () => {
    expect(calculateTax(280, OUTSIDE_US)).toBe(0)
  })
})

describe('US_STATES', () => {
  it('includes an entry for every state with a tax rate plus OUTSIDE_US', () => {
    const codes = US_STATES.map(s => s.code)
    expect(codes).toContain(OUTSIDE_US)
    for (const code of Object.keys(US_STATE_TAX_RATES)) {
      expect(codes).toContain(code)
    }
  })
})
