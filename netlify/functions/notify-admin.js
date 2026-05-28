import { requireAuth, adminSupabase, ok, err, options } from './utils/supabase.js'

const RESEND_KEY   = process.env.RESEND_API_KEY
const ADMIN_EMAIL  = process.env.ADMIN_NOTIFICATION_EMAIL
const SITE_URL     = process.env.VITE_SITE_URL || 'https://your-atlas-app.netlify.app'

async function sendEmail(user) {
  if (!RESEND_KEY || !ADMIN_EMAIL) return   // degrade gracefully if not configured

  await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    'Atlas <onboarding@resend.dev>',
      to:      [ADMIN_EMAIL],
      subject: `New user registration — ${user.email}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#1e293b">New user registered on Atlas</h2>
          <p style="color:#475569">A new user is waiting for activation:</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px 0;color:#94a3b8;width:100px">Name</td><td style="padding:8px 0;color:#1e293b;font-weight:600">${user.full_name || '—'}</td></tr>
            <tr><td style="padding:8px 0;color:#94a3b8">Email</td><td style="padding:8px 0;color:#1e293b;font-weight:600">${user.email}</td></tr>
            <tr><td style="padding:8px 0;color:#94a3b8">Signed up</td><td style="padding:8px 0;color:#1e293b">${new Date().toLocaleString()}</td></tr>
          </table>
          <a href="${SITE_URL}/admin" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">
            Activate in Admin Panel →
          </a>
          <p style="color:#94a3b8;font-size:12px;margin-top:24px">Atlas · Distressed Property Scanner</p>
        </div>
      `,
    }),
  })
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options()
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405)

  const { user, error } = await requireAuth(event, { allowInactive: true })
  if (error) return err(error, 401)

  const supabase = adminSupabase()

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name, admin_notified, is_active')
    .eq('id', user.id)
    .maybeSingle()

  // Already notified — nothing to do
  if (!profile || profile.admin_notified) return ok({ alreadyNotified: true })

  // Mark notified first to prevent duplicate emails on rapid re-renders
  await supabase
    .from('profiles')
    .update({ admin_notified: true })
    .eq('id', user.id)

  await sendEmail({ email: profile.email || user.email, full_name: profile.full_name })

  return ok({ notified: true })
}
