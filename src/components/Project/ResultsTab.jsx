import { useState, useEffect, useCallback } from 'react'
import { GoogleMap, Marker, InfoWindow } from '@react-google-maps/api'
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

function ScoreBadge({ score }) {
  const v = scoreLabel(score)
  const color = score >= 0.70 ? 'text-red-400' : score >= 0.45 ? 'text-orange-400' : score >= 0.20 ? 'text-yellow-400' : 'text-green-400'
  return <span className={`text-lg font-bold tabular-nums ${color}`}>{v}</span>
}

function PropertyCard({ point, isSelected, onClick }) {
  const score = point.ai_analyses?.[0]?.overall_score
  const signals = point.ai_analyses?.[0]?.signals || []
  return (
    <div
      onClick={onClick}
      className={`p-3 rounded-lg cursor-pointer transition-colors border ${
        isSelected ? 'bg-slate-800 border-brand-600/40' : 'hover:bg-slate-800/50 border-transparent'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          <ScoreBadge score={score} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-300 font-medium truncate">
            {point.address || `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}
          </p>
          {signals.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {signals.slice(0, 3).map(sig => {
                const s = SIGNAL_MAP[sig]
                return s ? (
                  <span key={sig} className={`${SIGNAL_BADGE[s.severity]} text-[10px] px-1.5 py-0`}>
                    {s.label}
                  </span>
                ) : null
              })}
              {signals.length > 3 && (
                <span className="badge-slate text-[10px] px-1.5 py-0">+{signals.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ImageGallery({ pointId, onClose }) {
  const [images, setImages] = useState([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    supabase.from('images').select('*').eq('scan_point_id', pointId).then(({ data }) => {
      setImages(data || [])
    })
  }, [pointId])

  if (!images.length) return null
  const img = images[active]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative max-w-3xl w-full" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-10 right-0 text-slate-400 hover:text-white transition text-sm">
          ✕ Close
        </button>
        {img.storage_url ? (
          <img src={img.storage_url} alt={img.direction} className="w-full rounded-xl" />
        ) : (
          <div className="aspect-video bg-slate-800 rounded-xl flex items-center justify-center text-slate-500 text-sm">
            Image not available
          </div>
        )}
        <div className="flex gap-2 mt-3 justify-center">
          {images.map((im, i) => (
            <button
              key={im.id}
              onClick={() => setActive(i)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                i === active ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
              }`}
            >
              {im.direction}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function ResultsTab({ project, isLoaded }) {
  const [points,    setPoints]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [selected,  setSelected]  = useState(null)
  const [gallery,   setGallery]   = useState(null)
  const [minScore,  setMinScore]  = useState(0)
  const [sigFilter, setSigFilter] = useState([])
  const [exporting, setExporting] = useState(false)
  const [mapRef,    setMapRef]    = useState(null)

  const fetchResults = useCallback(async () => {
    setLoading(true)

    const { data: pts } = await supabase
      .from('scan_points')
      .select('id, lat, lng, address, status')
      .eq('project_id', project.id)
      .eq('status', 'complete')
      .order('created_at')

    if (!pts?.length) {
      setPoints([])
      setLoading(false)
      return
    }

    const { data: analyses } = await supabase
      .from('ai_analyses')
      .select('scan_point_id, overall_score, confidence, signals, notes')
      .in('scan_point_id', pts.map(p => p.id))

    const analysisMap = Object.fromEntries(
      (analyses || []).map(a => [a.scan_point_id, a])
    )

    setPoints(pts.map(pt => ({
      ...pt,
      ai_analyses: analysisMap[pt.id] ? [analysisMap[pt.id]] : [],
    })))
    setLoading(false)
  }, [project.id])

  useEffect(() => { fetchResults() }, [fetchResults])

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
      // Trigger download
      const blob = new Blob([typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)], {
        type: format === 'CSV' ? 'text/csv' : 'application/json',
      })
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

  return (
    <div className="flex h-full">
      {/* Map */}
      <div className="flex-1 relative">
        {isLoaded && (
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
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
                  onClick={() => setSelected(pt.id === selected?.id ? null : pt)}
                  options={{
                    icon: {
                      path: window.google.maps.SymbolPath.CIRCLE,
                      scale: selected?.id === pt.id ? 8 : 5,
                      fillColor: scoreColor(score),
                      fillOpacity: 0.9,
                      strokeColor: selected?.id === pt.id ? '#fff' : 'transparent',
                      strokeWeight: 1.5,
                    },
                    zIndex: selected?.id === pt.id ? 10 : 1,
                  }}
                />
              )
            })}

            {selected && (
              <InfoWindow
                position={{ lat: selected.lat, lng: selected.lng }}
                onCloseClick={() => setSelected(null)}
              >
                <div className="p-1 min-w-48">
                  <p className="font-semibold text-gray-900 text-sm mb-1">
                    Score: {scoreLabel(selected.ai_analyses?.[0]?.overall_score)}
                  </p>
                  <p className="text-xs text-gray-600 mb-2 max-w-xs">
                    {selected.address || `${selected.lat.toFixed(5)}, ${selected.lng.toFixed(5)}`}
                  </p>
                  <button
                    onClick={() => setGallery(selected.id)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    View images →
                  </button>
                </div>
              </InfoWindow>
            )}
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

      {/* Right panel: filters + results list */}
      <div className="w-80 bg-slate-950 border-l border-slate-800 flex flex-col">
        {/* Filters */}
        <div className="p-4 border-b border-slate-800 space-y-3">
          <div>
            <label className="label">Min Score: {minScore}</label>
            <input
              type="range" min={0} max={90} step={5}
              value={minScore}
              onChange={e => setMinScore(+e.target.value)}
              className="w-full accent-brand-500"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {exporting ? (
              <span className="text-xs text-slate-500">Exporting…</span>
            ) : (
              ['GEOJSON', 'CSV', 'JSON'].map(fmt => (
                <button
                  key={fmt}
                  onClick={() => handleExport(fmt)}
                  className="btn-outline py-1 px-2 text-xs"
                >
                  {fmt}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Results count */}
        <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {loading ? 'Loading…' : `${sorted.length} properties`}
          </span>
          <button onClick={fetchResults} className="text-xs text-slate-600 hover:text-slate-400 transition">
            Refresh
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-slate-500">No complete results yet.</p>
              <p className="text-xs text-slate-600 mt-1">Run a scan from the Scan tab.</p>
            </div>
          ) : (
            sorted.map(pt => (
              <PropertyCard
                key={pt.id}
                point={pt}
                isSelected={selected?.id === pt.id}
                onClick={() => {
                  setSelected(pt)
                  mapRef?.panTo({ lat: pt.lat, lng: pt.lng })
                }}
              />
            ))
          )}
        </div>

        {selected && (
          <div className="p-3 border-t border-slate-800">
            <button onClick={() => setGallery(selected.id)} className="btn-outline w-full text-xs">
              View Street View Images
            </button>
            {selected.ai_analyses?.[0]?.notes && (
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                {selected.ai_analyses[0].notes}
              </p>
            )}
          </div>
        )}
      </div>

      {gallery && <ImageGallery pointId={gallery} onClose={() => setGallery(null)} />}
    </div>
  )
}
