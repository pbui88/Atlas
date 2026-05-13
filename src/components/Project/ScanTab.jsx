import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { collectImages, analyzePoints, geocodePoints } from '../../lib/api'
import { chunkArray } from '../../lib/geo'

const BATCH_SIZE = 8
const AI_BATCH   = 5

function ProgressBar({ label, value, max, color = 'bg-brand-600' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-slate-500">
        <span>{label}</span>
        <span className="font-medium text-slate-700">{value.toLocaleString()} / {max.toLocaleString()}</span>
      </div>
      <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
        <div className={`h-1.5 rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function ScanTab({ project, onProjectUpdate }) {
  const [stats,    setStats]   = useState({ total: 0, pending: 0, downloaded: 0, complete: 0, failed: 0, no_coverage: 0 })
  const [running,  setRunning] = useState(false)
  const [phase,    setPhase]   = useState('')
  const [abortRef] = useState({ current: false })

  const PHASE_LABEL = {
    collecting: 'Collecting Street View images…',
    geocoding:  'Reverse geocoding addresses…',
    analyzing:  'Running AI distress analysis…',
  }

  const fetchStats = async () => {
    const { data } = await supabase
      .from('scan_points')
      .select('status')
      .eq('project_id', project.id)
    if (!data) return
    const counts = data.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc }, {})
    setStats({
      total:       data.length,
      pending:     counts.pending     || 0,
      downloaded:  counts.downloaded  || 0,
      complete:    counts.complete    || 0,
      failed:      counts.failed      || 0,
      no_coverage: counts.no_coverage || 0,
    })
  }

  useEffect(() => { fetchStats() }, [project.id])

  const runScan = async () => {
    abortRef.current = false
    setRunning(true)

    // Phase 1: collect images
    setPhase('collecting')
    try {
      const { data: pendingPoints } = await supabase
        .from('scan_points')
        .select('id')
        .eq('project_id', project.id)
        .in('status', ['pending', 'failed'])

      if (pendingPoints?.length) {
        const batches = chunkArray(pendingPoints.map(p => p.id), BATCH_SIZE)
        for (let i = 0; i < batches.length; i++) {
          if (abortRef.current) break
          try { await collectImages(project.id, batches[i]); await fetchStats() } catch { /* continue */ }
        }
      }
    } catch { /* continue */ }

    if (abortRef.current) { setRunning(false); setPhase(''); return }

    // Phase 2: reverse geocode
    setPhase('geocoding')
    try {
      const { data: dloaded } = await supabase
        .from('scan_points')
        .select('id')
        .eq('project_id', project.id)
        .eq('status', 'downloaded')
        .is('address', null)

      if (dloaded?.length) {
        const batches = chunkArray(dloaded.map(p => p.id), 20)
        for (const batch of batches) {
          if (abortRef.current) break
          try { await geocodePoints(project.id, batch) } catch { /* non-fatal */ }
        }
      }
    } catch { /* continue */ }

    if (abortRef.current) { setRunning(false); setPhase(''); return }

    // Phase 3: AI analysis
    setPhase('analyzing')
    try {
      const { data: toAnalyze } = await supabase
        .from('scan_points')
        .select('id')
        .eq('project_id', project.id)
        .eq('status', 'downloaded')

      if (toAnalyze?.length) {
        const batches = chunkArray(toAnalyze.map(p => p.id), AI_BATCH)
        for (let i = 0; i < batches.length; i++) {
          if (abortRef.current) break
          try { await analyzePoints(project.id, batches[i]); await fetchStats() } catch { /* continue */ }
        }
      }
    } catch { /* continue */ }

    setPhase('')
    setRunning(false)
    await fetchStats()
    onProjectUpdate?.()
  }

  const pause = () => { abortRef.current = true }

  const canStart = stats.total > 0 && !running

  return (
    <div className="flex flex-col h-full bg-slate-50">

      {/* Header bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Scan Progress</h3>
          {running && phase && (
            <p className="text-xs text-brand-600 mt-0.5">{PHASE_LABEL[phase]}</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {running && (
            <span className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin shrink-0" />
          )}
          {running ? (
            <button onClick={pause} className="btn border border-amber-300 text-amber-600 hover:bg-amber-50 bg-white">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
              </svg>
              Pause
            </button>
          ) : (
            <button onClick={runScan} disabled={!canStart} className="btn-primary">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
              </svg>
              AI Driving
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {stats.total === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <svg className="w-12 h-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c-.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
            </svg>
            <p className="text-sm text-slate-400">No scan points yet. Go to the Map tab to draw a polygon first.</p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-5">

            {/* Progress bars */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
              <ProgressBar label="Image collection" value={stats.downloaded + stats.complete} max={stats.total} />
              <ProgressBar label="AI analysis"      value={stats.complete}                   max={stats.total} color="bg-green-500" />
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total Points', value: stats.total,       color: 'text-slate-900' },
                { label: 'Pending',      value: stats.pending,     color: 'text-slate-500' },
                { label: 'Images Ready', value: stats.downloaded,  color: 'text-brand-600' },
                { label: 'AI Complete',  value: stats.complete,    color: 'text-green-600' },
                { label: 'No Coverage',  value: stats.no_coverage, color: 'text-slate-400' },
                { label: 'Failed',       value: stats.failed,      color: stats.failed > 0 ? 'text-red-500' : 'text-slate-400' },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500 mb-1">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value.toLocaleString()}</p>
                </div>
              ))}
            </div>

            <div className="flex justify-center">
              <button onClick={fetchStats} className="btn-ghost text-xs">Refresh stats</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
