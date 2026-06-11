import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1)]
    })
)

const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const startOfToday = new Date()
startOfToday.setHours(0, 0, 0, 0)

const { data, error } = await supabase
  .from('usage_logs')
  .select('service, action, count, cost_usd, created_at, user_id')
  .gte('created_at', startOfToday.toISOString())
  .order('created_at', { ascending: true })

if (error) {
  console.error(error)
  process.exit(1)
}

console.log(`Rows since ${startOfToday.toISOString()}: ${data.length}`)

const byService = {}
for (const row of data) {
  const key = row.service
  byService[key] ??= { count: 0, cost: 0 }
  byService[key].count += row.count
  byService[key].cost += row.cost_usd ?? 0
}

let total = 0
for (const [service, { count, cost }] of Object.entries(byService)) {
  console.log(`${service}: count=${count}, cost=$${cost.toFixed(4)}`)
  total += cost
}
console.log(`TOTAL: $${total.toFixed(4)}`)

const byUser = {}
for (const row of data) {
  byUser[row.user_id] ??= 0
  byUser[row.user_id] += row.cost_usd ?? 0
}
console.log('By user:')
for (const [uid, cost] of Object.entries(byUser)) {
  console.log(`  ${uid}: $${cost.toFixed(4)}`)
}
