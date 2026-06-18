import { randomBytes } from 'crypto'
import { calculateTax } from '../../../shared/taxRates.js'

const isProd   = process.env.AUTHORIZENET_ENVIRONMENT === 'production'
export const API_URL  = isProd ? 'https://api.authorize.net/xml/v1/request.api'  : 'https://apitest.authorize.net/xml/v1/request.api'
export const FORM_URL = isProd ? 'https://accept.authorize.net/payment/payment'  : 'https://test.authorize.net/payment/payment'

// Build and fire an Authorize.net GetHostedPaymentPage request.
// insertData is merged into the payment_transactions row (e.g. { points, type }).
// Returns { token, formUrl }; throws on error.
export async function createHostedPaymentSession({ supabase, userId, subtotal, description, returnUrl, insertData = {} }) {
  const siteUrl = process.env.VITE_SITE_URL || 'http://localhost:3000'
  const refId   = randomBytes(10).toString('hex')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, billing_state')
    .eq('id', userId)
    .maybeSingle()

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
      user_id:       userId,
      amount_usd:    totalAmount.toFixed(2),
      subtotal_usd:  subtotal.toFixed(2),
      tax_usd:       taxAmount.toFixed(2),
      billing_state: taxState,
      ...insertData,
    })

  if (insertError) throw new Error(`DB error: ${insertError.message}`)

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
        order: { description },
        ...(taxAmount > 0 ? { tax: { amount: taxAmount.toFixed(2), name: 'Sales Tax', description: `${taxState} state sales tax` } } : {}),
      },
      hostedPaymentSettings: {
        setting: [
          {
            settingName: 'hostedPaymentReturnOptions',
            settingValue: JSON.stringify({
              showReceipt: false,
              // Sandbox's Order Summary redirect fails with more than one query param — keep to one.
              url: `${siteUrl}${returnUrl}`,
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

  const res = await fetch(API_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })
  // Authorize.net's JSON API prefixes responses with a UTF-8 BOM
  let text = await res.text()
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const data = JSON.parse(text)

  if (data.messages?.resultCode !== 'Ok' || !data.token) {
    const detail = data.messages?.message?.[0]?.text || JSON.stringify(data.messages)
    throw new Error(`Payment gateway error: ${detail}`)
  }

  return { token: data.token, formUrl: FORM_URL }
}
