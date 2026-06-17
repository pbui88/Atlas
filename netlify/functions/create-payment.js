import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'
import { createHostedPaymentSession, FORM_URL } from './utils/authorizenet.js'

const PACKAGES = {
   2500: { points:  2500, amount: '35.00',  label:  '2,500 Credits' },
   5000: { points:  5000, amount: '70.00',  label:  '5,000 Credits' },
  10000: { points: 10000, amount: '140.00', label: '10,000 Credits' },
  15000: { points: 15000, amount: '210.00', label: '15,000 Credits' },
  20000: { points: 20000, amount: '280.00', label: '20,000 Credits' },
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

  const supabase = adminSupabase()

  try {
    const { token, formUrl } = await createHostedPaymentSession({
      supabase,
      userId:      user.id,
      subtotal:    parseFloat(pkg.amount),
      description: `Atlas ${pkg.label}`,
      returnUrl:   `/credits?purchase=${pkg.points}`,
      insertData:  { points: pkg.points },
    })
    return ok({ token, formUrl })
  } catch (e) {
    console.error('create-payment:', e.message)
    return err(e.message, 500)
  }
}
