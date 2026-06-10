import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('[Atlas] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(url, key)

// Supabase/PostgREST caps each response at a max row count (commonly 1000),
// regardless of .limit(). This fetches every row matching a query by paging
// through with .range() until an empty page is returned.
const PAGE_SIZE = 1000

export async function fetchAllRows(buildQuery) {
  let rows = []
  let from = 0
  while (true) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (error || !data?.length) break
    rows = rows.concat(data)
    from += data.length
  }
  return rows
}
