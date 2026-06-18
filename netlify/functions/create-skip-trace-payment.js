import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'
import { createHostedPaymentSession } from './utils/authorizenet.js'

const MIN_DEPOSIT = 5
const MAX_DEPOSIT = 5000

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, role, error } = await requireAuth(event)
  if (error) return err(error, 401)
  if (role !== 'admin') return err('Forbidden', 403)

  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { return err('Invalid request body', 400) }

  const amount = parseFloat(body.amount)
  if (!isFinite(amount) || amount < MIN_DEPOSIT || amount > MAX_DEPOSIT) {
    return err(`Amount must be between $${MIN_DEPOSIT} and $${MAX_DEPOSIT}`, 400)
  }
  const subtotal = Math.round(amount * 100) / 100

  const supabase = adminSupabase()

  try {
    const { token, formUrl } = await createHostedPaymentSession({
      supabase,
      userId:      user.id,
      subtotal,
      description: `Atlas Skip Trace Deposit — $${subtotal.toFixed(2)}`,
      returnUrl:   `/credits?skip_trace_deposit=${subtotal.toFixed(2)}`,
      insertData:  { type: 'skip_trace', points: 0 },
    })
    return ok({ token, formUrl })
  } catch (e) {
    console.error('create-skip-trace-payment:', e.message)
    return err(e.message, 500)
  }
}
