// Shared helpers for parsing and matching Tracerfy result rows.
// Used by both tracerfy-webhook.js (realtime) and check-skip-trace.js (poll).

export function normalizeResult(row) {
  const makePhone = (number, type, field) => {
    if (!number) return null
    const dncKey = `${field}_dnc`
    return dncKey in row ? { number, type, dnc: !!row[dncKey] } : { number, type }
  }

  const phoneFields = [
    ['primary_phone', 'primary',  'primary_phone'],
    ['mobile_1',      'mobile',   'mobile_1'],
    ['mobile_2',      'mobile',   'mobile_2'],
    ['mobile_3',      'mobile',   'mobile_3'],
    ['mobile_4',      'mobile',   'mobile_4'],
    ['mobile_5',      'mobile',   'mobile_5'],
    ['landline_1',    'landline', 'landline_1'],
    ['landline_2',    'landline', 'landline_2'],
    ['landline_3',    'landline', 'landline_3'],
  ]
  const phones      = phoneFields.map(([f, t, k]) => makePhone(row[f], t, k)).filter(Boolean)
  const dncScrubbed = phoneFields.some(([,, k]) => `${k}_dnc` in row)
  const emails      = [row.email_1, row.email_2, row.email_3, row.email_4, row.email_5].filter(Boolean)

  return {
    first_name:   row.first_name   || null,
    last_name:    row.last_name    || null,
    full_name:    [row.first_name, row.last_name].filter(Boolean).join(' ') || null,
    phones,
    emails,
    mail_address: row.mail_address || null,
    address:      row.address      || null,
    city:         row.city         || null,
    state:        row.state        || null,
    ...(dncScrubbed ? { dnc_scrubbed: true } : {}),
  }
}

const normAddr = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const fullKey  = (addr, city, state) => normAddr([addr, city, state].filter(Boolean).join(' '))

// Match a Tracerfy result row to one of our saved records by exact normalized address.
// Prefers address+city+state (disambiguates addresses that share a short street prefix,
// e.g. "100 Oak Avenue" vs "100 Oak Ave Apt 3" in different cities); falls back to
// street-address-only equality when the row has no city/state. Deliberately exact —
// prefix matching previously let unrelated records collide and receive each other's PII.
export function matchRecord(tracerfyRow, records) {
  const rowAddrKey = normAddr(tracerfyRow.address)
  if (!rowAddrKey) return null

  const rowFullKey = fullKey(tracerfyRow.address, tracerfyRow.city, tracerfyRow.state)
  if (rowFullKey) {
    const match = records.find(r => fullKey(r.address, r.city, r.state_code) === rowFullKey)
    if (match) return match
  }

  return records.find(r => normAddr(r.address) === rowAddrKey) || null
}
