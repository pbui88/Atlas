import { useState, useEffect, useRef, useCallback } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  getSkipTraceRecords,
  saveSkipTraceRecords,
  deleteSkipTraceRecord,
  deleteSkipTraceGroup,
  submitSkipTrace,
  checkSkipTraceResults,
  submitDncScrub,
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

function parseCSVLine(line) {
  const cols = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      cols.push(field.trim())
      field = ''
    } else {
      field += ch
    }
  }
  cols.push(field.trim())
  return cols
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'))
  const col = (...names) => {
    const idx = headers.findIndex(h => names.includes(h))
    return idx >= 0 ? idx : -1
  }
  const addrIdx  = col('address', 'street', 'property_address')
  const cityIdx  = col('city', 'property_city')
  const stateIdx = col('state', 'state_code', 'property_state')
  const zipIdx   = col('zip', 'zip_code', 'postal_code', 'property_zip')

  return lines.slice(1).map(line => {
    const cols    = parseCSVLine(line)
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
  const { user, usage, isAdmin } = useAuth()
  const navigate = useNavigate()

  const [records,          setRecords]          = useState([])
  const [loading,          setLoading]          = useState(true)
  const [error,            setError]            = useState(null)
  const [checkedIds,       setCheckedIds]       = useState(new Set())
  const TRACE_TYPE     = 'advanced'
  const COST_PER_RECORD = 0.08
  const [submitting,       setSubmitting]       = useState(false)
  const [submitResult,     setSubmitResult]     = useState(null)
  const [submitError,      setSubmitError]      = useState(null)
  const [uploading,        setUploading]        = useState(false)
  const [uploadError,      setUploadError]      = useState(null)
  const [deletingId,       setDeletingId]       = useState(null)
  const [showConfirm,      setShowConfirm]      = useState(false)
  const [checking,         setChecking]         = useState(false)
  const [checkResult,      setCheckResult]      = useState(null)
  const [expandedGroups,   setExpandedGroups]   = useState(new Set())
  const [deletingGroup,    setDeletingGroup]    = useState(null)
  // DNC scrub state
  const [showDncConfirm,   setShowDncConfirm]   = useState(false)
  const [submittingDnc,    setSubmittingDnc]    = useState(false)
  const [dncSubmitResult,  setDncSubmitResult]  = useState(null)
  const [dncSubmitError,   setDncSubmitError]   = useState(null)
  const [dncPolling,       setDncPolling]       = useState(false)
  const dncPollRef          = useRef(null)
  const [tracePolling, setTracePolling]         = useState(false)
  const tracePollRef        = useRef(null)
  const pendingTraceIdsRef  = useRef(null)   // IDs submitted, cleared when first result arrives
  const fileRef             = useRef(null)

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

  // ── DNC auto-poll until results arrive ────────────────────
  useEffect(() => {
    if (!dncPolling) return
    let attempts = 0
    const MAX = 24  // 2 min at 5s intervals

    const poll = async () => {
      try {
        const res = await checkSkipTraceResults()
        if ((res.dncRecordsUpdated || 0) > 0) {
          setDncPolling(false)
          setDncSubmitResult(null)  // clear banner — results are visible in the records
          return
        }
      } catch {}
      attempts++
      if (attempts < MAX) {
        dncPollRef.current = setTimeout(poll, 5000)
      } else {
        setDncPolling(false)
        setDncSubmitResult(null)
      }
    }

    dncPollRef.current = setTimeout(poll, 3000)
    return () => { if (dncPollRef.current) clearTimeout(dncPollRef.current) }
  }, [dncPolling])

  // ── Skip trace auto-poll until results arrive ─────────────
  useEffect(() => {
    if (!tracePolling) return
    let attempts = 0
    const MAX = 36  // 3 min at 5s intervals

    const poll = async () => {
      try {
        const res = await checkSkipTraceResults()
        if ((res.recordsUpdated || 0) > 0) {
          await load()
          setSubmitResult(null)
          setTracePolling(false)
          return
        }
      } catch {}
      attempts++
      if (attempts < MAX) {
        tracePollRef.current = setTimeout(poll, 5000)
      } else {
        setTracePolling(false)
        setSubmitResult(null)
      }
    }

    tracePollRef.current = setTimeout(poll, 10000)  // first check after 10s
    return () => { if (tracePollRef.current) clearTimeout(tracePollRef.current) }
  }, [tracePolling, load])

  // ── Clear submit banner when submitted records complete ────
  // Watches records (updated by realtime) — clears the banner the moment
  // any of the just-submitted records transitions to completed.
  useEffect(() => {
    if (!pendingTraceIdsRef.current?.size) return
    const anyDone = records.some(
      r => pendingTraceIdsRef.current.has(r.id) && r.status === 'completed'
    )
    if (anyDone) {
      setSubmitResult(null)
      setTracePolling(false)
      pendingTraceIdsRef.current = null
    }
  }, [records])

  // ── Balance helpers ───────────────────────────────────────
  const skipTraceBalance = usage?.skipTraceBalance ?? 0

  // ── Selection helpers ─────────────────────────────────────
  const savedRecords     = records.filter(r => r.status === 'saved')
  const completedRecords = records.filter(r => r.status === 'completed')
  const savedIds         = new Set(savedRecords.map(r => r.id))
  const completedIds     = new Set(completedRecords.map(r => r.id))
  const checkedSaved     = [...checkedIds].filter(id => savedIds.has(id))
  const checkedCompleted = [...checkedIds].filter(id => completedIds.has(id))

  // Completed records selected that haven't been DNC scrubbed, OR were scrubbed with old
  // code that didn't capture per-flag columns (national_dnc === undefined on any phone)
  const needsDnc = (r) => {
    if (!r.result?.dnc_scrubbed) return true
    return r.result.phones?.some(ph => ph.national_dnc === undefined) ?? false
  }
  const dncCandidates     = records.filter(r =>
    checkedIds.has(r.id) && r.status === 'completed' && r.result && needsDnc(r)
  )
  const totalPhonesForDnc = dncCandidates.reduce((sum, r) => sum + (r.result?.phones?.length || 0), 0)

  // Any selected completed record has DNC data (for download buttons)
  const selectedHasDnc = records.some(r =>
    checkedIds.has(r.id) && r.status === 'completed' && r.result?.dnc_scrubbed
  )

  const toggleCheck = (id) => {
    setCheckedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Download CSV (batch) ──────────────────────────────────
  const downloadResults = (cleanOnly = false) => {
    const selected = records.filter(r => checkedIds.has(r.id) && r.status === 'completed')
    const header = ['List Name','Address','City','State','Zip','Owner Name','Primary Phone','Mobile 1','Mobile 2','Mobile 3','Landline 1','Landline 2','Email 1','Email 2','Email 3']
    const rows = selected.map(r => {
      const res       = r.result || {}
      const rawPhones = (res.phones || []).map(p => typeof p === 'string' ? { number: p, type: 'mobile', dnc: false } : { ...p, dnc: p.dnc ?? false })
      const phones    = cleanOnly ? rawPhones.filter(p => !p.dnc) : rawPhones
      const primary   = phones.find(p => p.type === 'primary')?.number  || ''
      const mobiles   = phones.filter(p => p.type === 'mobile').map(p => p.number)
      const landlines = phones.filter(p => p.type === 'landline').map(p => p.number)
      const emails    = res.emails || []
      return [
        r.list_name   || '', r.address    || '', r.city       || '',
        r.state_code  || '', r.zip        || '', res.full_name || '',
        primary,
        mobiles[0]  || '', mobiles[1]   || '', mobiles[2]   || '',
        landlines[0]|| '', landlines[1] || '',
        emails[0]   || '', emails[1]    || '', emails[2]    || '',
      ]
    })
    const escape = v => `"${String(v).replace(/"/g, '""')}"`
    const csv  = [header, ...rows].map(r => r.map(escape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `skip-trace-${cleanOnly ? 'clean-' : ''}${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Grouping — sorted newest-first by most recent record ─────
  const groups = (() => {
    const map = new Map()
    for (const r of records) {
      const key = r.list_name || '__uncategorized__'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(r)
    }
    return [...map.entries()]
      .map(([key, recs]) => ({
        key,
        name:           key === '__uncategorized__' ? 'Uncategorized' : key,
        records:        recs,
        latestAt:       recs[0]?.created_at || '',
        savedCount:     recs.filter(r => r.status === 'saved').length,
        completedCount: recs.filter(r => r.status === 'completed').length,
        submittedCount: recs.filter(r => ['submitted', 'processing'].includes(r.status)).length,
      }))
      .sort((a, b) => b.latestAt.localeCompare(a.latestAt))
  })()

  const toggleGroupExpand = (key) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const handleDeleteGroup = async (group) => {
    if (!window.confirm(`Delete all ${group.records.length} record${group.records.length !== 1 ? 's' : ''} in "${group.name}"? This cannot be undone.`)) return
    setDeletingGroup(group.key)
    try {
      await deleteSkipTraceGroup(group.key)
      setRecords(prev => prev.filter(r => (r.list_name || '__uncategorized__') !== group.key))
      setCheckedIds(prev => {
        const next = new Set(prev)
        group.records.forEach(r => next.delete(r.id))
        return next
      })
      setExpandedGroups(prev => { const n = new Set(prev); n.delete(group.key); return n })
    } catch (e) {
      alert(e.message)
    } finally {
      setDeletingGroup(null)
    }
  }

  const toggleGroupAll = (group) => {
    const selectable = group.records
      .filter(r => r.status === 'saved' || r.status === 'completed')
      .map(r => r.id)
    const allChecked = selectable.length > 0 && selectable.every(id => checkedIds.has(id))
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (allChecked) { selectable.forEach(id => next.delete(id)) }
      else            { selectable.forEach(id => next.add(id)) }
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
      if ((res.recordsUpdated || 0) + (res.dncRecordsUpdated || 0) > 0) await load()
    } catch (e) {
      setCheckResult({ error: e.message })
    } finally {
      setChecking(false)
    }
  }

  // ── Submit skip trace ─────────────────────────────────────
  const handleSubmit = async () => {
    setShowConfirm(false)
    if (!checkedSaved.length) return
    setSubmitting(true)
    setSubmitError(null)
    setSubmitResult(null)
    try {
      const submittedIds = new Set(checkedSaved)
      const res = await submitSkipTrace(checkedSaved, TRACE_TYPE)
      setSubmitResult(res)
      setCheckedIds(new Set())
      pendingTraceIdsRef.current = submittedIds  // watched by records effect
      setTracePolling(true)                       // polling fallback
      await load()
    } catch (e) {
      setSubmitError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Submit DNC scrub ──────────────────────────────────────
  const handleScrubDnc = async () => {
    setShowDncConfirm(false)
    if (!dncCandidates.length) return
    setSubmittingDnc(true)
    setDncSubmitError(null)
    setDncSubmitResult(null)
    try {
      const res = await submitDncScrub(dncCandidates.map(r => r.id))
      setDncSubmitResult(res)
      setCheckedIds(new Set())
      setDncPolling(true)  // auto-poll until DNC flags appear via realtime
    } catch (e) {
      setDncSubmitError(e.message)
    } finally {
      setSubmittingDnc(false)
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
            <p className="text-sm text-slate-500">Find property owner contact info — phones, emails &amp; more</p>
          </div>

          {/* Action buttons */}
          <div className="shrink-0 flex items-center gap-2">
            {/* Balance chip — only for non-admins */}
            {!isAdmin && usage && (
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border ${
                skipTraceBalance <= 0
                  ? 'bg-red-500/10 border-red-500/20 text-red-400'
                  : 'bg-violet-600/10 border-violet-600/20 text-violet-300'
              }`}>
                <span className="text-slate-500">Balance:</span>
                <span className="font-semibold tabular-nums">${skipTraceBalance.toFixed(2)}</span>
              </div>
            )}
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
                <span className="font-bold">{submitResult.recordCount} record{submitResult.recordCount !== 1 ? 's' : ''}</span> submitted for skip trace.
              </p>
              <p className="text-xs text-emerald-600 mt-0.5">Results will appear here once processing is complete. This typically takes a few minutes.</p>
            </div>
            <button onClick={() => setSubmitResult(null)} className="text-emerald-600 hover:text-emerald-400 p-1 shrink-0"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
        )}
        {dncSubmitResult?.message && (
          <div className="flex items-center gap-3 bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-3.5 mb-5">
            {dncPolling ? (
              <span className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin shrink-0" />
            ) : (
              <svg className="w-4 h-4 text-violet-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
            )}
            <p className="text-sm text-violet-300 font-medium flex-1">
              {dncPolling ? 'DNC scrub in progress — results will appear automatically…' : dncSubmitResult.message}
            </p>
            {!dncPolling && (
              <button onClick={() => setDncSubmitResult(null)} className="text-violet-600 hover:text-violet-400 p-1"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
            )}
          </div>
        )}
        {(submitError || uploadError || dncSubmitError) && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3.5 mb-5">
            <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
            <p className="text-sm text-red-300 font-medium flex-1">
              {submitError || uploadError || dncSubmitError}
              {(submitError || dncSubmitError || '').startsWith('Insufficient') && (
                <> — <button onClick={() => navigate('/credits')} className="underline hover:text-red-200">Deposit funds →</button></>
              )}
            </p>
            <button onClick={() => { setSubmitError(null); setUploadError(null); setDncSubmitError(null) }} className="text-red-500 hover:text-red-300 p-1"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
        )}
        {checkResult && !checkResult.error && (
          <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3.5 mb-5">
            <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
            <p className="text-sm text-emerald-300 font-medium flex-1">
              {checkResult.completed === 0 && !checkResult.dncRecordsUpdated
                ? 'No completed batches yet — still processing. Try again in a few minutes.'
                : <>
                    {checkResult.completed > 0 && <><span className="font-bold">{checkResult.completed} batch{checkResult.completed !== 1 ? 'es' : ''}</span> completed. </>}
                    {checkResult.recordsUpdated > 0 && <><span className="font-bold">{checkResult.recordsUpdated} record{checkResult.recordsUpdated !== 1 ? 's' : ''}</span> updated with contact info. </>}
                    {checkResult.dncRecordsUpdated > 0 && <><span className="font-bold">{checkResult.dncRecordsUpdated} record{checkResult.dncRecordsUpdated !== 1 ? 's' : ''}</span> updated with DNC flags.</>}
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

        {/* Sticky action bar */}
        {(checkedSaved.length > 0 || checkedCompleted.length > 0) && (
          <div className="sticky top-4 z-10 flex flex-wrap items-center gap-3 bg-slate-900/95 backdrop-blur border border-white/[0.10] rounded-2xl px-5 py-3.5 mb-6 shadow-xl">

            {/* Download + DNC scrub — completed records */}
            {checkedCompleted.length > 0 && (
              <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    {checkedCompleted.length} result{checkedCompleted.length !== 1 ? 's' : ''} selected
                  </p>
                  <p className="text-xs text-slate-500">Ready to export</p>
                </div>

                <button
                  onClick={() => downloadResults(false)}
                  className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition shadow-md"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  {selectedHasDnc ? 'Download All' : 'Download CSV'}
                </button>

                {selectedHasDnc && (
                  <button
                    onClick={() => downloadResults(true)}
                    className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-700/50 hover:bg-emerald-700/70 border border-emerald-600/40 text-emerald-300 text-sm font-semibold transition"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Download Clean
                  </button>
                )}

                {dncCandidates.length > 0 && (
                  <button
                    onClick={() => setShowDncConfirm(true)}
                    disabled={submittingDnc || dncPolling}
                    className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition shadow-md shadow-violet-600/20 disabled:opacity-50"
                  >
                    {submittingDnc ? (
                      <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Starting…</>
                    ) : (
                      <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>Scrub DNC</>
                    )}
                  </button>
                )}
              </div>
            )}

            {checkedCompleted.length > 0 && checkedSaved.length > 0 && (
              <div className="w-px h-10 bg-white/[0.08] shrink-0" />
            )}

            {/* Submit section — saved records */}
            {checkedSaved.length > 0 && (
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    {checkedSaved.length} record{checkedSaved.length !== 1 ? 's' : ''} to trace
                  </p>
                  <p className="text-xs text-slate-500">
                    ${(COST_PER_RECORD * checkedSaved.length).toFixed(2)} estimated cost
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <button
                    onClick={() => setShowConfirm(true)}
                    disabled={submitting}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold transition shadow-md shadow-brand-600/30 disabled:opacity-50"
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

            <button
              onClick={() => setCheckedIds(new Set())}
              className="shrink-0 p-1.5 rounded-lg text-slate-600 hover:text-slate-300 transition"
              title="Deselect all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Skip Trace confirm dialog */}
        {showConfirm && (() => {
          const traceCost = Math.round(COST_PER_RECORD * checkedSaved.length * 100) / 100
          const canAfford = isAdmin || skipTraceBalance >= traceCost
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
              <div className="bg-navy-900 border border-white/[0.08] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
                <h3 className="text-base font-bold text-white mb-3">Confirm Skip Trace</h3>
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-5 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Records</span>
                    <span className="text-white font-semibold">{checkedSaved.length}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Rate</span>
                    <span className="text-white font-semibold">$0.08 / record</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Est. Cost</span>
                    <span className="text-brand-400 font-bold">${traceCost.toFixed(2)}</span>
                  </div>
                  {!isAdmin && (
                    <>
                      <div className="flex justify-between text-sm pt-1 border-t border-white/[0.06]">
                        <span className="text-slate-500">Your Balance</span>
                        <span className={`font-semibold ${canAfford ? 'text-white' : 'text-red-400'}`}>
                          ${skipTraceBalance.toFixed(2)}
                        </span>
                      </div>
                      {canAfford ? (
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">After this job</span>
                          <span className="text-slate-300 font-semibold">${(skipTraceBalance - traceCost).toFixed(2)}</span>
                        </div>
                      ) : (
                        <div className="pt-1">
                          <p className="text-xs text-red-400">
                            Insufficient funds — you need ${(traceCost - skipTraceBalance).toFixed(2)} more.{' '}
                            <button onClick={() => { setShowConfirm(false); navigate('/credits') }} className="underline hover:text-red-300">Deposit funds →</button>
                          </p>
                        </div>
                      )}
                    </>
                  )}
                  <div className="pt-1 border-t border-white/[0.06]">
                    <p className="text-[11px] text-slate-600">
                      Returns owner name, phones &amp; emails. Charged per matched record only — no charge on misses.
                      After results arrive, you can optionally run DNC scrub on the completed records.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setShowConfirm(false)} className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.05] text-sm font-medium transition">Cancel</button>
                  <button onClick={handleSubmit} disabled={!canAfford} className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition shadow-md shadow-brand-600/30">Confirm</button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* DNC Scrub confirm dialog */}
        {showDncConfirm && (() => {
          const dncCost    = Math.round(totalPhonesForDnc * 0.02 * 100) / 100
          const canAfford  = isAdmin || skipTraceBalance >= dncCost
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
              <div className="bg-navy-900 border border-white/[0.08] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
                <h3 className="text-base font-bold text-white mb-1">Confirm DNC Scrub</h3>
                <p className="text-xs text-slate-500 mb-2">Checks phone numbers against these databases:</p>
                <div className="space-y-2 mb-4">
                  <DncInfoRow label="National DNC" info="Federal Do Not Call Registry managed by the FTC. Calling registered numbers without consent risks fines up to $51,744 per violation." />
                  <DncInfoRow label="State DNC" info="State-level Do Not Call registries. These may include numbers not on the federal list; rules and penalties vary by state." />
                  <DncInfoRow label="DMA" info="Direct Marketing Association Telephone Preference Service — an industry opt-out list for consumers who have requested no telemarketing calls." />
                  <DncInfoRow label="Litigator" info="Known TCPA serial litigators who have previously filed or threatened lawsuits for unsolicited calls. Contacting these numbers carries significant legal risk." />
                </div>
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-5 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Records</span>
                    <span className="text-white font-semibold">{dncCandidates.length}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Phones to check</span>
                    <span className="text-white font-semibold">{totalPhonesForDnc}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Rate</span>
                    <span className="text-white font-semibold">$0.02 / phone</span>
                  </div>
                  <div className="flex justify-between text-sm pt-1 border-t border-white/[0.06]">
                    <span className="text-slate-500">Est. Cost</span>
                    <span className="text-violet-400 font-bold">${dncCost.toFixed(2)} <span className="text-slate-600 font-normal text-[10px]">max</span></span>
                  </div>
                  {!isAdmin && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Your Balance</span>
                        <span className={`font-semibold ${canAfford ? 'text-white' : 'text-red-400'}`}>
                          ${skipTraceBalance.toFixed(2)}
                        </span>
                      </div>
                      {!canAfford && (
                        <div className="pt-1">
                          <p className="text-xs text-red-400">
                            Insufficient funds — you need ${(dncCost - skipTraceBalance).toFixed(2)} more.{' '}
                            <button onClick={() => { setShowDncConfirm(false); navigate('/credits') }} className="underline hover:text-red-300">Deposit funds →</button>
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setShowDncConfirm(false)} className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.05] text-sm font-medium transition">Cancel</button>
                  <button onClick={handleScrubDnc} disabled={!canAfford} className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition shadow-md shadow-violet-600/30">Confirm</button>
                </div>
              </div>
            </div>
          )
        })()}

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
              const isExpanded       = expandedGroups.has(group.key)
              const selectable       = group.records.filter(r => r.status === 'saved' || r.status === 'completed').map(r => r.id)
              const allGroupChecked  = selectable.length > 0 && selectable.every(id => checkedIds.has(id))
              const someGroupChecked = selectable.some(id => checkedIds.has(id))
              const isDeletingThis   = deletingGroup === group.key

              return (
                <div key={group.key} className="bg-slate-900/50 border border-white/[0.06] rounded-2xl overflow-hidden">
                  {/* Group header */}
                  <div className="px-4 py-3 flex items-center gap-3">
                    {selectable.length > 0 && (
                      <input
                        type="checkbox"
                        checked={allGroupChecked}
                        ref={el => { if (el) el.indeterminate = someGroupChecked && !allGroupChecked }}
                        onChange={() => toggleGroupAll(group)}
                        className="accent-brand-600 cursor-pointer shrink-0"
                        title={allGroupChecked ? 'Deselect all in list' : 'Select all in list'}
                      />
                    )}

                    <button
                      onClick={() => toggleGroupExpand(group.key)}
                      className="flex-1 flex items-center gap-2.5 text-left min-w-0"
                    >
                      <svg
                        className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
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
                    </button>

                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group) }}
                      disabled={isDeletingThis}
                      className="shrink-0 p-1.5 rounded-lg text-slate-600 hover:text-red-400 transition disabled:opacity-40"
                      title="Delete this list"
                    >
                      {isDeletingThis
                        ? <span className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin block" />
                        : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-white/[0.05] divide-y divide-white/[0.04]">
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

            <div className="text-center">
              <button onClick={load} className="text-xs text-slate-600 hover:text-slate-400 transition">↺ Refresh all</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DncInfoRow({ label, info }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
        <span className="text-xs text-slate-300 flex-1">{label}</span>
        <button
          onClick={() => setOpen(v => !v)}
          title={open ? 'Hide info' : 'What is this?'}
          className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center transition shrink-0
            ${open ? 'bg-violet-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-white'}`}
        >?</button>
      </div>
      {open && (
        <p className="text-[11px] text-slate-400 leading-relaxed mt-1.5 pl-3.5 pr-1">{info}</p>
      )}
    </div>
  )
}

function RecordRow({ record, checked, onCheck, onDelete, deletingId }) {
  const isSaved      = record.status === 'saved'
  const isCompleted  = record.status === 'completed'
  const isSelectable = isSaved || isCompleted
  const isDeleting   = deletingId === record.id

  return (
    <div className={`flex items-start gap-3 px-4 py-3 transition-colors ${checked ? 'bg-brand-600/5' : 'hover:bg-white/[0.02]'}`}>
      <div className="shrink-0 pt-0.5 w-4">
        {isSelectable
          ? <input type="checkbox" checked={checked} onChange={() => onCheck(record.id)} className="accent-brand-600 cursor-pointer" />
          : <span />}
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
          <ContactResult result={record.result} record={record} />
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

function PhoneTag({ type }) {
  if (type === 'primary')  return <span className="text-[10px] font-semibold text-emerald-400 border border-emerald-500/40 rounded px-1.5 py-0.5">Primary</span>
  if (type === 'landline') return <span className="text-[10px] font-semibold text-slate-400 border border-slate-600 rounded px-1.5 py-0.5">Landline</span>
  return                          <span className="text-[10px] font-semibold text-blue-400 border border-blue-500/40 rounded px-1.5 py-0.5">Mobile</span>
}

function DncFlag({ value }) {
  if (value === true)      return <span className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">Y</span>
  if (value === false)     return <span className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-500">N</span>
  return                          <span className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-600">–</span>
}

const CSV_HEADER = ['List Name','Address','City','State','Zip','Owner Name','Primary Phone','Mobile 1','Mobile 2','Mobile 3','Landline 1','Landline 2','Email 1','Email 2','Email 3']

function buildCsvRow(record, result, phonesOverride) {
  const phones    = phonesOverride
  const primary   = phones.find(p => p.type === 'primary')?.number  || ''
  const mobiles   = phones.filter(p => p.type === 'mobile').map(p => p.number)
  const landlines = phones.filter(p => p.type === 'landline').map(p => p.number)
  const emails    = result.emails || []
  return [
    record.list_name  || '', record.address    || '', record.city      || '',
    record.state_code || '', record.zip        || '', result.full_name || '',
    primary,
    mobiles[0]  || '', mobiles[1]   || '', mobiles[2]   || '',
    landlines[0]|| '', landlines[1] || '',
    emails[0]   || '', emails[1]    || '', emails[2]    || '',
  ]
}

function triggerDownload(rows, filename) {
  const escape = v => `"${String(v).replace(/"/g, '""')}"`
  const csv  = [CSV_HEADER, ...rows].map(r => r.map(escape).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function ContactResult({ result, record }) {
  const rawPhones = result.phones || []
  const phones = rawPhones.map(p =>
    typeof p === 'string' ? { number: p, type: 'mobile', dnc: false } : { ...p, dnc: p.dnc ?? false }
  )
  const emails       = result.emails || []
  const dncScrubbed  = !!result.dnc_scrubbed
  const cleanPhones  = dncScrubbed ? phones.filter(p => !p.dnc) : []
  const flaggedCount = dncScrubbed ? phones.filter(p => p.dnc).length : 0

  const slug = (record?.address || 'record').replace(/[^a-z0-9]/gi, '-').toLowerCase()

  const downloadSkipTrace = () =>
    triggerDownload([buildCsvRow(record, result, phones)], `${slug}-skip-trace.csv`)

  const downloadClean = () =>
    triggerDownload([buildCsvRow(record, result, cleanPhones)], `${slug}-clean.csv`)

  if (!result.full_name && !phones.length && !emails.length) {
    return <p className="text-xs text-slate-600 mt-1.5 italic">No contact data found</p>
  }

  return (
    <div className="mt-3 space-y-2.5">

      {/* ── Skip Trace Result card ──────────────────────────────── */}
      <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Skip Trace Result</span>
          <button
            onClick={downloadSkipTrace}
            className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition"
            title="Download this record as CSV"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download Skip Trace Result
          </button>
        </div>

        {result.full_name && (
          <div className="flex items-center gap-1.5 mb-2.5">
            <svg className="w-3 h-3 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
            <span className="text-xs font-semibold text-slate-200">{result.full_name}</span>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="col-span-2 lg:col-span-1">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Phones</p>
            {phones.length === 0 ? (
              <span className="text-xs text-slate-700">—</span>
            ) : (
              <div className="space-y-1.5">
                {phones.map((ph, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-200 font-mono">{ph.number}</span>
                    <PhoneTag type={ph.type} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {['Email 1', 'Email 2', 'Email 3'].map((label, i) => (
            <div key={i}>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{label}</p>
              {emails[i]
                ? <span className="text-xs text-violet-300 break-all">{emails[i]}</span>
                : <span className="text-xs text-slate-700">—</span>}
            </div>
          ))}
        </div>
      </div>

      {/* ── DNC Scrub Result card ───────────────────────────────── */}
      {dncScrubbed && (
        <div className="bg-white/[0.02] border border-violet-500/15 rounded-xl p-3">
          {/* Header */}
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 inline-block" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">DNC Scrub Result</span>
            </div>
            <button
              onClick={downloadClean}
              className="flex items-center gap-1 text-[10px] text-violet-500 hover:text-violet-300 transition"
              title="Download clean numbers only"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Download Clean
            </button>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-6 mb-3 pb-3 border-b border-white/[0.04]">
            <div>
              <p className="text-lg font-bold text-white leading-none">{phones.length}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Checked</p>
            </div>
            <div>
              <p className="text-lg font-bold text-emerald-400 leading-none">{cleanPhones.length}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Clean (No Flags)</p>
            </div>
            <div>
              <p className="text-lg font-bold text-red-400 leading-none">{flaggedCount}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Flagged</p>
            </div>
          </div>

          {/* Phone detail table */}
          {phones.length === 0 ? (
            <p className="text-xs text-slate-600 italic">No phones to display</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead>
                  <tr>
                    {['Phone', 'Type', 'National DNC', 'State DNC', 'DMA', 'Litigator'].map(h => (
                      <th key={h} className="text-left pb-2 pr-4 last:pr-0 text-[10px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {phones.map((ph, i) => (
                    <tr key={i} className={ph.dnc ? 'opacity-60' : ''}>
                      <td className="py-1.5 pr-4 font-mono text-slate-200 whitespace-nowrap">{ph.number}</td>
                      <td className="py-1.5 pr-4 whitespace-nowrap"><PhoneTag type={ph.type} /></td>
                      <td className="py-1.5 pr-4 text-center"><DncFlag value={ph.national_dnc} /></td>
                      <td className="py-1.5 pr-4 text-center"><DncFlag value={ph.state_dnc} /></td>
                      <td className="py-1.5 pr-4 text-center"><DncFlag value={ph.dma} /></td>
                      <td className="py-1.5 text-center"><DncFlag value={ph.litigator} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
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
