// Runs automatically every 5 minutes (see netlify.toml) to fix addresses that
// have a house number but no zip, and to retry/finalize (with a credit
// refund, via geocodePoint) addresses that never resolved a house number at
// all. Replaces having to manually re-run geocoding for affected users.
import { adminSupabase } from './utils/supabase.js'
import { geocodePoint } from './geocode-points.js'

// Nominatim's usage policy caps free reverse-geocode lookups at ~1/sec.
// At 26s (this function's configured timeout, see netlify.toml) that leaves
// room for ~20 points per run with margin for the Postgres round trips.
const BATCH = 20

function looksLikeLatLng(str) {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test((str || '').trim())
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

export const handler = async () => {
  if (!process.env.POSITIONSTACK_API_KEY) {
    console.error('[zip-backfill] POSITIONSTACK_API_KEY not set')
    return { statusCode: 200 }
  }

  const supabase = adminSupabase()

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
    .limit(2000)

  const targets = (pts || []).filter(p => {
    const addr = p.address.trim()
    if (looksLikeLatLng(addr)) return true
    const hasZip       = /\d{5}(-\d{4})?\s*$/.test(addr)
    const hasHouseNum  = /^\d/.test(addr)
    if (hasZip && hasHouseNum) return false          // already complete
    if (!hasHouseNum && p.credit_refunded) return false // already finalized — don't re-hammer forever
    return true
  }).slice(0, BATCH)

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
    await sleep(1100)
  }

  console.log(`[zip-backfill] processed ${targets.length} — geocoded ${geocoded}, refunded ${refunded}, failed ${failed}`)
  return { statusCode: 200 }
}
