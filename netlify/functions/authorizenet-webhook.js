import { createHmac, timingSafeEqual } from 'crypto'
import { adminSupabase } from './utils/supabase.js'

const CORS = { 'Content-Type': 'application/json' }
const respond = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) })

function isValidSignature(rawBody, header, signatureKey) {
  if (!header || !signatureKey) return false
  const provided = header.replace(/^sha512=/i, '').trim().toUpperCase()
  const expected = createHmac('sha512', Buffer.from(signatureKey, 'hex'))
    .update(rawBody, 'utf8')
    .digest('hex')
    .toUpperCase()
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' })

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : (event.body || '')

  const signature = event.headers['x-anet-signature'] || event.headers['X-ANET-Signature']

  if (!isValidSignature(rawBody, signature, process.env.AUTHORIZENET_SIGNATURE_KEY)) {
    console.error('Authorize.net webhook signature verification failed')
    return respond(401, { error: 'Invalid signature' })
  }

  let webhookEvent
  try { webhookEvent = JSON.parse(rawBody) } catch { return respond(400, { error: 'Invalid JSON' }) }

  if (webhookEvent.eventType !== 'net.authorize.payment.authcapture.created') {
    return respond(200, { received: true })
  }

  const refId   = webhookEvent.payload?.merchantReferenceId
  const transId = webhookEvent.payload?.id
  if (!refId) {
    console.error('Webhook missing merchantReferenceId:', webhookEvent.notificationId)
    return respond(200, { received: true })
  }

  const supabase = adminSupabase()
  const { data: completed, error: rpcError } = await supabase.rpc('complete_payment_transaction', {
    p_ref_id:   refId,
    p_trans_id: transId,
  })

  if (rpcError) {
    console.error('Failed to complete payment:', rpcError.message, '| ref:', refId)
    return respond(500, { error: 'Failed to apply credits' })
  }

  if (completed) {
    console.log(`Credited payment ref ${refId} | trans ${transId}`)
  } else {
    console.log('Duplicate or unknown webhook — ref:', refId)
  }

  return respond(200, { received: true })
}
