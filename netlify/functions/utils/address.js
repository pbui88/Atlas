// Shared helpers for parsing full "123 Main St, City, ST 12345" style addresses.
// Mirrors src/lib/address.js — kept separate because Netlify functions don't
// share a bundle with the frontend.

export function cleanAddress(addr) {
  return (addr || '').replace(/,?\s*(United States|USA|US)\s*$/i, '').trim()
}

export function splitFullAddress(full) {
  const cleaned = cleanAddress(full)
  const parts    = cleaned.split(',').map(s => s.trim()).filter(Boolean)
  const stateZip = parts[parts.length - 1] || ''
  const m = stateZip.match(/^([A-Z]{2})\s+(\d{5}(-\d{4})?)$/)
  return {
    address:    parts[0] || full,
    city:       m && parts.length >= 3 ? parts[parts.length - 2] : (parts[1] || null),
    state_code: m ? m[1] : null,
    zip:        m ? m[2] : null,
  }
}
