import Stripe from 'stripe'
import { requireAuth, ok, err, options } from './utils/supabase.js'

const PACKAGES = {
  10000: { points: 10000, amount: 14000, label: '10,000 Credits' },
  15000: { points: 15000, amount: 21000, label: '15,000 Credits' },
  20000: { points: 20000, amount: 28000, label: '20,000 Credits' },
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event)
  if (error) return err(error, 401)

  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { return err('Invalid request body', 400) }

  const pkg = PACKAGES[body.points]
  if (!pkg) return err('Invalid package', 400)

  const stripe  = new Stripe(process.env.STRIPE_SECRET_KEY)
  const siteUrl = process.env.VITE_SITE_URL || 'http://localhost:3000'

  // Fix 4: wrap Stripe API call in try/catch
  try {
    const session = await stripe.checkout.sessions.create({
      mode:                 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity:   1,
        price_data: {
          currency:     'usd',
          unit_amount:  pkg.amount,
          product_data: { name: `Atlas ${pkg.label}`, description: `${pkg.points.toLocaleString()} scan credit points` },
        },
      }],
      metadata:    { user_id: user.id, points: String(pkg.points) },
      success_url: `${siteUrl}/credits?success=true&points=${pkg.points}`,
      cancel_url:  `${siteUrl}/credits`,
    })
    return ok({ url: session.url })
  } catch (e) {
    console.error('Stripe checkout error:', e.message)
    return err('Failed to create checkout session. Please try again.', 500)
  }
}
