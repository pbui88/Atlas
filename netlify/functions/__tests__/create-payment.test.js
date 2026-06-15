import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('AUTHORIZENET_API_LOGIN_ID', 'login-id')
vi.stubEnv('AUTHORIZENET_TRANSACTION_KEY', 'trans-key')
vi.stubEnv('AUTHORIZENET_ENVIRONMENT', 'sandbox')
vi.stubEnv('VITE_SITE_URL', 'http://localhost:3000')

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
import { handler } from '../create-payment.js'

function parseBody(res) { return JSON.parse(res.body) }

function makeEvent(points) {
  return { httpMethod: 'POST', body: JSON.stringify({ points }), headers: { authorization: 'Bearer tok' } }
}

function makeSupabase({ profile, insertError = null }) {
  const insert = vi.fn().mockResolvedValue({ error: insertError })
  const single = vi.fn().mockResolvedValue({ data: profile })
  return {
    from: vi.fn((table) => {
      if (table === 'profiles')           return { select: () => ({ eq: () => ({ single }) }) }
      if (table === 'payment_transactions') return { insert }
    }),
    _insert: insert,
  }
}

function mockAuthorizeNetSuccess() {
  fetchMock.mockResolvedValue({
    text: async () => String.fromCharCode(0xFEFF) + JSON.stringify({ messages: { resultCode: 'Ok' }, token: 'tok123' }),
  })
}

function sentTransactionRequest() {
  return JSON.parse(fetchMock.mock.calls[0][1].body).getHostedPaymentPageRequest.transactionRequest
}

describe('create-payment handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseUtils.requireAuth.mockResolvedValue({ user: { id: 'user-1' }, error: null })
  })

  it('charges no tax for admin users', async () => {
    const supabase = makeSupabase({ profile: { role: 'admin', state: null } })
    supabaseUtils.adminSupabase.mockReturnValue(supabase)
    mockAuthorizeNetSuccess()

    const res = await handler(makeEvent(2500))
    expect(res.statusCode).toBe(200)

    const insertedRow = supabase._insert.mock.calls[0][0]
    expect(insertedRow.subtotal_usd).toBe('35.00')
    expect(insertedRow.tax_usd).toBe('0.00')
    expect(insertedRow.amount_usd).toBe('35.00')
    expect(insertedRow.state).toBeNull()

    const txn = sentTransactionRequest()
    expect(txn.amount).toBe('35.00')
    expect(txn.tax).toBeUndefined()
  })

  it('adds state sales tax for non-admin users', async () => {
    const supabase = makeSupabase({ profile: { role: 'user', state: 'CA' } }) // 7.25%
    supabaseUtils.adminSupabase.mockReturnValue(supabase)
    mockAuthorizeNetSuccess()

    const res = await handler(makeEvent(2500)) // $35.00 subtotal
    expect(res.statusCode).toBe(200)

    const insertedRow = supabase._insert.mock.calls[0][0]
    expect(insertedRow.subtotal_usd).toBe('35.00')
    expect(insertedRow.tax_usd).toBe('2.54')   // 35 * 0.0725 = 2.5375 -> 2.54
    expect(insertedRow.amount_usd).toBe('37.54')
    expect(insertedRow.state).toBe('CA')

    const txn = sentTransactionRequest()
    expect(txn.amount).toBe('37.54')
    expect(txn.tax).toEqual({ amount: '2.54', name: 'Sales Tax', description: 'CA sales tax' })
  })

  it('rejects non-admin purchases when billing state is not set', async () => {
    const supabase = makeSupabase({ profile: { role: 'user', state: null } })
    supabaseUtils.adminSupabase.mockReturnValue(supabase)

    const res = await handler(makeEvent(2500))
    expect(res.statusCode).toBe(400)
    expect(parseBody(res).error).toMatch(/billing state/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('charges no tax for non-admin users in no-sales-tax states', async () => {
    const supabase = makeSupabase({ profile: { role: 'user', state: 'OR' } }) // 0%
    supabaseUtils.adminSupabase.mockReturnValue(supabase)
    mockAuthorizeNetSuccess()

    const res = await handler(makeEvent(2500))
    expect(res.statusCode).toBe(200)

    const insertedRow = supabase._insert.mock.calls[0][0]
    expect(insertedRow.tax_usd).toBe('0.00')
    expect(insertedRow.amount_usd).toBe('35.00')

    const txn = sentTransactionRequest()
    expect(txn.tax).toBeUndefined()
  })
})
