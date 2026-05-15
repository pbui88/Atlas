import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { collectImages, analyzePoints, geocodePoints, exportProject } from '../../lib/api'
import { chunkArray } from '../../lib/geo'
import { scoreLabel } from '../../lib/geo'
import { DISTRESS_SIGNALS, SIGNAL_BADGE } from '../../lib/constants'

const COLLECT_BATCH     = 20   // must match CAP in collect-images.js
const COLLECT_CONCUR    = 3    // parallel function calls during image collection
const AI_BATCH          = 8    // must match CAP in analyze-points.js
const AI_CONCUR         = 2    // parallel function calls during analysis
const GEO_BATCH         = 50   // must match CAP in geocode-points.js
const GEO_CONCUR        = 2    // parallel function calls during geocoding


const PHASE_LABEL = {
  collecting: 'Collecting Street View images…',
  geocoding:  'Reverse geocoding addresses…',
  analyzing:  'Running AI distress analysis…',
}

const SIGNAL_MAP = Object.fromEntries(DISTRESS_SIGNALS.map(s => [s.id, s]))

function scoreTextColor(score) {
  if (score == null) return 'text-slate-400'
  if (score >= 0.70) return 'text-red-500'
  if (score >= 0.45) return 'text-orange-500'
  if (score >= 0.20) return 'text-amber-500'
  return 'text-emerald-600'
}

function scoreBorderColor(score) {
  if (score == null) return 'border-slate-200 bg-slate-50'
  if (score >= 0.70) return 'border-red-300 bg-red-50'
  if (score >= 0.45) return 'border-orange-300 bg-orange-50'
  if (score >= 0.20) return 'border-amber-300 bg-amber-50'
  return 'border-emerald-300 bg-emerald-50'
}

