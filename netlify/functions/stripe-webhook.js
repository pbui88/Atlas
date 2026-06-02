import Stripe from 'stripe'
import { adminSupabase } from './utils/supabase.js'

const CORS = { 'Content-Type': 'application/json' }

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const stripe    = new Stripe(process.env.STRIPE_SECRET_KEY)
  const sig       = event.headers['stripe-signature']
  const rawBody   = event.body

  let stripeEvent
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `Webhook error: ${err.message}` }) }
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object
    const userId  = session.metadata?.user_id
    const points  = parseInt(session.metadata?.points, 10)

    if (!userId || !points || isNaN(points)) {
      console.error('Missing metadata in checkout session:', session.id)
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing metadata' }) }
    }

    const supabase = adminSupabase()
    const { error } = await supabase.rpc('increment_purchased_credits', {
      p_user_id: userId,
      p_points:  points,
    })

    if (error) {
      console.error('Failed to credit user:', error.message)
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Failed to apply credits' }) }
    }

    console.log(`Credited ${points} points to user ${userId}`)
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ received: true }) }
}
