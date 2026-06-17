import { useState, useEffect, useRef, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  getSkipTraceRecords,
  saveSkipTraceRecords,
  deleteSkipTraceRecord,
  submitSkipTrace,
  checkSkipTraceResults,
} from '../../lib/api'

// ── CSV parser ────────────────────────────────────────────────
function splitFullAddress(full) {
  const cleaned = full.replace(/,?\s*(United States|USA|US)\s*$/, '').trim()
  const parts   = cleaned.split(',').map(s => s.trim()).filter(Boolean)
  const stateZip = parts[parts.length - 1] || ''
  const m = stateZip.match(/^([A-Z]{2})\s+(\d{5}(-\d{4})?)$/)
  return {
    address:    parts[0] || full,
    city:       m && parts.length >= 3 ? parts[parts.length - 2] : (parts[1] || null),
    state_code: m ? m[1] : null,
    zip:        m ? m[2] : null,
  }
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const col = (...names) => {
    const idx = headers.findIndex(h => names.includes(h))
    return idx >= 0 ? idx : -1
  }
  const addrIdx  = col('address', 'street', 'property_address')
  const cityIdx  = col('city', 'property_city')
  const stateIdx = col('state', 'state_code', 'property_state')
  const zipIdx   = col('zip', 'zip_code', 'postal_code', 'property_zip')

  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    const rawAddr = addrIdx >= 0 ? cols[addrIdx] || '' : ''
    if (!rawAddr) return null
    if (cityIdx >= 0 || stateIdx >= 0 || zipIdx >= 0) {
      return {
        address:    rawAddr,
        city:       cityIdx  >= 0 ? cols[cityIdx]  || null : null,
        state_code: stateIdx >= 0 ? cols[stateIdx] || null : null,
        zip:        zipIdx   >= 0 ? cols[zipIdx]   || null : null,
      }
    }
    return splitFullAddress(rawAddr)
  }).filter(Boolean).filter(r => r.address)
}

