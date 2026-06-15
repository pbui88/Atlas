// US sales tax — base state-level rates only (no local/county add-ons).
// Used to charge sales tax to non-admin users on credit purchases based on
// their billing state (set in Account Settings). Rates are approximate and
// should be reviewed periodically for accuracy/compliance.
export const US_STATE_TAX_RATES = {
  AL: 0.0400, AK: 0,      AZ: 0.0560, AR: 0.0650, CA: 0.0725,
  CO: 0.0290, CT: 0.0635, DE: 0,      FL: 0.0600, GA: 0.0400,
  HI: 0.0400, ID: 0.0600, IL: 0.0625, IN: 0.0700, IA: 0.0600,
  KS: 0.0650, KY: 0.0600, LA: 0.0445, ME: 0.0550, MD: 0.0600,
  MA: 0.0625, MI: 0.0600, MN: 0.0688, MS: 0.0700, MO: 0.0423,
  MT: 0,      NE: 0.0550, NV: 0.0685, NH: 0,      NJ: 0.0663,
  NM: 0.0488, NY: 0.0400, NC: 0.0475, ND: 0.0500, OH: 0.0575,
  OK: 0.0450, OR: 0,      PA: 0.0600, RI: 0.0700, SC: 0.0600,
  SD: 0.0420, TN: 0.0700, TX: 0.0625, UT: 0.0610, VT: 0.0600,
  VA: 0.0530, WA: 0.0650, WV: 0.0600, WI: 0.0500, WY: 0.0400,
  DC: 0.0600,
}

// Value used for users billed outside the US — no US sales tax applies.
export const OUTSIDE_US = 'OTHER'

export const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
  { code: OUTSIDE_US, name: 'Outside the United States' },
]

// Returns the sales tax rate (as a decimal, e.g. 0.0725) for a billing
// state code. Unknown codes and OUTSIDE_US resolve to 0.
export function getTaxRate(stateCode) {
  return US_STATE_TAX_RATES[stateCode] ?? 0
}

// Returns the tax amount for a subtotal in a given billing state, rounded
// to the nearest cent.
export function calculateTax(subtotal, stateCode) {
  return Math.round(subtotal * getTaxRate(stateCode) * 100) / 100
}
