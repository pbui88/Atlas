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

// Match a Tracerfy result row to one of our saved records by address prefix (10-char).
export function matchRecord(tracerfyRow, records) {
  const rowKey = normAddr(tracerfyRow.address)
  if (!rowKey) return null
  return records.find(r => {
    const recKey = normAddr(r.address)
    return recKey && (
      rowKey.startsWith(recKey.slice(0, 10)) ||
      recKey.startsWith(rowKey.slice(0, 10))
    )
  }) || null
}
