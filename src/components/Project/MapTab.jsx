import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { GoogleMap, Polygon, Marker } from '@react-google-maps/api'
import { generatePoints } from '../../lib/api'
import { generateGridPoints, estimateCost } from '../../lib/geo'
import { useAuth } from '../../context/AuthContext'

// Grid-based clustering — cell size shrinks as zoom increases
function buildClusters(points, zoom) {
  if (!points.length) return []
  const deg = 0.0015 * Math.pow(2, Math.max(0, 15 - zoom))
  const cells = {}
  for (const pt of points) {
    const k = `${Math.round(pt.lng / deg)},${Math.round(pt.lat / deg)}`
    if (!cells[k]) cells[k] = { lat: 0, lng: 0, n: 0, scoreSum: 0, scoreCount: 0 }
    cells[k].lat += pt.lat
    cells[k].lng += pt.lng
    cells[k].n++
    if (pt.overall_score != null) { cells[k].scoreSum += pt.overall_score; cells[k].scoreCount++ }
  }
  return Object.values(cells).map(c => ({
    lat:   c.lat / c.n,
    lng:   c.lng / c.n,
    count: c.n,
    score: c.scoreCount > 0 ? c.scoreSum / c.scoreCount : null,
  }))
}

function clusterIcon(count, score) {
  const color = score != null
    ? score >= 0.70 ? '#ef4444' : score >= 0.45 ? '#f97316' : score >= 0.20 ? '#eab308' : '#22c55e'
    : '#7c3aed'
  const size  = count === 1 ? 12 : count < 5 ? 24 : count < 20 ? 30 : 36
  const fs    = size <= 12 ? 0 : size <= 24 ? 10 : 11
  const label = size <= 12 ? '' : String(count)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${size/2-1}" fill="${color}" stroke="white" stroke-width="1.5" opacity="0.92"/>
    ${label ? `<text x="${size/2}" y="${size/2+4}" text-anchor="middle" fill="white" font-size="${fs}" font-weight="700" font-family="Arial,sans-serif">${label}</text>` : ''}
  </svg>`
  return {
    url:        `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(size, size),
    anchor:     new window.google.maps.Point(size / 2, size / 2),
  }
}

const US_CENTER = { lat: 39.5, lng: -98.35 }

