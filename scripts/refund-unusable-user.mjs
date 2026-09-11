// One-off catch-up run: exercise the real geocode-points.js handler (with its
// new no-house-number refund logic) against tfmhomebuyers@gmail.com's points
// that were never re-run through it after the refund feature shipped — an
// earlier manual DB backfill filled in zips but deliberately skipped these,
// so they never got a chance to hit the new refund path.
import { createClient } from '@supabase/supabase-js'
import { handler } from '../netlify/functions/geocode-points.js'

const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon  = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)

const USER_ID = 'b27c5c1f-7465-4a07-a7cf-a89afd11c04a'
const EMAIL   = 'tfmhomebuyers@gmail.com'

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

async function main() {
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
  if (linkErr) throw linkErr
  const { data: sess, error: otpErr } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  })
  if (otpErr) throw otpErr
  const accessToken = sess.session.access_token

  const { data: projects } = await admin.from('projects').select('id, name').eq('user_id', USER_ID)

  for (const proj of projects) {
    const { data: pts } = await admin
      .from('scan_points')
      .select('id, address')
      .eq('project_id', proj.id)
      .not('address', 'is', null)

    const targets = (pts || []).filter(p => !/^\d/.test(p.address.trim()))
    if (!targets.length) { console.log(`[${proj.name}] nothing to re-run`); continue }
    console.log(`\n[${proj.name}] re-running geocode+refund for ${targets.length} points`)

    let geocoded = 0, refunded = 0, stillUnresolved = 0
    for (const batch of chunk(targets.map(p => p.id), 50)) {
      const res = await handler({
        httpMethod: 'POST',
        body: JSON.stringify({ projectId: proj.id, pointIds: batch }),
        headers: { authorization: `Bearer ${accessToken}` },
      })
      const body = JSON.parse(res.body)
      if (res.statusCode !== 200) { console.error('  handler error:', body); continue }
      for (const r of body.results) {
        if (r.status === 'geocoded') geocoded++
        else if (r.refunded) refunded++
        else stillUnresolved++
      }
      console.log(`  batch done — refundedCount reported: ${body.refundedCount}`)
    }
    console.log(`[${proj.name}] geocoded: ${geocoded}, refunded: ${refunded}, unresolved (no refund — no charge found): ${stillUnresolved}`)
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