function ProgressBar({ label, value, max, color = 'bg-brand-600' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-slate-500">
        <span>{label}</span>
        <span className="font-medium text-slate-700">{value} / {max}</span>
      </div>
      <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
        <div className={`h-1.5 rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function PropertyRow({ point, isSelected, onClick }) {
  const score   = point.ai_analyses?.[0]?.overall_score
  const signals = point.ai_analyses?.[0]?.signals || []
  return (
    <div
      onClick={onClick}
      className={`px-4 py-3 cursor-pointer border-b border-slate-100 transition-colors ${
        isSelected ? 'bg-brand-50 border-l-2 border-l-brand-500' : 'hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={`text-base font-bold tabular-nums shrink-0 leading-tight mt-0.5 ${scoreTextColor(score)}`}>
          {scoreLabel(score)}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-900 font-medium truncate leading-snug">
            {point.address || `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}
          </p>
          {signals.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {signals.slice(0, 2).map(sig => {
                const s = SIGNAL_MAP[sig]
                return s ? (
                  <span key={sig} className={`${SIGNAL_BADGE[s.severity]} text-[10px] px-1.5 py-0`}>{s.label}</span>
                ) : null
              })}
              {signals.length > 2 && (
                <span className="badge-slate text-[10px] px-1.5 py-0">+{signals.length - 2}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ResultsTab({ project, onProjectUpdate }) {
  // ── Results state ──────────────────────────────────────────
  const [points,     setPoints]     = useState([])
  const [resLoading, setResLoading] = useState(true)
  const [selected,   setSelected]   = useState(null)
  const [minScore,   setMinScore]   = useState(0)
  const [sigFilter,  setSigFilter]  = useState([])
  const [exporting,  setExporting]  = useState(false)
  const [selImages,  setSelImages]  = useState([])
  const [imgLoading, setImgLoading] = useState(false)

  // ── Scan state ─────────────────────────────────────────────
  const [stats,    setStats]   = useState({ total: 0, pending: 0, downloaded: 0, complete: 0, failed: 0, no_coverage: 0 })
  const [running,  setRunning] = useState(false)
  const [phase,    setPhase]   = useState('')
  const [abortRef] = useState({ current: false })

  // ── Data fetching ──────────────────────────────────────────
  const fetchStats = async () => {
    const { data } = await supabase.from('scan_points').select('status').eq('project_id', project.id)
    if (!data) return
    const c = data.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc }, {})
    setStats({ total: data.length, pending: c.pending || 0, downloaded: c.downloaded || 0, complete: c.complete || 0, failed: c.failed || 0, no_coverage: c.no_coverage || 0 })
  }

  const fetchResults = useCallback(async () => {
    setResLoading(true)
    const { data: pts } = await supabase
      .from('scan_points')
      .select('id, lat, lng, address, status')
      .eq('project_id', project.id)
      .eq('status', 'complete')
      .order('created_at')

    if (!pts?.length) { setPoints([]); setResLoading(false); return }

    const { data: analyses } = await supabase
      .from('ai_analyses')
      .select('scan_point_id, overall_score, confidence, signals, notes')
      .in('scan_point_id', pts.map(p => p.id))

    const analysisMap = Object.fromEntries((analyses || []).map(a => [a.scan_point_id, a]))
    setPoints(pts.map(pt => ({ ...pt, ai_analyses: analysisMap[pt.id] ? [analysisMap[pt.id]] : [] })))
    setResLoading(false)
  }, [project.id])

  useEffect(() => { fetchStats(); fetchResults() }, [project.id])

  // ── Image fetch when property selected ─────────────────────
  useEffect(() => {
    if (!selected) { setSelImages([]); return }
    setSelImages([])
    setImgLoading(true)
    supabase.from('images').select('*').eq('scan_point_id', selected.id)
      .then(({ data }) => { setSelImages(data || []); setImgLoading(false) })
  }, [selected?.id])

  // ── Scan logic ─────────────────────────────────────────────
  const runScan = async () => {
    abortRef.current = false
    setRunning(true)

    // ── Phase 1: Collect Street View images ────────────────────
    setPhase('collecting')
    try {
      const { data: pending } = await supabase.from('scan_points').select('id')
        .eq('project_id', project.id).in('status', ['pending', 'failed'])
      if (pending?.length) {
        const chunks = chunkArray(pending.map(p => p.id), COLLECT_BATCH)
        for (let i = 0; i < chunks.length; i += COLLECT_CONCUR) {
          if (abortRef.current) break
          await Promise.allSettled(
            chunks.slice(i, i + COLLECT_CONCUR).map(batch =>
              collectImages(project.id, batch).catch(() => {})
            )
          )
          await fetchStats()
        }
      }
    } catch { /* continue */ }

    if (abortRef.current) { setRunning(false); setPhase(''); return }

    // ── Phase 2: Reverse geocode addresses ─────────────────────
    // Pick up ANY point missing an address (any status), so retries fill
    // in gaps left from previous runs where the point already progressed.
    setPhase('geocoding')
    try {
      const { data: dloaded } = await supabase.from('scan_points').select('id')
        .eq('project_id', project.id).is('address', null)
        .not('lat', 'is', null).not('lng', 'is', null)
      if (dloaded?.length) {
        const chunks = chunkArray(dloaded.map(p => p.id), GEO_BATCH)
        for (let i = 0; i < chunks.length; i += GEO_CONCUR) {
          if (abortRef.current) break
          await Promise.allSettled(
            chunks.slice(i, i + GEO_CONCUR).map(batch =>
              geocodePoints(project.id, batch).catch(() => {})
            )
          )
        }
      }
    } catch { /* continue */ }

    if (abortRef.current) { setRunning(false); setPhase(''); return }

    // ── Phase 3: AI distress analysis ──────────────────────────
    setPhase('analyzing')
    try {
      const { data: toAnalyze } = await supabase.from('scan_points').select('id')
        .eq('project_id', project.id).eq('status', 'downloaded')
      if (toAnalyze?.length) {
        const chunks = chunkArray(toAnalyze.map(p => p.id), AI_BATCH)
        for (let i = 0; i < chunks.length; i += AI_CONCUR) {
          if (abortRef.current) break
          await Promise.allSettled(
            chunks.slice(i, i + AI_CONCUR).map(batch =>
              analyzePoints(project.id, batch).catch(() => {})
            )
          )
          await fetchStats()
          await fetchResults()
        }
      }
    } catch { /* continue */ }

    setPhase('')
    setRunning(false)
    await fetchStats()
    await fetchResults()
    onProjectUpdate?.()
  }

  const pause = () => { abortRef.current = true }

  // ── Filter / sort ──────────────────────────────────────────
  const toggleSignal = (id) => setSigFilter(f => f.includes(id) ? f.filter(s => s !== id) : [...f, id])

  const filtered = points.filter(pt => {
    const score = pt.ai_analyses?.[0]?.overall_score ?? 0
    if (score < minScore / 100) return false
    if (sigFilter.length > 0) {
      const sigs = pt.ai_analyses?.[0]?.signals || []
      if (!sigFilter.some(s => sigs.includes(s))) return false
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) =>
    (b.ai_analyses?.[0]?.overall_score ?? 0) - (a.ai_analyses?.[0]?.overall_score ?? 0)
  )

  // ── Export ─────────────────────────────────────────────────
  const handleExport = async (format) => {
    setExporting(true)
    try {
      const result = await exportProject(project.id, format, {
        minScore: minScore / 100,
        signals: sigFilter.length ? sigFilter : undefined,
      })
      const blob = new Blob(
        [typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)],
        { type: format === 'CSV' ? 'text/csv' : 'application/json' }
      )
      const url = URL.createObjectURL(blob)
      const a   = document.createElement('a')
      a.href    = url
      a.download = `${project.name.replace(/\s+/g, '_')}_${format.toLowerCase()}.${format === 'CSV' ? 'csv' : 'json'}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) { alert(err.message) }
    finally { setExporting(false) }
  }

  const hasFilters  = minScore > 0 || sigFilter.length > 0
  const canStart    = stats.total > 0 && !running
  const analysis    = selected?.ai_analyses?.[0]
  const score       = analysis?.overall_score
  const signals     = analysis?.signals || []
  const notes       = analysis?.notes

  return (
    <div className="flex h-full">

      {/* ── Left panel ── */}
      <div className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0">

        {/* Scan controls header */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">Results</h3>
            {running && phase && (
              <p className="text-[11px] text-brand-600 mt-0.5 truncate">{PHASE_LABEL[phase]}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {running && <span className="w-3.5 h-3.5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />}
            {running ? (
              <button onClick={pause} className="btn border border-amber-300 text-amber-600 hover:bg-amber-50 bg-white text-xs px-2.5 py-1.5">
                Pause
              </button>
            ) : (
              <button onClick={runScan} disabled={!canStart} className="btn-primary text-xs px-2.5 py-1.5">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
                </svg>
                AI Driving
              </button>
            )}
          </div>
        </div>

        {/* Progress bars — shown while running or when scan has started */}
        {stats.total > 0 && (
          <div className="px-4 py-3 border-b border-slate-200 space-y-2.5">
            <ProgressBar label="Images" value={stats.downloaded + stats.complete} max={stats.total} />
            <ProgressBar label="AI analysis" value={stats.complete} max={stats.total} color="bg-green-500" />
          </div>
        )}

        {/* Filters — only shown once there are results */}
        {points.length > 0 && (
          <div className="px-4 py-3 border-b border-slate-200 space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Min Score</span>
                <span className="text-xs font-bold text-slate-900 tabular-nums">{minScore}</span>
              </div>
              <input type="range" min={0} max={90} step={5} value={minScore}
                onChange={e => setMinScore(+e.target.value)} className="w-full accent-brand-600" />
            </div>
            <div className="flex flex-wrap gap-1">
              {DISTRESS_SIGNALS.map(sig => (
                <button key={sig.id} onClick={() => toggleSignal(sig.id)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                    sigFilter.includes(sig.id)
                      ? 'bg-brand-600 border-brand-600 text-white'
                      : 'bg-white border-slate-300 text-slate-600 hover:border-brand-400 hover:text-brand-600'
                  }`}>
                  {sig.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Active filter chips */}
        {hasFilters && (
          <div className="px-4 py-2 bg-brand-50 border-b border-brand-100 flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-brand-600 uppercase tracking-widest shrink-0">Active:</span>
            {minScore > 0 && (
              <button onClick={() => setMinScore(0)}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-brand-200 rounded-full text-[11px] text-brand-700 hover:bg-brand-50 transition">
                Score ≥ {minScore}<span className="text-brand-400 font-bold ml-0.5">×</span>
              </button>
            )}
            {sigFilter.map(sig => (
              <button key={sig} onClick={() => toggleSignal(sig)}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-slate-300 rounded-full text-[11px] text-slate-700 hover:bg-slate-50 transition">
                {SIGNAL_MAP[sig]?.label}<span className="text-slate-400 font-bold ml-0.5">×</span>
              </button>
            ))}
            <button onClick={() => { setMinScore(0); setSigFilter([]) }}
              className="ml-auto text-[11px] text-brand-600 hover:underline font-medium">Clear all</button>
          </div>
        )}

        {/* Count + refresh */}
        <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {resLoading ? 'Loading…' : `${sorted.length} properties`}
            {hasFilters && !resLoading && points.length !== sorted.length && (
              <span className="text-slate-400"> of {points.length}</span>
            )}
          </span>
          <button onClick={() => { fetchStats(); fetchResults() }} className="text-xs text-slate-400 hover:text-slate-700 transition">Refresh</button>
        </div>

        {/* Property list */}
        <div className="flex-1 overflow-y-auto">
          {resLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-10 px-4">
              {stats.total === 0 ? (
                <>
                  <p className="text-sm text-slate-400">No scan points yet.</p>
                  <p className="text-xs text-slate-400 mt-1">Go to the Map tab to draw a polygon first.</p>
                </>
              ) : running ? (
                <p className="text-sm text-slate-400">Results will appear here as the scan completes…</p>
              ) : hasFilters ? (
                <>
                  <p className="text-sm text-slate-500">No properties match your filters.</p>
                  <button onClick={() => { setMinScore(0); setSigFilter([]) }}
                    className="mt-2 text-xs text-brand-600 hover:underline">Clear filters</button>
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-400">No results yet.</p>
                  <p className="text-xs text-slate-400 mt-1">Click AI Driving to start the scan.</p>
                </>
              )}
            </div>
          ) : (
            sorted.map(pt => (
              <PropertyRow key={pt.id} point={pt} isSelected={selected?.id === pt.id}
                onClick={() => setSelected(prev => prev?.id === pt.id ? null : pt)} />
            ))
          )}
        </div>

        {/* Export */}
        <div className="p-4 border-t border-slate-200">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Export</p>
          <div className="flex gap-2">
            {exporting ? (
              <span className="text-xs text-slate-400">Exporting…</span>
            ) : (
              ['CSV', 'JSON', 'GEOJSON'].map(fmt => (
                <button key={fmt} onClick={() => handleExport(fmt)} className="flex-1 btn-outline py-1.5 text-xs">{fmt}</button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Right panel: image viewer ── */}
      <div className="flex-1 flex flex-col bg-slate-950 min-w-0">
        {selected ? (
          <>
            {/* Property header */}
            <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-start gap-4 shrink-0">
              <div className={`shrink-0 px-3 py-1.5 rounded-lg border text-center min-w-[3.5rem] ${scoreBorderColor(score)}`}>
                <p className={`text-xl font-bold tabular-nums leading-none ${scoreTextColor(score)}`}>{scoreLabel(score)}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">/ 100</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">
                  {selected.address || `${selected.lat.toFixed(5)}, ${selected.lng.toFixed(5)}`}
                </p>
                {signals.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {signals.map(sig => {
                      const s = SIGNAL_MAP[sig]
                      return s ? (
                        <span key={sig} className={`${SIGNAL_BADGE[s.severity]} text-[10px] px-1.5 py-0`}>{s.label}</span>
                      ) : null
                    })}
                  </div>
                )}
                {notes && <p className="text-xs text-slate-400 mt-1.5 leading-relaxed line-clamp-2">{notes}</p>}
              </div>
              <button onClick={() => setSelected(null)}
                className="shrink-0 p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Images */}
            <div className="flex-1 relative overflow-hidden">
              <div className="absolute inset-0 overflow-y-auto">
                {imgLoading ? (
                  <div className="flex justify-center py-16">
                    <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : selImages.filter(i => i.storage_url).length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
                    <svg className="w-10 h-10 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                    </svg>
                    <p className="text-sm text-slate-500">No images captured for this location</p>
                  </div>
                ) : (
                  <div className="p-4 space-y-3">
                    {selImages.filter(i => i.storage_url).map(img => (
                      <div key={img.id} className="rounded-xl overflow-hidden border border-slate-800 bg-slate-900 relative">
                        <img src={img.storage_url} alt={img.direction} className="w-full object-cover" loading="lazy" />
                        {img.image_source && (
                          <span
                            title={img.image_source === 'mapillary' ? 'Mapillary (free)' : 'Google Street View'}
                            className={`absolute top-2 right-2 px-1.5 py-0.5 text-[9px] font-bold rounded uppercase tracking-wider
                              ${img.image_source === 'mapillary'
                                ? 'bg-emerald-500/90 text-white'
                                : 'bg-blue-500/90 text-white'}`}
                          >
                            {img.image_source === 'mapillary' ? 'M' : 'G'}
                          </span>
                        )}
                        <div className="px-3 py-1.5">
                          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                            {img.direction === 'F' ? 'Facing' : img.direction}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <svg className="w-12 h-12 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
            <p className="text-sm text-slate-500">Select a property to view captured images</p>
          </div>
        )}
      </div>
    </div>
  )
}
