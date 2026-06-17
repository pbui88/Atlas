import { randomBytes } from 'crypto'
import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'
import { calculateTax } from '../../shared/taxRates.js'

const isProd   = process.env.AUTHORIZENET_ENVIRONMENT === 'production'
const API_URL  = isProd ? 'https://api.authorize.net/xml/v1/request.api'  : 'https://apitest.authorize.net/xml/v1/request.api'
const FORM_URL = isProd ? 'https://accept.authorize.net/payment/payment'  : 'https://test.authorize.net/payment/payment'

const MIN_DEPOSIT = 5
const MAX_DEPOSIT = 5000

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { return err('Invalid request body', 400) }

  const amount = parseFloat(body.amount)
  if (!isFinite(amount) || amount < MIN_DEPOSIT || amount > MAX_DEPOSIT) {
    return err(`Amount must be between $${MIN_DEPOSIT} and $${MAX_DEPOSIT}`, 400)
  }
  const subtotal = Math.round(amount * 100) / 100

  const siteUrl = process.env.VITE_SITE_URL || 'http://localhost:3000'
  const refId   = randomBytes(10).toString('hex')

  const supabase = adminSupabase()
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, billing_state')
    .eq('id', user.id)
    .single()

  let taxAmount = 0
  let taxState  = null
  if (profile?.role !== 'admin' && profile?.billing_state) {
    taxState  = profile.billing_state
    taxAmount = calculateTax(subtotal, taxState)
  }

  const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100

  const { error: insertError } = await supabase
    .from('payment_transactions')
    .insert({
      ref_id:        refId,
      user_id:       user.id,
      type:          'skip_trace',
      points:        0,
      amount_usd:    totalAmount.toFixed(2),
      subtotal_usd:  subtotal.toFixed(2),
      tax_usd:       taxAmount.toFixed(2),
      billing_state: taxState,
    })

  if (insertError) {
    console.error('Failed to record pending skip trace payment:', insertError.message)
    return err(`DB error: ${insertError.message}`, 500)
  }

  const payload = {
    getHostedPaymentPageRequest: {
      merchantAuthentication: {
        name:           process.env.AUTHORIZENET_API_LOGIN_ID,
        transactionKey: process.env.AUTHORIZENET_TRANSACTION_KEY,
      },
      refId,
      transactionRequest: {
        transactionType: 'authCaptureTransaction',
        amount: totalAmount.toFixed(2),
        order: { description: `Atlas Skip Trace Deposit — $${subtotal.toFixed(2)}` },
        ...(taxAmount > 0 ? { tax: { amount: taxAmount.toFixed(2), name: 'Sales Tax', description: `${taxState} state sales tax` } } : {}),
      },
      hostedPaymentSettings: {
        setting: [
          {
            settingName: 'hostedPaymentReturnOptions',
            settingValue: JSON.stringify({
              showReceipt: false,
              url: `${siteUrl}/credits?skip_trace_deposit=${subtotal.toFixed(2)}`,
              urlText: 'Continue to Atlas',
              cancelUrl: `${siteUrl}/credits`,
              cancelUrlText: 'Cancel',
            }),
          },
          { settingName: 'hostedPaymentOrderOptions',   settingValue: JSON.stringify({ show: true, merchantName: 'Atlas' }) },
          { settingName: 'hostedPaymentButtonOptions',  settingValue: JSON.stringify({ text: 'Pay' }) },
          { settingName: 'hostedPaymentPaymentOptions', settingValue: JSON.stringify({ cardCodeRequired: true, showCreditCard: true, showBankAccount: false }) },
          { settingName: 'hostedPaymentBillingAddressOptions', settingValue: JSON.stringify({ show: true, required: false }) },
        ],
      },
    },
  }

  try {
    const res  = await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    let text = await res.text()
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
    const data = JSON.parse(text)

    if (data.messages?.resultCode !== 'Ok' || !data.token) {
      const detail = data.messages?.message?.[0]?.text || JSON.stringify(data.messages)
      console.error('Authorize.net error:', detail)
      return err(`Payment gateway error: ${detail}`, 500)
    }

    return ok({ token: data.token, formUrl: FORM_URL })
  } catch (e) {
    console.error('Authorize.net request failed:', e.message)
    return err('Failed to create payment session. Please try again.', 500)
  }
}