export default function MapTab({ project, scanPoints, onPointsGenerated, isLoaded, loadError }) {
  const SPACING = 25
  const { usage } = useAuth()
  const keyLoading   = usage === null
  const noKeyBlocked = usage !== null && !usage.has_own_key

  const [showPanel,      setShowPanel]      = useState(false)
  const [drawingMode,    setDrawingMode]    = useState(null)
  const [tempPoints,     setTempPoints]     = useState([])
  const [polygon,        setPolygon]        = useState(project.scan_area_geojson || null)
  const [preview,        setPreview]        = useState([])
  const [cost,           setCost]           = useState(null)
  const [generating,     setGenerating]     = useState(false)
  const [error,          setError]          = useState(null)
  const [searchPin,      setSearchPin]      = useState(null)
  const [searchInput,    setSearchInput]    = useState('')
  const [suggestions,    setSuggestions]    = useState([])
  const [showDropdown,   setShowDropdown]   = useState(false)

  const [zoom, setZoom] = useState(4)

  const mapRef         = useRef(null)
  const searchInputRef = useRef(null)
  const debounceRef    = useRef(null)

  // Nominatim (OpenStreetMap) autocomplete — no API key required
  const fetchSuggestions = async (input) => {
    if (!input || input.length < 2) { setSuggestions([]); setShowDropdown(false); return }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const res  = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input)}&format=json&countrycodes=us&limit=5&addressdetails=1`,
        { headers: { 'Accept-Language': 'en-US' }, signal: controller.signal }
      )
      const data = await res.json()
      setSuggestions(data)
      setShowDropdown(data.length > 0)
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('Nominatim search failed:', e.message)
      setSuggestions([]); setShowDropdown(false)
    } finally {
      clearTimeout(timer)
    }
  }

  const handleSearchChange = (e) => {
    const val = e.target.value
    setSearchInput(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 350)
  }

  const handleSelectSuggestion = (s) => {
    setShowDropdown(false)
    const label = s.display_name.split(',').slice(0, 3).join(',').trim()
    setSearchInput(label)
    const lat = parseFloat(s.lat)
    const lng = parseFloat(s.lon)
    if (mapRef.current) {
      mapRef.current.setCenter({ lat, lng })
      mapRef.current.setZoom(15)
    }
    setSearchPin({ lat, lng, address: s.display_name })
  }


  const onMapLoad = useCallback((map) => {
    mapRef.current = map
    if (polygon) {
      const bounds = new window.google.maps.LatLngBounds()
      polygon.coordinates[0].forEach(([lng, lat]) => bounds.extend({ lat, lng }))
      map.fitBounds(bounds, 60)
    }
  }, [polygon])

  const handleMapClick = useCallback((e) => {
    if (drawingMode !== 'polygon') return
    setTempPoints(prev => [...prev, { lat: e.latLng.lat(), lng: e.latLng.lng() }])
  }, [drawingMode])

  const handleFinishDrawing = useCallback(() => {
    if (tempPoints.length < 3) return
    const coords = tempPoints.map(p => [p.lng, p.lat])
    coords.push(coords[0])
    const geoJson = { type: 'Polygon', coordinates: [coords] }
    setPolygon(geoJson)
    setDrawingMode(null)
    setTempPoints([])
    const pts = generateGridPoints(geoJson, SPACING)
    setPreview(pts)
  }, [tempPoints])

  const handleCancelDrawing = useCallback(() => {
    setDrawingMode(null)
    setTempPoints([])
  }, [])


  // Keep cost in sync with whatever polygon/points are currently shown.
  useEffect(() => {
    if (!polygon) { setCost(null); return }
    const count = scanPoints?.length > 0
      ? scanPoints.length
      : (preview.length || generateGridPoints(polygon, SPACING).length)
    setCost(estimateCost(count))
  }, [polygon, preview, scanPoints])

  const handleGenerate = async () => {
    if (!polygon) return
    setGenerating(true)
    setError(null)
    try {
      await generatePoints(project.id, { geojson: polygon, spacingMeters: SPACING })
      setPreview([])
      onPointsGenerated({ autoStart: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleClear = () => {
    setPolygon(null)
    setPreview([])
    setCost(null)
  }


  const displayPoints = scanPoints?.length > 0 ? scanPoints : preview
  const ptCount       = displayPoints.length
  const clusters      = useMemo(() => buildClusters(displayPoints, zoom), [displayPoints, zoom])

  if (loadError) return (
    <div className="flex items-center justify-center h-full text-red-400 text-sm">
      Failed to load Google Maps. Check your API key.
    </div>
  )

  if (!isLoaded) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="flex h-full">

      {/* ── Map + Street View column ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Map */}
        <div className="relative flex-1">
          <GoogleMap
            mapContainerStyle={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            center={US_CENTER}
            zoom={4}
            options={{
              zoomControl: true,
              streetViewControl: false,
              mapTypeControl: false,
              fullscreenControl: false,
              draggableCursor: drawingMode === 'polygon' ? 'crosshair' : undefined,
            }}
            onLoad={onMapLoad}
            onZoomChanged={() => { if (mapRef.current) setZoom(mapRef.current.getZoom()) }}
            onClick={handleMapClick}
          >
            {/* Live polygon preview while drawing */}
            {drawingMode === 'polygon' && tempPoints.length >= 2 && (
              <Polygon
                paths={tempPoints}
                options={{ fillColor: '#ef4444', fillOpacity: 0.12, strokeColor: '#ef4444', strokeWeight: 2, strokeDasharray: '6 4' }}
              />
            )}

            {polygon && (
              <Polygon
                paths={polygon.coordinates[0].map(([lng, lat]) => ({ lat, lng }))}
                options={{ fillColor: '#ef4444', fillOpacity: 0.12, strokeColor: '#ef4444', strokeWeight: 2 }}
              />
            )}

            {/* Search result pin */}
            {searchPin && (
              <Marker
                position={{ lat: searchPin.lat, lng: searchPin.lng }}
                options={{
                  icon: {
                    path:        window.google.maps.SymbolPath.CIRCLE,
                    scale:       9,
                    fillColor:   '#f59e0b',
                    fillOpacity: 1,
                    strokeColor: '#ffffff',
                    strokeWeight: 2,
                  },
                  zIndex: 999,
                }}
              />
            )}

            {/* Clustered scan points */}
            {clusters.map((c, i) => (
              <Marker
                key={i}
                position={{ lat: c.lat, lng: c.lng }}
                icon={clusterIcon(c.count, c.score)}
                zIndex={c.count}
              />
            ))}
          </GoogleMap>

          {/* ── Search box overlay ── */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 w-80">
            <div className="relative">
              <div className="flex items-center bg-slate-900/95 border border-slate-700 rounded-xl shadow-2xl px-3 py-2.5 gap-2 backdrop-blur-sm">
                <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchInput}
                  onChange={handleSearchChange}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                  onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
                  placeholder="Search city, state or ZIP…"
                  className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-500 outline-none"
                />
                {searchInput && (
                  <button onClick={() => { setSearchInput(''); setSuggestions([]); setShowDropdown(false) }}
                    className="text-slate-600 hover:text-slate-400 transition">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Dropdown suggestions */}
              {showDropdown && suggestions.length > 0 && (
                <div className="absolute top-full mt-1 w-full bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onMouseDown={() => handleSelectSuggestion(s)}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-800 flex items-start gap-2.5 transition"
                    >
                      <svg className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                      </svg>
                      <div>
                        <p className="text-sm text-slate-200 truncate">{s.display_name.split(',').slice(0, 2).join(',')}</p>
                        <p className="text-xs text-slate-500 truncate">{s.display_name.split(',').slice(2, 4).join(',').trim()}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Point count badge */}
          {ptCount > 0 && (
            <div className="absolute top-4 left-4 bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 backdrop-blur-sm">
              {ptCount.toLocaleString()} properties scan
              {ptCount > 2000 && <span className="text-slate-500 ml-1">(showing 2,000)</span>}
            </div>
          )}

          {/* Mobile panel toggle */}
          <button
            onClick={() => setShowPanel(p => !p)}
            className="absolute bottom-4 right-4 z-10 lg:hidden flex items-center gap-1.5 px-3 py-2 bg-navy-800/95 border border-white/[0.10] rounded-xl text-xs font-medium text-slate-300 shadow-xl backdrop-blur-sm"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
            </svg>
            Scan Area
          </button>

        </div>
      </div>

      {/* ── Right panel ── */}
      <div className={`${showPanel ? 'flex' : 'hidden'} lg:flex flex-col bg-navy-800 border-l border-white/[0.06]
        absolute inset-0 z-20 lg:relative lg:inset-auto lg:z-auto lg:w-72`}>
        <div className="p-4 border-b border-white/[0.06] flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Scan Area</h3>
            <p className="text-xs text-slate-500 mt-0.5">Draw your target neighborhood</p>
          </div>
          <button
            onClick={() => setShowPanel(false)}
            className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.05] transition shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 p-4 space-y-5 overflow-y-auto">

          {/* Draw polygon */}
          {!polygon ? (
            <div>
              {drawingMode !== 'polygon' ? (
                <>
                  <p className="text-xs text-slate-500 mb-3">
                    Click Draw, then click on the map to place points around your target area.
                  </p>
                  <button
                    onClick={() => setDrawingMode('polygon')}
                    className="btn btn-outline w-full"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                    </svg>
                    Draw Area
                  </button>
                </>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400">
                    <span className="font-semibold text-brand-400">{tempPoints.length}</span> point{tempPoints.length !== 1 ? 's' : ''} placed — click the map to add more
                  </p>
                  <button
                    onClick={handleFinishDrawing}
                    disabled={tempPoints.length < 3}
                    className="btn btn-primary w-full disabled:opacity-40"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    Finish Drawing {tempPoints.length >= 3 ? '' : `(need ${3 - tempPoints.length} more)`}
                  </button>
                  <button
                    onClick={handleCancelDrawing}
                    className="btn btn-outline w-full"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-400">Polygon drawn</span>
                <button onClick={handleClear} className="text-xs text-slate-500 hover:text-red-400 transition">Clear</button>
              </div>
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                <p className="text-xs text-green-400">Area selected</p>
              </div>
            </div>
          )}

          {/* Point / property count */}
          {polygon && ptCount > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Properties in area</span>
              <span className="text-xs font-semibold text-slate-300">
                ~{ptCount.toLocaleString()}
              </span>
            </div>
          )}

          {/* Cost estimate */}
          {cost && (
            <div className="bg-navy-900 border border-white/[0.06] rounded-lg p-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400 font-semibold uppercase tracking-wide">Estimated Cost</span>
                <span className="text-brand-400 font-bold">${cost.total}</span>
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Run button */}
        <div className="p-4 border-t border-white/[0.06] space-y-2">
          {noKeyBlocked && (
            <p className="text-xs text-center text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
              No Google Maps API key — go to Settings to add one
            </p>
          )}
          {scanPoints?.length > 0 && !generating && !noKeyBlocked && !keyLoading && (
            <p className="text-xs text-center text-slate-400">
              {scanPoints.length.toLocaleString()} points from previous scan — re-draw to run again
            </p>
          )}
          <button
            onClick={handleGenerate}
            disabled={!polygon || generating || noKeyBlocked || keyLoading}
            className="btn-primary w-full"
          >
            {keyLoading ? (
              <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Loading…</>
            ) : generating ? (
              <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Generating points…</>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
                </svg>
                {scanPoints?.length > 0 ? 'Re-run Scan' : 'Run'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
