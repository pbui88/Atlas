import Stripe from 'stripe'
import { adminSupabase } from './utils/supabase.js'

const CORS = { 'Content-Type': 'application/json' }
const respond = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) })

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' })

  const stripe  = new Stripe(process.env.STRIPE_SECRET_KEY)
  const sig     = event.headers['stripe-signature']

  // Fix 3b: handle base64-encoded bodies from Netlify
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body

  let stripeEvent
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return respond(400, { error: `Webhook error: ${err.message}` })
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object
    const userId  = session.metadata?.user_id
    const points  = parseInt(session.metadata?.points, 10)

    // Fix 2: return 200 (not 400) so Stripe stops retrying
    if (!userId || !points || isNaN(points)) {
      console.error('Missing metadata in checkout session:', session.id)
      return respond(200, { received: true })
    }

    const supabase = adminSupabase()

    // Fix 1: check for duplicate before crediting
    const { data: existing } = await supabase
      .from('credit_purchases')
      .select('stripe_session_id')
      .eq('stripe_session_id', session.id)
      .maybeSingle()

    if (existing) {
      console.log('Duplicate webhook — already processed:', session.id)
      return respond(200, { received: true })
    }

    // Record the purchase first to claim the session ID
    const { error: insertError } = await supabase
      .from('credit_purchases')
      .insert({ stripe_session_id: session.id, user_id: userId, points })

    if (insertError) {
      console.error('Failed to record purchase (possible race):', insertError.message)
      // Return 200 — Stripe doesn't need to retry; we'll investigate via Stripe dashboard
      return respond(200, { received: true })
    }

    // Now safely increment the user's credit balance
    const { error: rpcError } = await supabase.rpc('increment_purchased_credits', {
      p_user_id: userId,
      p_points:  points,
    })

    if (rpcError) {
      console.error('Failed to credit user:', rpcError.message, '| session:', session.id)
      // Return 500 here intentionally — Stripe will retry and the duplicate check
      // above will prevent double-crediting on the retry
      return respond(500, { error: 'Failed to apply credits' })
    }

    console.log(`Credited ${points} points to user ${userId} | session ${session.id}`)
  }

  return respond(200, { received: true })
}
