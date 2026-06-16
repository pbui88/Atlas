import { randomBytes } from 'crypto'
import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'
import { calculateTax } from '../../shared/taxRates.js'

const PACKAGES = {
   2500: { points:  2500, amount: '35.00',  label:  '2,500 Credits' },
   5000: { points:  5000, amount: '70.00',  label:  '5,000 Credits' },
  10000: { points: 10000, amount: '140.00', label: '10,000 Credits' },
  15000: { points: 15000, amount: '210.00', label: '15,000 Credits' },
  20000: { points: 20000, amount: '280.00', label: '20,000 Credits' },
}

const isProd     = process.env.AUTHORIZENET_ENVIRONMENT === 'production'
const API_URL    = isProd ? 'https://api.authorize.net/xml/v1/request.api'   : 'https://apitest.authorize.net/xml/v1/request.api'
const FORM_URL   = isProd ? 'https://accept.authorize.net/payment/payment'   : 'https://test.authorize.net/payment/payment'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { return err('Invalid request body', 400) }

  const pkg = PACKAGES[body.points]
  if (!pkg) return err('Invalid package', 400)

  const siteUrl = process.env.VITE_SITE_URL || 'http://localhost:3000'
  const refId   = randomBytes(10).toString('hex') // 20 chars — Authorize.net's refId max length

  const supabase = adminSupabase()
  const { data: profile } = await supabase.from('profiles').select('role, billing_state').eq('id', user.id).single()

  const subtotal = parseFloat(pkg.amount)
  let taxAmount  = 0
  let taxState   = null

  if (profile?.role !== 'admin' && profile?.billing_state) {
    taxState  = profile.billing_state
    taxAmount = calculateTax(subtotal, taxState)
  }

  const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100

  const { error: insertError } = await supabase
    .from('payment_transactions')
    .insert({
      ref_id:       refId,
      user_id:      user.id,
      points:       pkg.points,
      amount_usd:   totalAmount.toFixed(2),
      subtotal_usd: subtotal.toFixed(2),
      tax_usd:      taxAmount.toFixed(2),
      billing_state: taxState,
    })

  if (insertError) {
    console.error('Failed to record pending payment:', insertError.message)
    return err('Failed to start payment. Please try again.', 500)
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
        ...(taxAmount > 0 ? { tax: { amount: taxAmount.toFixed(2), name: 'Sales Tax', description: `${taxState} sales tax` } } : {}),
        order: { description: `Atlas ${pkg.label}` },
      },
      hostedPaymentSettings: {
        setting: [
          {
            settingName: 'hostedPaymentReturnOptions',
            settingValue: JSON.stringify({
              showReceipt: false,
              // Sandbox's Order Summary / receipt redirect fails if the return
              // URL has more than one query parameter — keep it to a single param.
              url: `${siteUrl}/credits?purchase=${pkg.points}`,
              urlText: 'Continue to Atlas',
              cancelUrl: `${siteUrl}/credits`,
              cancelUrlText: 'Cancel',
            }),
          },
          { settingName: 'hostedPaymentButtonOptions', settingValue: JSON.stringify({ text: 'Pay' }) },
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
    // Authorize.net's JSON API prefixes responses with a UTF-8 BOM
    let text = await res.text()
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
    const data = JSON.parse(text)

    if (data.messages?.resultCode !== 'Ok' || !data.token) {
      console.error('Authorize.net error:', JSON.stringify(data.messages))
      return err('Failed to create payment session. Please try again.', 500)
    }

    return ok({ token: data.token, formUrl: FORM_URL })
  } catch (e) {
    console.error('Authorize.net request failed:', e.message)
    return err('Failed to create payment session. Please try again.', 500)
  }
}