// ── Status badge ──────────────────────────────────────────────
function StatusBadge({ status }) {
  const cfg = {
    saved:      { label: 'Saved',      cls: 'bg-slate-700 text-slate-300' },
    submitted:  { label: 'Submitted',  cls: 'bg-blue-500/20 text-blue-400 border border-blue-500/30' },
    processing: { label: 'Processing', cls: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' },
    completed:  { label: 'Completed',  cls: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' },
    failed:     { label: 'Failed',     cls: 'bg-red-500/20 text-red-400 border border-red-500/30' },
  }[status] || { label: status, cls: 'bg-slate-700 text-slate-400' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

// ── Main page ─────────────────────────────────────────────────
export default function SkipTracePage() {
  const { openSidebar } = useOutletContext()
  const { user } = useAuth()

  const [records,         setRecords]         = useState([])
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState(null)
  const [checkedIds,      setCheckedIds]      = useState(new Set())
  const [traceType,       setTraceType]       = useState('advanced')
  const [submitting,      setSubmitting]      = useState(false)
  const [submitResult,    setSubmitResult]    = useState(null)
  const [submitError,     setSubmitError]     = useState(null)
  const [uploading,       setUploading]       = useState(false)
  const [uploadError,     setUploadError]     = useState(null)
  const [deletingId,      setDeletingId]      = useState(null)
  const [showConfirm,     setShowConfirm]     = useState(false)
  const [checking,        setChecking]        = useState(false)
  const [checkResult,     setCheckResult]     = useState(null)
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { records: data } = await getSkipTraceRecords()
      setRecords(data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Realtime subscription ─────────────────────────────────
  useEffect(() => {
    if (!user?.id) return
    const channel = supabase
      .channel('skip-trace-live')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'skip_trace_records', filter: `user_id=eq.${user.id}` },
        (payload) => {
          setRecords(prev => prev.map(r => r.id === payload.new.id ? { ...r, ...payload.new } : r))
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user?.id])

  // ── Selection helpers ─────────────────────────────────────
  const savedRecords   = records.filter(r => r.status === 'saved')
  const savedIds       = new Set(savedRecords.map(r => r.id))
  const checkedSaved   = [...checkedIds].filter(id => savedIds.has(id))
  const creditsPerLead = traceType === 'advanced' ? 2 : 1

  const toggleCheck = (id) => {
    setCheckedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Grouping ──────────────────────────────────────────────
  const groups = (() => {
    const map = new Map()
    for (const r of records) {
      const key = r.list_name || '__uncategorized__'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(r)
    }
    const entries = [...map.entries()]
    entries.sort(([a], [b]) => {
      if (a === '__uncategorized__') return 1
      if (b === '__uncategorized__') return -1
      return a.localeCompare(b)
    })
    return entries.map(([key, recs]) => ({
      key,
      name:           key === '__uncategorized__' ? 'Uncategorized' : key,
      records:        recs,
      savedCount:     recs.filter(r => r.status === 'saved').length,
      completedCount: recs.filter(r => r.status === 'completed').length,
      submittedCount: recs.filter(r => ['submitted', 'processing'].includes(r.status)).length,
    }))
  })()

  const toggleGroupCollapse = (key) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const toggleGroupAll = (group) => {
    const groupSavedIds = group.records.filter(r => r.status === 'saved').map(r => r.id)
    const allChecked = groupSavedIds.length > 0 && groupSavedIds.every(id => checkedIds.has(id))
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (allChecked) {
        groupSavedIds.forEach(id => next.delete(id))
      } else {
        groupSavedIds.forEach(id => next.add(id))
      }
      return next
    })
  }

  // ── CSV upload ────────────────────────────────────────────
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploadError(null)
    setUploading(true)
    try {
      const text   = await file.text()
      const parsed = parseCSV(text)
      if (!parsed.length) throw new Error('No valid records found. Check that your CSV has an "address" column.')
      const listName = file.name.replace(/\.csv$/i, '')
      const { count } = await saveSkipTraceRecords(parsed, listName)
      await load()
      setSubmitResult({ message: `${count} record${count !== 1 ? 's' : ''} added from "${listName}".` })
    } catch (e) {
      setUploadError(e.message)
    } finally {
      setUploading(false)
    }
  }

  // ── Delete ────────────────────────────────────────────────
  const handleDelete = async (id) => {
    setDeletingId(id)
    try {
      await deleteSkipTraceRecord(id)
      setRecords(prev => prev.filter(r => r.id !== id))
      setCheckedIds(prev => { const n = new Set(prev); n.delete(id); return n })
    } catch (e) {
      alert(e.message)
    } finally {
      setDeletingId(null)
    }
  }

  // ── Check Results ─────────────────────────────────────────
  const handleCheckResults = async () => {
    setChecking(true)
    setCheckResult(null)
    try {
      const res = await checkSkipTraceResults()
      setCheckResult(res)
      if (res.recordsUpdated > 0) await load()
    } catch (e) {
      setCheckResult({ error: e.message })
    } finally {
      setChecking(false)
    }
  }

  // ── Submit ────────────────────────────────────────────────
  const handleSubmit = async () => {
    setShowConfirm(false)
    if (!checkedSaved.length) return
    setSubmitting(true)
    setSubmitError(null)
    setSubmitResult(null)
    try {
      const res = await submitSkipTrace(checkedSaved, traceType)
      setSubmitResult(res)
      setCheckedIds(new Set())
      await load()
    } catch (e) {
      setSubmitError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-full bg-slate-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={openSidebar}
            className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.05] transition lg:hidden shrink-0"
            aria-label="Open navigation"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-7 h-7 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center text-brand-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Skip Trace</h1>
            </div>
            <p className="text-sm text-slate-500">Find property owner contact info — powered by Tracerfy</p>
          </div>

          {/* Action buttons */}
          <div className="shrink-0 flex items-center gap-2">
            {records.some(r => r.status === 'submitted' || r.status === 'processing') && (
              <button
                onClick={handleCheckResults}
                disabled={checking}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600/10 border border-emerald-600/25 text-sm text-emerald-400 hover:bg-emerald-600/20 hover:text-emerald-300 transition disabled:opacity-50"
              >
                {checking ? (
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                )}
                Check Results
              </button>
            )}

            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] text-sm text-slate-300 hover:text-white hover:bg-white/[0.08] transition disabled:opacity-50"
            >
              {uploading ? (
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              )}
              Upload CSV
            </button>
          </div>
        </div>

        {/* Banners */}
        {submitResult?.message && (
          <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3.5 mb-5">
            <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
            <p className="text-sm text-emerald-300 font-medium flex-1">{submitResult.message}</p>
            <button onClick={() => setSubmitResult(null)} className="text-emerald-600 hover:text-emerald-400 p-1"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
        )}
        {submitResult && !submitResult.message && (
          <div className="flex items-start gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3.5 mb-5">
            <svg className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
            <div className="flex-1">
              <p className="text-sm text-emerald-300 font-medium">
                <span className="font-bold">{submitResult.recordCount} record{submitResult.recordCount !== 1 ? 's' : ''}</span> submitted to Tracerfy ({submitResult.traceType}).
              </p>
              <p className="text-xs text-emerald-600 mt-0.5">
                Results will appear here once Tracerfy finishes. This typically takes a few minutes.
              </p>
            </div>
            <button onClick={() => setSubmitResult(null)} className="text-emerald-600 hover:text-emerald-400 p-1 shrink-0"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
        )}
        {(submitError || uploadError) && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3.5 mb-5">
            <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
            <p className="text-sm text-red-300 font-medium flex-1">{submitError || uploadError}</p>
            <button onClick={() => { setSubmitError(null); setUploadError(null) }} className="text-red-500 hover:text-red-300 p-1"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
        )}
        {checkResult && !checkResult.error && (
          <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3.5 mb-5">
            <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
            <p className="text-sm text-emerald-300 font-medium flex-1">
              {checkResult.completed === 0
                ? 'No completed batches yet — Tracerfy is still processing. Try again in a few minutes.'
                : <>
                    <span className="font-bold">{checkResult.completed} batch{checkResult.completed !== 1 ? 'es' : ''}</span> completed.
                    {checkResult.recordsUpdated > 0
                      ? <> <span className="font-bold">{checkResult.recordsUpdated} record{checkResult.recordsUpdated !== 1 ? 's' : ''}</span> updated with owner info.</>
                      : ' No contact matches found for these properties.'}
                  </>}
            </p>
            <button onClick={() => setCheckResult(null)} className="text-emerald-600 hover:text-emerald-400 p-1 shrink-0"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
        )}
        {checkResult?.error && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3.5 mb-5">
            <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
            <p className="text-sm text-red-300 font-medium flex-1">{checkResult.error}</p>
            <button onClick={() => setCheckResult(null)} className="text-red-500 hover:text-red-300 p-1"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
        )}

        {/* CSV format hint */}
        <div className="flex items-start gap-2.5 bg-white/[0.02] border border-white/[0.05] rounded-xl px-4 py-3 mb-6 text-xs text-slate-500">
          <svg className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
          <span>
            CSV columns: <span className="text-slate-400 font-mono">address</span>, <span className="text-slate-400 font-mono">city</span>, <span className="text-slate-400 font-mono">state</span>, <span className="text-slate-400 font-mono">zip</span>.
            Only <span className="text-slate-400 font-mono">address</span> is required. The filename becomes the list name.
            Records saved from scan results are grouped by the name you choose when saving.
          </span>
        </div>

        {/* Sticky cost bar */}
        {checkedSaved.length > 0 && (
          <div className="sticky top-4 z-10 flex items-center justify-between gap-4 bg-navy-900/95 backdrop-blur border border-brand-600/30 rounded-2xl px-5 py-3.5 mb-6 shadow-lg shadow-brand-600/10">
            <div>
              <p className="text-sm font-semibold text-white">
                {checkedSaved.length} record{checkedSaved.length !== 1 ? 's' : ''} selected
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                <span className="text-brand-400 font-bold">{creditsPerLead} Tracerfy credit{creditsPerLead > 1 ? 's' : ''}</span> per record
                {traceType === 'advanced' && <span className="text-slate-600"> · includes owner name</span>}
                <span className="text-slate-600"> · ~{creditsPerLead * checkedSaved.length} credits total</span>
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-3">
              <div className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.08] rounded-lg p-1">
                {['normal', 'advanced'].map(t => (
                  <button
                    key={t}
                    onClick={() => setTraceType(t)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all capitalize ${
                      traceType === t ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowConfirm(true)}
                disabled={submitting}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold transition shadow-md shadow-brand-600/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Submitting…</>
                ) : (
                  <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>Run Skip Trace</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Confirm dialog */}
        {showConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="bg-navy-900 border border-white/[0.08] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
              <h3 className="text-base font-bold text-white mb-3">Confirm Skip Trace</h3>
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-5 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Records</span>
                  <span className="text-white font-semibold">{checkedSaved.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Type</span>
                  <span className="text-white font-semibold capitalize">{traceType}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Cost</span>
                  <span className="text-brand-400 font-bold">~{creditsPerLead * checkedSaved.length} Tracerfy credits</span>
                </div>
                <div className="pt-1 border-t border-white/[0.06]">
                  <p className="text-[11px] text-slate-600">
                    {traceType === 'advanced'
                      ? 'Advanced returns owner name, phones & emails (2 credits/lead).'
                      : 'Normal returns phones & emails only (1 credit/lead).'}
                    {' '}Credits charged per matched lead — no charge on misses.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowConfirm(false)} className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.05] text-sm font-medium transition">Cancel</button>
                <button onClick={handleSubmit} className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold transition shadow-md shadow-brand-600/30">Confirm</button>
              </div>
            </div>
          </div>
        )}

        {/* Records grouped by list */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-7 h-7 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-red-400 text-sm mb-3">{error}</p>
            <button onClick={load} className="text-xs text-brand-600 hover:underline">Retry</button>
          </div>
        ) : records.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-4">
            {groups.map(group => {
              const isCollapsed   = collapsedGroups.has(group.key)
              const groupSavedIds = group.records.filter(r => r.status === 'saved').map(r => r.id)
              const allGroupChecked = groupSavedIds.length > 0 && groupSavedIds.every(id => checkedIds.has(id))

              return (
                <div key={group.key} className="bg-slate-900/50 border border-white/[0.06] rounded-2xl overflow-hidden">
                  {/* Group header */}
                  <div className="px-4 py-3 border-b border-white/[0.05] flex items-center gap-3">
                    {groupSavedIds.length > 0 && (
                      <input
                        type="checkbox"
                        checked={allGroupChecked}
                        onChange={() => toggleGroupAll(group)}
                        className="accent-brand-600 cursor-pointer shrink-0"
                        title={allGroupChecked ? 'Deselect all in list' : 'Select all saved in list'}
                      />
                    )}
                    <button
                      onClick={() => toggleGroupCollapse(group.key)}
                      className="flex-1 flex items-center gap-2.5 text-left min-w-0"
                    >
                      <span className="text-sm font-semibold text-white truncate">{group.name}</span>
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                        <span className="text-[10px] text-slate-600">{group.records.length} record{group.records.length !== 1 ? 's' : ''}</span>
                        {group.savedCount > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700/80 text-slate-300 font-medium">{group.savedCount} ready</span>
                        )}
                        {group.submittedCount > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 font-medium">{group.submittedCount} processing</span>
                        )}
                        {group.completedCount > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-medium">{group.completedCount} done</span>
                        )}
                      </div>
                      <svg
                        className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ml-auto ${isCollapsed ? '' : 'rotate-180'}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>
                  </div>

                  {/* Records */}
                  {!isCollapsed && (
                    <div className="divide-y divide-white/[0.04]">
                      {group.records.map(record => (
                        <RecordRow
                          key={record.id}
                          record={record}
                          checked={checkedIds.has(record.id)}
                          onCheck={toggleCheck}
                          onDelete={handleDelete}
                          deletingId={deletingId}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Global refresh */}
            <div className="text-center">
              <button onClick={load} className="text-xs text-slate-600 hover:text-slate-400 transition">↺ Refresh all</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function RecordRow({ record, checked, onCheck, onDelete, deletingId }) {
  const isSaved    = record.status === 'saved'
  const isDeleting = deletingId === record.id

  return (
    <div className={`flex items-start gap-3 px-4 py-3 transition-colors ${isSaved && checked ? 'bg-brand-600/5' : 'hover:bg-white/[0.02]'}`}>
      <div className="shrink-0 pt-0.5 w-4">
        {isSaved ? (
          <input type="checkbox" checked={checked} onChange={() => onCheck(record.id)} className="accent-brand-600 cursor-pointer" />
        ) : <span />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200 truncate font-medium">
          {record.address
            ? [record.address, record.city, record.state_code && record.zip ? `${record.state_code} ${record.zip}` : (record.state_code || record.zip)].filter(Boolean).join(', ')
            : <span className="text-slate-500 italic">No address</span>}
        </p>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[10px] text-slate-700">{new Date(record.created_at).toLocaleDateString()}</span>
        </div>
        {record.status === 'completed' && record.result && (
          <ContactResult result={record.result} />
        )}
      </div>

      <div className="shrink-0 flex items-center gap-2">
        <StatusBadge status={record.status} />
        {isSaved && (
          <button
            onClick={() => onDelete(record.id)}
            disabled={isDeleting}
            className="p-1 rounded text-slate-600 hover:text-red-400 transition disabled:opacity-40"
            title="Remove"
          >
            {isDeleting ? (
              <span className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin block" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

const PHONE_TAG = {
  primary:  { label: 'Primary',  cls: 'bg-brand-600/20 text-brand-400' },
  mobile:   { label: 'Mobile',   cls: 'bg-blue-500/15 text-blue-400' },
  landline: { label: 'Landline', cls: 'bg-slate-600/60 text-slate-400' },
}

function ContactResult({ result }) {
  // phones may be objects {number, type} (new format) or plain strings (legacy)
  const rawPhones = result.phones || []
  const phones = rawPhones.map(p =>
    typeof p === 'string' ? { number: p, type: 'mobile' } : p
  )
  const emails = result.emails || []

  if (!result.full_name && !phones.length && !emails.length) {
    return <p className="text-xs text-slate-600 mt-1.5 italic">No contact data found</p>
  }

  return (
    <div className="mt-3 pt-3 border-t border-white/[0.05]">
      {result.full_name && (
        <div className="flex items-center gap-1.5 mb-2.5">
          <svg className="w-3 h-3 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
          <span className="text-xs font-semibold text-slate-200">{result.full_name}</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Phones column */}
        <div className="col-span-2 lg:col-span-1">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Phones</p>
          {phones.length === 0 ? (
            <span className="text-xs text-slate-700">—</span>
          ) : (
            <div className="space-y-1.5">
              {phones.map((ph, i) => {
                const tag = PHONE_TAG[ph.type] || PHONE_TAG.mobile
                return (
                  <div key={i} className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs text-slate-200 font-mono tracking-tight">{ph.number}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide ${tag.cls}`}>{tag.label}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Email 1 */}
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Email 1</p>
          {emails[0]
            ? <span className="text-xs text-violet-300 break-all">{emails[0]}</span>
            : <span className="text-xs text-slate-700">—</span>}
        </div>

        {/* Email 2 */}
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Email 2</p>
          {emails[1]
            ? <span className="text-xs text-violet-300 break-all">{emails[1]}</span>
            : <span className="text-xs text-slate-700">—</span>}
        </div>

        {/* Email 3 */}
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Email 3</p>
          {emails[2]
            ? <span className="text-xs text-violet-300 break-all">{emails[2]}</span>
            : <span className="text-xs text-slate-700">—</span>}
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-brand-600/10 border border-brand-600/20 flex items-center justify-center mb-4">
        <svg className="w-7 h-7 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-white mb-2">No skip trace records yet</h3>
      <p className="text-sm text-slate-500 max-w-xs">
        Save properties from your scan results or upload a CSV to get started.
      </p>
    </div>
  )
}
