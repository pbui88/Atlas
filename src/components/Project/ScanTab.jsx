import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { collectImages, analyzePoints, geocodePoints } from '../../lib/api'
import { chunkArray } from '../../lib/geo'
import { PROJECT_STATUS } from '../../lib/constants'

const BATCH_SIZE = 8   // points per Netlify function call
const AI_BATCH   = 5   // points per AI analysis call

function StatusRow({ label, value, sub, accent = false }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-slate-400">{label}</span>
      <div className="text-right">
        <span className={`text-sm font-semibold ${accent ? 'text-brand-400' : 'text-slate-200'}`}>{value}</span>
        {sub && <span className="text-xs text-slate-600 ml-1">{sub}</span>}
      </div>
    </div>
  )
}

function ProgressBar({ value, max, color = 'bg-brand-600' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
      <div
        className={`h-2 rounded-full transition-all duration-300 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function LogLine({ text, type = 'info' }) {
  const colors = { info: 'text-slate-400', success: 'text-green-400', error: 'text-red-400', warn: 'text-yellow-400' }
  return (
    <p className={`text-xs font-mono ${colors[type]}`}>
      <span className="text-slate-600">{new Date().toLocaleTimeString()} </span>
      {text}
    </p>
  )
}

export default function ScanTab({ project, onProjectUpdate }) {
  const [stats,    setStats]    = useState({ total: 0, pending: 0, downloaded: 0, complete: 0, failed: 0, no_coverage: 0 })
  const [running,  setRunning]  = useState(false)
  const [phase,    setPhase]    = useState('')   // 'collecting' | 'geocoding' | 'analyzing' | ''
  const [logs,     setLogs]     = useState([])
  const [abortRef] = useState({ current: false })
  const logEndRef  = useRef(null)

  const log = (text, type = 'info') => {
    setLogs(l => [...l.slice(-100), { text, type, id: Date.now() + Math.random() }])
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
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [logs])

  const runScan = async () => {
    abortRef.current = false
    setRunning(true)
    log('Starting image collection…', 'info')

    // ── Phase 1: Collect Street View Images ──────────────────
    setPhase('collecting')
    try {
      const { data: pendingPoints } = await supabase
        .from('scan_points')
        .select('id')
        .eq('project_id', project.id)
        .in('status', ['pending', 'failed'])

      if (!pendingPoints?.length) {
        log('No pending points to collect.', 'warn')
      } else {
        log(`Collecting images for ${pendingPoints.length} points in batches of ${BATCH_SIZE}…`)
        const batches = chunkArray(pendingPoints.map(p => p.id), BATCH_SIZE)

        for (let i = 0; i < batches.length; i++) {
          if (abortRef.current) { log('Scan paused.', 'warn'); break }
          try {
            await collectImages(project.id, batches[i])
            await fetchStats()
            log(`Batch ${i + 1}/${batches.length} done`, 'success')
          } catch (err) {
            log(`Batch ${i + 1} error: ${err.message}`, 'error')
          }
        }
      }
    } catch (err) {
      log(`Collection error: ${err.message}`, 'error')
    }

    if (abortRef.current) { setRunning(false); setPhase(''); return }

    // ── Phase 2: Reverse Geocode ──────────────────────────────
    setPhase('geocoding')
    log('Running reverse geocoding…')
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
    } catch { /* non-fatal */ }

    if (abortRef.current) { setRunning(false); setPhase(''); return }

    // ── Phase 3: AI Analysis ──────────────────────────────────
    setPhase('analyzing')
    log('Starting AI analysis…')
    try {
      const { data: toAnalyze } = await supabase
        .from('scan_points')
        .select('id')
        .eq('project_id', project.id)
        .eq('status', 'downloaded')

      if (!toAnalyze?.length) {
        log('No points ready for analysis.', 'warn')
      } else {
        log(`Analyzing ${toAnalyze.length} points…`)
        const batches = chunkArray(toAnalyze.map(p => p.id), AI_BATCH)
        for (let i = 0; i < batches.length; i++) {
          if (abortRef.current) { log('Analysis paused.', 'warn'); break }
          try {
            await analyzePoints(project.id, batches[i])
            await fetchStats()
            log(`Analysis batch ${i + 1}/${batches.length} done`, 'success')
          } catch (err) {
            log(`Analysis batch ${i + 1} error: ${err.message}`, 'error')
          }
        }
      }
    } catch (err) {
      log(`Analysis error: ${err.message}`, 'error')
    }

    log('Scan complete!', 'success')
    setPhase('')
    setRunning(false)
    await fetchStats()
    onProjectUpdate?.()
  }

  const pause = () => { abortRef.current = true }

  const isActive = ['collecting', 'analyzing', 'geocoding'].includes(project.status)
  const canStart = stats.total > 0 && !running

  const phaseLabel = {
    collecting: 'Downloading Street View images…',
    geocoding:  'Reverse geocoding addresses…',
    analyzing:  'Running AI distress analysis…',
    '':         '',
  }

  return (
    <div className="flex h-full">
      {/* Left: controls + stats */}
      <div className="w-80 bg-slate-950 border-r border-slate-800 flex flex-col">
        <div className="p-4 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-slate-200">Scan Progress</h3>
          {phase && <p className="text-xs text-brand-400 mt-0.5 animate-pulse">{phaseLabel[phase]}</p>}
        </div>

        <div className="flex-1 p-4 space-y-5 overflow-y-auto">
          {stats.total === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">
              No scan points generated yet. Go to the Map tab first.
            </p>
          ) : (
            <>
              {/* Overall progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Image collection</span>
                  <span>{stats.downloaded + stats.complete} / {stats.total}</span>
                </div>
                <ProgressBar value={stats.downloaded + stats.complete} max={stats.total} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>AI analysis</span>
                  <span>{stats.complete} / {stats.total}</span>
                </div>
                <ProgressBar value={stats.complete} max={stats.total} color="bg-green-600" />
              </div>

              <div className="divider" />

              {/* Point stats */}
              <div className="divide-y divide-slate-800">
                <StatusRow label="Total points" value={stats.total.toLocaleString()} />
                <StatusRow label="Pending"      value={stats.pending.toLocaleString()} />
                <StatusRow label="Images ready" value={stats.downloaded.toLocaleString()} accent />
                <StatusRow label="AI complete"  value={stats.complete.toLocaleString()} accent />
                <StatusRow label="No coverage"  value={stats.no_coverage.toLocaleString()} />
                {stats.failed > 0 && <StatusRow label="Failed" value={stats.failed.toLocaleString()} />}
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-slate-800 space-y-3">
          {running ? (
            <button onClick={pause} className="btn-outline w-full border-yellow-600/50 text-yellow-400 hover:bg-yellow-600/10">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
              </svg>
              Pause
            </button>
          ) : (
            <button onClick={runScan} disabled={!canStart} className="btn-primary w-full">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
              </svg>
              {stats.complete === stats.total && stats.total > 0 ? 'Re-scan' : 'Start Scan'}
            </button>
          )}
          <button
            onClick={fetchStats}
            className="btn-ghost w-full text-xs"
          >
            Refresh stats
          </button>
        </div>
      </div>

      {/* Right: activity log */}
      <div className="flex-1 bg-slate-950 flex flex-col">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Activity Log</h4>
          <button onClick={() => setLogs([])} className="text-xs text-slate-600 hover:text-slate-400 transition">
            Clear
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-1 font-mono bg-slate-950">
          {logs.length === 0 ? (
            <p className="text-xs text-slate-700 font-mono">Waiting for scan to start…</p>
          ) : (
            logs.map(l => <LogLine key={l.id} text={l.text} type={l.type} />)
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  )
}
