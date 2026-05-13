export const PROJECT_STATUS = {
  DRAFT:      'draft',
  QUEUED:     'queued',
  COLLECTING: 'collecting',
  ANALYZING:  'analyzing',
  COMPLETE:   'complete',
  FAILED:     'failed',
  PAUSED:     'paused',
}

export const POINT_STATUS = {
  PENDING:     'pending',
  DOWNLOADING: 'downloading',
  DOWNLOADED:  'downloaded',
  ANALYZING:   'analyzing',
  COMPLETE:    'complete',
  FAILED:      'failed',
  NO_COVERAGE: 'no_coverage',
}

export const STATUS_LABELS = {
  draft:      'Draft',
  queued:     'Queued',
  collecting: 'Collecting',
  analyzing:  'Analyzing',
  complete:   'Complete',
  failed:     'Failed',
  paused:     'Paused',
}

export const STATUS_BADGE_CLASS = {
  draft:      'badge-slate',
  queued:     'badge-blue',
  collecting: 'badge-orange',
  analyzing:  'badge-yellow',
  complete:   'badge-green',
  failed:     'badge-red',
  paused:     'badge-slate',
}

export const DISTRESS_SIGNALS = [
  { id: 'boarded_windows',      label: 'Boarded Windows',      severity: 'high'   },
  { id: 'abandoned_appearance', label: 'Abandoned / Vacant',   severity: 'high'   },
  { id: 'tarp_roof',            label: 'Tarp on Roof',         severity: 'high'   },
  { id: 'tall_grass',           label: 'Tall Grass',           severity: 'medium' },
  { id: 'junk_in_yard',         label: 'Junk in Yard',         severity: 'medium' },
  { id: 'broken_gutters',       label: 'Broken Gutters',       severity: 'medium' },
  { id: 'peeling_paint',        label: 'Peeling Paint',        severity: 'low'    },
  { id: 'poor_maintenance',     label: 'Poor Maintenance',     severity: 'low'    },
]

export const SIGNAL_BADGE = {
  high:   'badge-red',
  medium: 'badge-orange',
  low:    'badge-yellow',
}

export const DIRECTIONS = [
  { label: 'N', heading: 0   },
  { label: 'S', heading: 180 },
  { label: 'E', heading: 90  },
  { label: 'W', heading: 270 },
]

// $7 per 1,000 Street View images; geocoding free (Positionstack); ~$0.001 per AI call (Gemini 2.5-flash)
export const API_COSTS = {
  streetViewPer1k: 7.00,
  geocodingPer1k:  0,
  aiPerPoint:      0.001,
}
