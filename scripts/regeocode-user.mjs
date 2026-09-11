// One-off backfill: fill in missing zip codes for a specific user's scan_points
// via the same Nominatim-only path geocode-points.js uses for addresses that
// already have a house number but no zip. Run with: node scripts/regeocode-user.mjs
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const USER_ID = 'b27c5c1f-7465-4a07-a7cf-a89afd11c04a' // tfmhomebuyers@gmail.com

function looksLikeLatLng(str) {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test((str || '').trim())
}

async function lookupZip(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'User-Agent': 'AtlasApp/1.0 (regeocode backfill)' } }
    )
    const data = await res.json()
    const pc = data.address?.postcode || ''
    return pc.replace(/^(\d{5})[\s-]\d{4}$/, '$1').trim() || null
  } catch {
    return null
  }
}

function injectZip(address, zip) {
  const stripped = address.replace(/[\s\d-]+$/, '').trim()
  const patched  = stripped.replace(/(,\s*)([A-Z]{2})$/, `$1$2 ${zip}`)
  return patched !== stripped ? patched : `${stripped} ${zip}`
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  const { data: projects } = await supabase
    .from('projects').select('id, name').eq('user_id', USER_ID)

  let filled = 0, stillMissing = 0, skippedNoHouseNum = 0, total = 0

  for (const proj of projects) {
    const { data: points } = await supabase
      .from('scan_points')
      .select('id, address, lat, lng')
      .eq('project_id', proj.id)
      .not('address', 'is', null)

    const targets = (points || []).filter(p =>
      !looksLikeLatLng(p.address) &&
      /^\d/.test(p.address.trim()) &&
      !/\d{5}\s*$/.test(p.address)
    )
    const noHouseNum = (points || []).filter(p => !looksLikeLatLng(p.address) && !/^\d/.test(p.address.trim()) && !/\d{5}\s*$/.test(p.address))
    skippedNoHouseNum += noHouseNum.length

    console.log(`\n[${proj.name}] ${targets.length} addresses to backfill (skipping ${noHouseNum.length} without a house number)`)
    total += targets.length

    for (const pt of targets) {
      const zip = await lookupZip(pt.lat, pt.lng)
      if (zip) {
        const address = injectZip(pt.address, zip)
        await supabase.from('scan_points')
          .update({ address, updated_at: new Date().toISOString() })
          .eq('id', pt.id)
        filled++
      } else {
        stillMissing++
      }
      if ((filled + stillMissing) % 25 === 0) {
        console.log(`  progress: ${filled + stillMissing}/${targets.length} in this project (filled ${filled}, still missing ${stillMissing})`)
      }
      await sleep(1100) // respect Nominatim's 1 req/sec usage policy
    }
  }

  console.log(`\n=== DONE === total targeted: ${total}, filled: ${filled}, still missing after retry: ${stillMissing}, skipped (no house number): ${skippedNoHouseNum}`)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
