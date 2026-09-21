// One-off recovery: several accounts had scan projects interrupted mid-run
// (collect-images.js hit Netlify's 10s default timeout before points reached
// a terminal status) and then got silently stamped "Complete" by the
// Dashboard's stuck-project cleanup, which didn't check for unfinished points.
// Resets orphaned 'downloading' points back to 'pending' and reopens every
// affected project (across all accounts) so a rescan can pick up wherever it
// left off — ResultsTab resumes from whatever phase the points are in.
import { createClient } from '@supabase/supabase-js'

const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const { data: projects, error } = await admin
    .from('projects')
    .select('id, user_id, name, status')
    .eq('status', 'complete')
    .gt('total_points', 0)
  if (error) throw error

  let fixedProjects = 0
  let resetPoints = 0

  for (const proj of projects) {
    const { count: unfinished } = await admin
      .from('scan_points')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', proj.id)
      .in('status', ['pending', 'downloading', 'downloaded'])
    if (!unfinished) continue

    const { data: stuck } = await admin
      .from('scan_points')
      .select('id')
      .eq('project_id', proj.id)
      .eq('status', 'downloading')
    if (stuck?.length) {
      const ids = stuck.map(p => p.id)
      const { error: updErr } = await admin
        .from('scan_points')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .in('id', ids)
      if (updErr) { console.error(`[${proj.name}] reset failed:`, updErr); continue }
      resetPoints += ids.length
    }

    await admin.from('projects').update({ status: 'collecting' }).eq('id', proj.id)
    fixedProjects++
    console.log(`[${proj.name}] (user ${proj.user_id}) reset ${stuck?.length || 0} stuck 'downloading' points, project reopened (${unfinished} total unfinished)`)
  }

  console.log(`\nDone. Reopened ${fixedProjects} projects, reset ${resetPoints} orphaned 'downloading' points.`)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
