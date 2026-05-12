import { useState, useEffect, useCallback } from 'react'
import { GoogleMap, Marker } from '@react-google-maps/api'
import { supabase } from '../../lib/supabase'
import { exportProject } from '../../lib/api'
import { scoreColor, scoreLabel } from '../../lib/geo'
import { DISTRESS_SIGNALS, SIGNAL_BADGE } from '../../lib/constants'

const MAP_STYLE = [
  { elementType: 'geometry',           stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#8892a4' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { featureType: 'road',               elementType: 'geometry', stylers: [{ color: '#2d2d44' }] },
  { featureType: 'water',              elementType: 'geometry', stylers: [{ color: '#0f1a2e' }] },
  { featureType: 'poi',                stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',            stylers: [{ visibility: 'off' }] },
]

const SIGNAL_MAP = Object.fromEntries(DISTRESS_SIGNALS.map(s => [s.id, s]))

function scoreTextColor(score) {
  if (score == null) return 'text-slate-400'
  if (score >= 0.70) return 'text-red-500'
  if (score >= 0.45) return 'text-orange-500'
  if (score >= 0.20) return 'text-amber-500'
  return 'text-emerald-600'
}

function PropertyDrawer({ point, images, onClose }) {
  const score   = point?.ai_analyses?.[0]?.overall_score
  const signals = point?.ai_analyses?.[0]?.signals || []
  const notes   = point?.ai_analyses?.[0]?.notes

  return (
    <div className={`absolute right-0 top-0 bottom-0 w-80 bg-white border-l border-slate-200 shadow-2xl z-20 flex flex-col transition-transform duration-300 ease-out ${
      point ? 'translate-x-0' : 'translate-x-full'
    }`}>
      {/* Header */}
      <div className="p-4 border-b border-slate-200 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 mb-1">
            <span className={`text-3xl font-bold tabular-nums leading-none ${scoreTextColor(score)}`}>
              {scoreLabel(score)}
            </span>
            <span className="text-xs text-slate-400 font-medium">/ 100</span>
          </div>
          <p className="text-sm font-medium text-slate-900 leading-snug">
            {point?.address || `${point?.lat?.toFixed(5)}, ${point?.lng?.toFixed(5)}`}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Signals */}
      {signals.length > 0 && (
        <div className="px-4 py-3 border-b border-slate-200">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Distress Signals</p>
          <div className="flex flex-wrap gap-1.5">
            {signals.map(sig => {
              const s = SIGNAL_MAP[sig]
              return s ? (
                <span key={sig} className={`${SIGNAL_BADGE[s.severity]} text-xs px-2 py-0.5`}>
                  {s.label}
                </span>
              ) : null
            })}
          </div>
        </div>
      )}

      {/* Images + notes */}
      <div className="flex-1 overflow-y-auto">
        {images.length > 0 ? (
          <div className="p-4 space-y-3">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Street View</p>
            {images.map(img => (
              img.storage_url ? (
                <div key={img.id} className="rounded-lg overflow-hidden border border-slate-200">
                  <img src={img.storage_url} alt={img.direction} className="w-full object-cover" />
                  <p className="text-[10px] text-slate-400 px-2 py-1 bg-slate-50 uppercase tracking-wide">{img.direction}</p>
                </div>
              ) : null
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-24 text-sm text-slate-400">
            No images captured
          </div>
        )}

        {notes && (
          <div className="mx-4 mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5">AI Notes</p>
            <p className="text-xs text-slate-600 leading-relaxed">{notes}</p>
          </div>
        )}
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
        isSelected
          ? 'bg-brand-50 border-l-2 border-l-brand-500'
          : 'hover:bg-slate-50'
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
                  <span key={sig} className={`${SIGNAL_BADGE[s.severity]} text-[10px] px-1.5 py-0`}>
                    {s.label}
                  </span>
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

export default function ResultsTab({ project, isLoaded }) {
  const [points,       setPoints]       = useState([])
  const [loading,      setLoading]      = useState(true)
  const [selected,     setSelected]     = useState(null)
  const [drawerImages, setDrawerImages] = useState([])
  const [minScore,     setMinScore]     = useState(0)
  const [sigFilter,    setSigFilter]    = useState([])
  const [exporting,    setExporting]    = useState(false)
  const [mapRef,       setMapRef]       = useState(null)

  const fetchResults = useCallback(async () => {
    setLoading(true)
    const { data: pts } = await supabase
      .from('scan_points')
      .select('id, lat, lng, address, status')
      .eq('project_id', project.id)
      .eq('status', 'complete')
      .order('created_at')

    if (!pts?.length) { setPoints([]); setLoading(false); return }

    const { data: analyses } = await supabase
      .from('ai_analyses')
      .select('scan_point_id, overall_score, confidence, signals, notes')
      .in('scan_point_id', pts.map(p => p.id))

    const analysisMap = Object.fromEntries((analyses || []).map(a => [a.scan_point_id, a]))
    setPoints(pts.map(pt => ({ ...pt, ai_analyses: analysisMap[pt.id] ? [analysisMap[pt.id]] : [] })))
    setLoading(false)
  }, [project.id])

  useEffect(() => { fetchResults() }, [fetchResults])

  // Fetch drawer images when a property is selected
  useEffect(() => {
    if (!selected) { setDrawerImages([]); return }
    supabase.from('images').select('*').eq('scan_point_id', selected.id).then(({ data }) => {
      setDrawerImages(data || [])
    })
  }, [selected?.id])

  const toggleSignal = (id) => {
    setSigFilter(f => f.includes(id) ? f.filter(s => s !== id) : [...f, id])
  }

  const filtered = points.filter(pt => {
    const score = pt.ai_analyses?.[0]?.overall_score ?? 0
    if (score < minScore / 100) return false
    if (sigFilter.length > 0) {
      const sigs = pt.ai_analyses?.[0]?.signals || []
      if (!sigFilter.some(s => sigs.includes(s))) return false
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    const as = a.ai_analyses?.[0]?.overall_score ?? 0
    const bs = b.ai_analyses?.[0]?.overall_score ?? 0
    return bs - as
  })

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
      const a = document.createElement('a')
      a.href = url
      a.download = `${project.name.replace(/\s+/g, '_')}_${format.toLowerCase()}.${format === 'CSV' ? 'csv' : 'json'}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(err.message)
    } finally {
      setExporting(false)
    }
  }

  const onMapLoad = useCallback((map) => {
    setMapRef(map)
    if (points.length > 0) {
      const bounds = new window.google.maps.LatLngBounds()
      points.forEach(pt => bounds.extend({ lat: pt.lat, lng: pt.lng }))
      map.fitBounds(bounds, 60)
    }
  }, [points])

  const handleSelect = (pt) => {
    const next = selected?.id === pt.id ? null : pt
    setSelected(next)
    if (next) mapRef?.panTo({ lat: pt.lat, lng: pt.lng })
  }

  const hasFilters = minScore > 0 || sigFilter.length > 0

  return (
    <div className="flex h-full relative">
      {/* Map */}
      <div className="flex-1 relative">
        {isLoaded && (
          <GoogleMap
            mapContainerStyle={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            center={{ lat: 33.4484, lng: -112.074 }}
            zoom={12}
            options={{ styles: MAP_STYLE, disableDefaultUI: false, zoomControl: true, streetViewControl: false, mapTypeControl: false }}
            onLoad={onMapLoad}
          >
            {sorted.map(pt => {
              const score = pt.ai_analyses?.[0]?.overall_score
              return (
                <Marker
                  key={pt.id}
                  position={{ lat: pt.lat, lng: pt.lng }}
                  onClick={() => handleSelect(pt)}
                  options={{
                    icon: {
                      path: window.google.maps.SymbolPath.CIRCLE,
                      scale: selected?.id === pt.id ? 9 : 6,
                      fillColor: scoreColor(score),
                      fillOpacity: 0.9,
                      strokeColor: selected?.id === pt.id ? '#fff' : 'transparent',
                      strokeWeight: 2,
                    },
                    zIndex: selected?.id === pt.id ? 10 : 1,
                  }}
                />
              )
            })}
          </GoogleMap>
        )}

        {/* Score legend */}
        <div className="absolute bottom-4 left-4 bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-2 backdrop-blur-sm">
          <p className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wide">Distress Score</p>
          <div className="flex items-center gap-3 text-xs">
            {[
              { color: '#22c55e', label: 'Low' },
              { color: '#eab308', label: 'Mod' },
              { color: '#f97316', label: 'High' },
              { color: '#ef4444', label: 'Severe' },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ background: l.color }} />
                <span className="text-slate-400">{l.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel: filters + list */}
      <div className="w-80 bg-white border-l border-slate-200 flex flex-col">
        {/* Filters */}
        <div className="p-4 border-b border-slate-200 space-y-4">
          {/* Score slider */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Min Score</span>
              <span className="text-sm font-bold text-slate-900 tabular-nums">{minScore}</span>
            </div>
            <input
              type="range" min={0} max={90} step={5}
              value={minScore}
              onChange={e => setMinScore(+e.target.value)}
              className="w-full accent-brand-600"
            />
          </div>

          {/* Signal toggles */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Signal Filter</p>
            <div className="flex flex-wrap gap-1">
              {DISTRESS_SIGNALS.map(sig => (
                <button
                  key={sig.id}
                  onClick={() => toggleSignal(sig.id)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                    sigFilter.includes(sig.id)
                      ? 'bg-brand-600 border-brand-600 text-white'
                      : 'bg-white border-slate-300 text-slate-600 hover:border-brand-400 hover:text-brand-600'
                  }`}
                >
                  {sig.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Active filter chips — priority #5 */}
        {hasFilters && (
          <div className="px-4 py-2 bg-brand-50 border-b border-brand-100 flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-brand-600 uppercase tracking-widest shrink-0">Active:</span>
            {minScore > 0 && (
              <button
                onClick={() => setMinScore(0)}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-brand-200 rounded-full text-[11px] text-brand-700 hover:bg-brand-50 transition"
              >
                Score ≥ {minScore}
                <span className="text-brand-400 font-bold">×</span>
              </button>
            )}
            {sigFilter.map(sig => (
              <button
                key={sig}
                onClick={() => toggleSignal(sig)}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-slate-300 rounded-full text-[11px] text-slate-700 hover:bg-slate-50 transition"
              >
                {SIGNAL_MAP[sig]?.label}
                <span className="text-slate-400 font-bold">×</span>
              </button>
            ))}
            <button
              onClick={() => { setMinScore(0); setSigFilter([]) }}
              className="ml-auto text-[11px] text-brand-600 hover:underline font-medium"
            >
              Clear all
            </button>
          </div>
        )}

        {/* Count + refresh */}
        <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {loading ? 'Loading…' : `${sorted.length} properties`}
            {hasFilters && !loading && points.length !== sorted.length && (
              <span className="text-slate-400"> of {points.length}</span>
            )}
          </span>
          <button onClick={fetchResults} className="text-xs text-slate-400 hover:text-slate-700 transition">
            Refresh
          </button>
        </div>

        {/* Property list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-12 px-4">
              <p className="text-sm text-slate-500">
                {hasFilters ? 'No properties match your filters.' : 'No complete results yet.'}
              </p>
              {hasFilters && (
                <button
                  onClick={() => { setMinScore(0); setSigFilter([]) }}
                  className="mt-2 text-xs text-brand-600 hover:underline"
                >
                  Clear filters
                </button>
              )}
              {!hasFilters && <p className="text-xs text-slate-400 mt-1">Run a scan from the Scan tab.</p>}
            </div>
          ) : (
            sorted.map(pt => (
              <PropertyRow
                key={pt.id}
                point={pt}
                isSelected={selected?.id === pt.id}
                onClick={() => handleSelect(pt)}
              />
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
                <button key={fmt} onClick={() => handleExport(fmt)} className="flex-1 btn-outline py-1.5 text-xs">
                  {fmt}
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Slide-in property drawer — priority #4 */}
      <PropertyDrawer
        point={selected}
        images={drawerImages}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}
