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
  { id: 'boarded_windows',     label: 'Boarded Windows',     severity: 'high' },
  { id: 'broken_windows',      label: 'Broken Windows',      severity: 'high' },
  { id: 'roof_damage',         label: 'Roof Damage',         severity: 'high' },
  { id: 'structural_damage',   label: 'Structural Damage',   severity: 'high' },
  { id: 'fire_damage',         label: 'Fire Damage',         severity: 'high' },
  { id: 'overgrown_vegetation',label: 'Overgrown Vegetation',severity: 'medium' },
  { id: 'debris_accumulation', label: 'Debris / Trash',      severity: 'medium' },
  { id: 'graffiti',            label: 'Graffiti',            severity: 'medium' },
  { id: 'abandoned_vehicle',   label: 'Abandoned Vehicle',   severity: 'medium' },
  { id: 'broken_fencing',      label: 'Broken Fencing',      severity: 'low' },
  { id: 'peeling_paint',       label: 'Peeling Paint',       severity: 'low' },
  { id: 'general_neglect',     label: 'General Neglect',     severity: 'low' },
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

// $7 per 1,000 Street View images; $5 per 1,000 geocodes; ~$0.015 per AI call (4 imgs)
export const API_COSTS = {
  streetViewPer1k: 7.00,
  geocodingPer1k:  5.00,
  aiPerPoint:      0.015,
}
