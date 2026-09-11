// Runs automatically every 5 minutes (see netlify.toml) to fix addresses that
// have a house number but no zip, and to retry/finalize (with a credit
// refund, via geocodePoint) addresses that never resolved a house number at
// all — including points that never got an address at all (address IS NULL),
// e.g. from a geocode-points invocation that hit an error/timeout mid-run.
// Replaces having to manually re-run geocoding for affected users.
//
// Named with the "-background" suffix so Netlify gives it up to 15 minutes
// instead of the ~26s ceiling on regular functions. geocode-points.js
// internally throttles Nominatim to ~1 req/sec now, so a point only takes
// that long when it actually needs Nominatim (most resolve via Positionstack
// alone and are fast) — no fixed per-point sleep needed here anymore. Runs
// can occasionally overlap the next 5-min trigger; that just means a little
// redundant work on the same points (harmless — the first-line checks in
// geocodePoint just skip anything already fixed), not correctness risk.
import { adminSupabase } from './utils/supabase.js'
import { geocodePoint } from './geocode-points.js'

const BATCH = 700

function looksLikeLatLng(str) {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test((str || '').trim())
}

export const handler = async () => {
  if (!process.env.POSITIONSTACK_API_KEY) {
    console.error('[zip-backfill] POSITIONSTACK_API_KEY not set')
    return { statusCode: 200 }
  }

  const supabase = adminSupabase()

  // Points that never resolved any address at all — the most severe failure
  // mode (zero data, not just a missing zip) — always get room in the batch,
  // fetched separately so a huge backlog of already-addressed rows can never
  // crowd them out of the oldest-10000 pool below.
  const { data: nullAddrPts } = await supabase
    .from('scan_points')
    .select('id, lat, lng, address, road_bearing, credit_refunded, project_id')
    .is('address', null)
    .eq('credit_refunded', false)
    .order('updated_at', { ascending: true })
    .limit(BATCH)

  // Pull a wide pool of the oldest-updated addressed points — regex filters
  // (missing zip / missing house number) aren't expressible in PostgREST, so
  // filter in JS. Oldest-first means a point that fails this run naturally
  // cycles to the back of the queue (its updated_at gets bumped) instead of
  // being retried every single run.
  const { data: pts } = await supabase
    .from('scan_points')
    .select('id, lat, lng, address, road_bearing, credit_refunded, project_id')
    .not('address', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(10000)

  const incomplete = (pts || []).filter(p => {
    const addr = p.address.trim()
    if (looksLikeLatLng(addr)) return true
    const hasZip       = /\d{5}(-\d{4})?\s*$/.test(addr)
    const hasHouseNum  = /^\d/.test(addr)
    if (hasZip && hasHouseNum) return false          // already complete
    if (!hasHouseNum && p.credit_refunded) return false // already finalized — don't re-hammer forever
    return true
  })

  const targets = [...(nullAddrPts || []), ...incomplete].slice(0, BATCH)

  if (!targets.length) {
    console.log('[zip-backfill] nothing to do')
    return { statusCode: 200 }
  }

  // Resolve user_id + admin role per point (needed by geocodePoint's refund check)
  const projectIds = [...new Set(targets.map(p => p.project_id))]
  const { data: projects } = await supabase.from('projects').select('id, user_id').in('id', projectIds)
  const projectUser = Object.fromEntries((projects || []).map(p => [p.id, p.user_id]))

  const userIds = [...new Set(Object.values(projectUser))]
  const { data: profiles } = await supabase.from('profiles').select('id, role').in('id', userIds)
  const roleMap = Object.fromEntries((profiles || []).map(p => [p.id, p.role]))

  let geocoded = 0, refunded = 0, failed = 0
  for (const pt of targets) {
    const userId  = projectUser[pt.project_id]
    const isAdmin = roleMap[userId] === 'admin'
    try {
      const result = await geocodePoint(pt, null, supabase, userId, isAdmin)
      if (result.status === 'geocoded') geocoded++
      if (result.refunded) refunded++
    } catch (e) {
      failed++
      console.error(`[zip-backfill] point ${pt.id} failed:`, e.message)
    }
  }

  console.log(`[zip-backfill] processed ${targets.length} — geocoded ${geocoded}, refunded ${refunded}, failed ${failed}`)
  return { statusCode: 200 }
}
