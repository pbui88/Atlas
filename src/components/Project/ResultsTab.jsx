import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { collectImages, analyzePoints, geocodePoints, exportProject } from '../../lib/api'
import { chunkArray } from '../../lib/geo'
import { scoreLabel } from '../../lib/geo'
import { DISTRESS_SIGNALS, SIGNAL_BADGE } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'

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

function ProgressBar({ label, value, max, color = 'bg-brand-500' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-slate-500">
        <span>{label}</span>
        <span className="font-medium text-slate-300">{value} / {max}</span>
      </div>
      <div className="w-full bg-white/[0.06] rounded-full h-1.5 overflow-hidden">
        <div className={`h-1.5 rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function mapsUrl(lat, lng, address) {
  const q = address ? encodeURIComponent(address) : `${lat},${lng}`
  return `https://www.google.com/maps?q=${q}&layer=c&cbll=${lat},${lng}`
}

function PropertyRow({ point, isSelected, isChecked, onCheck, onClick }) {
  const score   = point.ai_analyses?.[0]?.overall_score
  const signals = point.ai_analyses?.[0]?.signals || []
  return (
    <div
      className={`px-3 py-3 border-b border-white/[0.04] transition-colors flex items-start gap-2 group ${
        isSelected ? 'bg-brand-600/10 border-l-2 border-l-brand-500' : 'hover:bg-white/[0.03]'
      }`}
    >
      <input
        type="checkbox"
        checked={isChecked}
        onChange={e => { e.stopPropagation(); onCheck(point.id) }}
        onClick={e => e.stopPropagation()}
        className="mt-1 shrink-0 accent-brand-600 cursor-pointer"
      />
      <div className="flex items-start gap-2 flex-1 min-w-0 cursor-pointer" onClick={onClick}>
        <span className={`text-base font-bold tabular-nums shrink-0 leading-tight mt-0.5 ${scoreTextColor(score)}`}>
          {scoreLabel(score)}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-200 font-medium truncate leading-snug">
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
      <a
        href={mapsUrl(point.lat, point.lng, point.address)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        title="Open Street View"
        className="shrink-0 mt-0.5 p-1 rounded text-slate-600 hover:text-brand-400 opacity-0 group-hover:opacity-100 transition-all"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
      </a>
    </div>
  )
}

export default function ResultsTab({ project, onProjectUpdate, autoStart = false, onAutoStartConsumed }) {
  const { usage, refreshUsage } = useAuth()
  const keyLoading   = usage === null
  const noKeyBlocked = usage !== null && !usage.has_own_key

  const RESULTS_LIMIT = 1000

  // ── Results state ──────────────────────────────────────────
  const [points,     setPoints]     = useState([])
  const [totalComplete, setTotalComplete] = useState(0)
  const [resLoading, setResLoading] = useState(true)
  const [selected,   setSelected]   = useState(null)
  const [minScore,   setMinScore]   = useState(0)
  const [sigFilter,  setSigFilter]  = useState([])
  const [exporting,  setExporting]  = useState(false)
  const [selImages,  setSelImages]  = useState([])
  const [imgLoading, setImgLoading] = useState(false)
  const [checkedIds, setCheckedIds] = useState(new Set())
  const selectAllRef = useRef(null)

  // ── Scan state ─────────────────────────────────────────────
  const [stats,      setStats]      = useState({ total: 0, pending: 0, downloaded: 0, analyzing: 0, complete: 0, failed: 0, no_coverage: 0 })
  const [running,    setRunning]    = useState(false)
  const [phase,      setPhase]      = useState('')
  const [scanError,  setScanError]  = useState(null)
  const [abortRef]   = useState({ current: false })
  const autoStarted        = useRef(false)
  const autoStartInitialRef = useRef(autoStart)

  // ── Data fetching ──────────────────────────────────────────
  const fetchStats = async () => {
    const { data } = await supabase.from('scan_points').select('status').eq('project_id', project.id)
    if (!data) return
    const c = data.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc }, {})
    setStats({ total: data.length, pending: c.pending || 0, downloaded: c.downloaded || 0, analyzing: c.analyzing || 0, complete: c.complete || 0, failed: c.failed || 0, no_coverage: c.no_coverage || 0 })
  }

  const fetchResults = useCallback(async () => {
    setResLoading(true)

    const { count } = await supabase
      .from('scan_points')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', project.id)
      .eq('status', 'complete')
    setTotalComplete(count || 0)

    const { data: pts } = await supabase
      .from('scan_points')
      .select('id, lat, lng, address, status, ai_analyses(scan_point_id, overall_score, confidence, signals, notes)')
      .eq('project_id', project.id)
      .eq('status', 'complete')
      .order('created_at')
      .limit(RESULTS_LIMIT)

    // Supabase returns ai_analyses as a single object (not array) for one-to-one relations.
    // Normalize to array so the rest of the code can use ai_analyses?.[0] consistently.
    setPoints((pts || []).map(pt => ({
      ...pt,
      ai_analyses: pt.ai_analyses
        ? (Array.isArray(pt.ai_analyses) ? pt.ai_analyses : [pt.ai_analyses])
        : [],
    })))
    setResLoading(false)
  }, [project.id])

  useEffect(() => { fetchStats(); fetchResults() }, [project.id])

  // Start scan once usage has loaded and key is confirmed.
  // Uses a ref for the initial autoStart value so the timeout is never
  // canceled when the parent clears the autoStart prop.
  useEffect(() => {
    if (!autoStartInitialRef.current) return
    if (keyLoading) return
    if (noKeyBlocked) return
    if (autoStarted.current) return
    autoStarted.current = true
    onAutoStartConsumed?.()       // signal parent only after committing
    const t = setTimeout(runScan, 300)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyLoading, noKeyBlocked])

  // Auto-start when returning to a project that has an incomplete scan.
  useEffect(() => {
    if (autoStarted.current) return
    if (running) return
    if (keyLoading) return
    if (noKeyBlocked) return
    if (stats.total === 0) return
    const incomplete = (stats.pending || 0) + (stats.failed || 0) + (stats.downloaded || 0) + (stats.analyzing || 0)
    if (incomplete === 0) return
    autoStarted.current = true
    runScan()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats.total, stats.pending, stats.failed, stats.downloaded, keyLoading, noKeyBlocked])

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
    setScanError(null)
    setRunning(true)

    // ── Phase 1: Collect Street View images ────────────────────
    setPhase('collecting')
    try {
      const { data: pending } = await supabase.from('scan_points').select('id')
        .eq('project_id', project.id).in('status', ['pending', 'failed'])
      if (pending?.length) {
        const chunks = chunkArray(pending.map(p => p.id), COLLECT_BATCH)
        let quotaHit = false
        for (let i = 0; i < chunks.length; i += COLLECT_CONCUR) {
          if (abortRef.current || quotaHit) break
          const results = await Promise.allSettled(
            chunks.slice(i, i + COLLECT_CONCUR).map(batch => collectImages(project.id, batch))
          )
          for (const r of results) {
            if (r.status === 'rejected') {
              const status = r.reason?.status
              if (status === 429 || status === 503) {
                setScanError(r.reason.message)
                abortRef.current = true
                quotaHit = true
                if (status === 429) refreshUsage()
                break
              }
            }
          }
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
        .eq('project_id', project.id).in('status', ['downloaded', 'analyzing'])
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

  // ── Checkbox selection ─────────────────────────────────────
  const toggleCheck = (id) => setCheckedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  // Filter / sort ──────────────────────────────────────────
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

  const allChecked  = sorted.length > 0 && sorted.every(pt => checkedIds.has(pt.id))
  const someChecked = sorted.some(pt => checkedIds.has(pt.id))
  const checkedCount = sorted.filter(pt => checkedIds.has(pt.id)).length

  // Sync indeterminate state on the select-all checkbox
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someChecked && !allChecked
    }
  }, [someChecked, allChecked])

  const toggleAll = () => {
    if (allChecked) {
      setCheckedIds(new Set())
    } else {
      setCheckedIds(new Set(sorted.map(pt => pt.id)))
    }
  }

  // Build export payload from local data (used for selected-only exports)
  const buildLocalExport = (pts, format) => {
    if (format === 'CSV') {
      const header = 'address,distress_score,confidence,signals,notes'
      const rows = pts.map(pt => {
        const a = pt.ai_analyses?.[0] || {}
        return [
          `"${(pt.address || '').replace(/"/g, '""')}"`,
          a.overall_score ?? '', a.confidence ?? '',
          `"${(a.signals || []).join('; ')}"`,
          `"${(a.notes || '').replace(/"/g, '""')}"`,
        ].join(',')
      })
      return { data: [header, ...rows].join('\n'), type: 'text/csv', ext: 'csv' }
    }
    if (format === 'JSON') {
      const data = pts.map(pt => ({
        id: pt.id, lat: pt.lat, lng: pt.lng, address: pt.address,
        distressScore: pt.ai_analyses?.[0]?.overall_score,
        confidence:    pt.ai_analyses?.[0]?.confidence,
        signals:       pt.ai_analyses?.[0]?.signals || [],
        notes:         pt.ai_analyses?.[0]?.notes,
      }))
      return { data: JSON.stringify(data, null, 2), type: 'application/json', ext: 'json' }
    }
    const geojson = {
      type: 'FeatureCollection',
      features: pts.map(pt => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] },
        properties: {
          id: pt.id, address: pt.address,
          distressScore: pt.ai_analyses?.[0]?.overall_score,
          confidence:    pt.ai_analyses?.[0]?.confidence,
          signals:       pt.ai_analyses?.[0]?.signals || [],
          notes:         pt.ai_analyses?.[0]?.notes,
        },
      })),
    }
    return { data: JSON.stringify(geojson, null, 2), type: 'application/json', ext: 'json' }
  }

  // ── Export ─────────────────────────────────────────────────
  const handleExport = async (format) => {
    const selectedPts = checkedCount > 0 ? sorted.filter(pt => checkedIds.has(pt.id)) : null

    // Client-side export for selected rows
    if (selectedPts) {
      const { data, type, ext } = buildLocalExport(selectedPts, format)
      const blob = new Blob([data], { type })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `${project.name.replace(/\s+/g, '_')}_${checkedCount}_selected.${format === 'CSV' ? 'csv' : 'json'}`
      a.click()
      URL.revokeObjectURL(url)
      return
    }

    // Server-side export for all filtered results
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
  const canStart    = stats.total > 0 && !running && !noKeyBlocked && !keyLoading
  const analysis    = selected?.ai_analyses?.[0]
  const score       = analysis?.overall_score
  const signals     = analysis?.signals || []
  const notes       = analysis?.notes

  return (
    <div className="flex flex-col md:flex-row h-full">

      {/* ── Left panel ── hidden on mobile when a property is selected */}
      <div className={`${selected ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 bg-navy-800 border-b md:border-b-0 md:border-r border-white/[0.06] shrink-0`}>

        {/* Results header */}
        <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">Results</h3>
            {running && phase && (
              <p className="text-[11px] text-brand-600 mt-0.5 truncate">{PHASE_LABEL[phase]}</p>
            )}
            {keyLoading && !running && (
              <p className="text-[11px] text-slate-500 mt-0.5 truncate">Loading account…</p>
            )}
            {noKeyBlocked && !running && (
              <p className="text-[11px] text-amber-500 mt-0.5 truncate">No API key — go to Settings</p>
            )}
            {scanError && !running && (
              <p className="text-[11px] text-red-500 mt-0.5 truncate">Scan stopped — {scanError.includes('key') ? 'no API key' : 'quota reached'}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {running && (
              <>
                <span className="w-3.5 h-3.5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                <button onClick={pause} className="btn border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-xs px-2.5 py-1.5">
                  Pause
                </button>
              </>
            )}
          </div>
        </div>

        {/* Progress bars — shown while running or when scan has started */}
        {stats.total > 0 && (
          <div className="px-4 py-3 border-b border-white/[0.06] space-y-2.5">
            <ProgressBar label="Collecting Property Images" value={stats.downloaded + stats.analyzing + stats.complete} max={stats.total} />
            <ProgressBar label="Atlas Analyzing" value={stats.complete} max={stats.total} color="bg-green-500" />
          </div>
        )}

        {/* Filters — only shown once there are results */}
        {points.length > 0 && (
          <div className="px-4 py-3 border-b border-white/[0.06] space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Min Score</span>
                <span className="text-xs font-bold text-slate-200 tabular-nums">{minScore}</span>
              </div>
              <input type="range" min={0} max={90} step={5} value={minScore}
                onChange={e => setMinScore(+e.target.value)} className="w-full accent-brand-500" />
            </div>
            <div className="flex flex-wrap gap-1">
              {DISTRESS_SIGNALS.map(sig => (
                <button key={sig.id} onClick={() => toggleSignal(sig.id)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                    sigFilter.includes(sig.id)
                      ? 'bg-brand-600 border-brand-600 text-white'
                      : 'bg-white/[0.04] border-white/[0.10] text-slate-400 hover:border-brand-500/50 hover:text-brand-400'
                  }`}>
                  {sig.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Active filter chips */}
        {hasFilters && (
          <div className="px-4 py-2 bg-brand-600/10 border-b border-brand-600/20 flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-brand-400 uppercase tracking-widest shrink-0">Active:</span>
            {minScore > 0 && (
              <button onClick={() => setMinScore(0)}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/[0.06] border border-brand-500/30 rounded-full text-[11px] text-brand-400 hover:bg-brand-600/20 transition">
                Score ≥ {minScore}<span className="font-bold ml-0.5">×</span>
              </button>
            )}
            {sigFilter.map(sig => (
              <button key={sig} onClick={() => toggleSignal(sig)}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/[0.04] border border-white/[0.10] rounded-full text-[11px] text-slate-400 hover:bg-white/[0.08] transition">
                {SIGNAL_MAP[sig]?.label}<span className="font-bold ml-0.5">×</span>
              </button>
            ))}
            <button onClick={() => { setMinScore(0); setSigFilter([]) }}
              className="ml-auto text-[11px] text-brand-400 hover:underline font-medium">Clear all</button>
          </div>
        )}

        {/* Count + select-all + refresh */}
        <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2">
          {sorted.length > 0 && (
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              className="shrink-0 accent-brand-600 cursor-pointer"
              title={allChecked ? 'Deselect all' : 'Select all'}
            />
          )}
          <span className="text-xs text-slate-500 flex-1">
            {resLoading ? 'Loading…' : checkedCount > 0
              ? <span className="font-medium text-brand-600">{checkedCount} selected</span>
              : `${sorted.length} properties`
            }
            {!resLoading && checkedCount === 0 && hasFilters && points.length !== sorted.length && (
              <span className="text-slate-400"> of {points.length}</span>
            )}
            {!resLoading && totalComplete > RESULTS_LIMIT && (
              <span className="text-amber-500 ml-1" title={`Showing top ${RESULTS_LIMIT} by score. ${totalComplete.toLocaleString()} total.`}>
                (top {RESULTS_LIMIT.toLocaleString()})
              </span>
            )}
          </span>
          <button onClick={() => { fetchStats(); fetchResults() }} className="text-xs text-slate-500 hover:text-slate-300 transition">Refresh</button>
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
                  <p className="text-sm text-slate-400">No properties scan yet.</p>
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
              ) : (stats.pending || 0) + (stats.failed || 0) + (stats.downloaded || 0) + (stats.analyzing || 0) > 0 ? (
                <p className="text-sm text-slate-400">Starting scan…</p>
              ) : (
                <p className="text-sm text-slate-400">No results yet.</p>
              )}
            </div>
          ) : (
            sorted.map(pt => (
              <PropertyRow
                key={pt.id}
                point={pt}
                isSelected={selected?.id === pt.id}
                isChecked={checkedIds.has(pt.id)}
                onCheck={toggleCheck}
                onClick={() => setSelected(prev => prev?.id === pt.id ? null : pt)}
              />
            ))
          )}
        </div>

        {/* Export */}
        <div className="p-4 border-t border-white/[0.06]">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Export</p>
            {checkedCount > 0 && (
              <span className="text-[10px] text-brand-600 font-medium">{checkedCount} selected</span>
            )}
          </div>
          <div className="flex gap-2">
            {exporting ? (
              <span className="text-xs text-slate-400">Exporting…</span>
            ) : (
              ['CSV'].map(fmt => (
                <button key={fmt} onClick={() => handleExport(fmt)} className="flex-1 btn-outline py-1.5 text-xs">
                  Download
                </button>
              ))
            )}
          </div>
          {checkedCount === 0 && sorted.length > 0 && (
            <p className="text-[10px] text-slate-400 mt-1.5">Check rows to export a subset</p>
          )}
        </div>
      </div>

      {/* ── Right panel: image viewer — hidden on mobile when nothing selected ── */}
      <div className={`${selected ? 'flex' : 'hidden md:flex'} flex-1 flex-col bg-slate-950 min-w-0`}>
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
              <a
                href={mapsUrl(selected.lat, selected.lng, selected.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] text-slate-300 hover:text-white transition text-xs font-medium"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
                Street View
              </a>
              <button onClick={() => setSelected(null)}
                className="shrink-0 flex items-center gap-1 p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition">
                <svg className="w-4 h-4 md:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
                <span className="text-xs font-medium md:hidden">Back</span>
                <svg className="w-4 h-4 hidden md:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
