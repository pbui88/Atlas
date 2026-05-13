import { useState, useCallback, useRef, useEffect } from 'react'
import { GoogleMap, DrawingManager, Polygon, Marker } from '@react-google-maps/api'
import { generatePoints } from '../../lib/api'
import { generateGridPoints, estimateCost } from '../../lib/geo'
import { scoreColor } from '../../lib/geo'

const MAP_STYLE = [
  { elementType: 'geometry',           stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#8892a4' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { featureType: 'road',               elementType: 'geometry',         stylers: [{ color: '#2d2d44' }] },
  { featureType: 'road',               elementType: 'labels.text.fill', stylers: [{ color: '#8892a4' }] },
  { featureType: 'water',              elementType: 'geometry',         stylers: [{ color: '#0f1a2e' }] },
  { featureType: 'poi',                stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative',     elementType: 'geometry',         stylers: [{ color: '#314158' }] },
  { featureType: 'transit',            stylers: [{ visibility: 'off' }] },
]

const US_CENTER = { lat: 39.5, lng: -98.35 }

export default function MapTab({ project, scanPoints, onPointsGenerated, isLoaded, loadError, selectedPointIds, onSelectionChange }) {
  const [drawingMode,  setDrawingMode]  = useState(null)
  const [polygon,      setPolygon]      = useState(project.scan_area_geojson || null)
  const [spacing,      setSpacing]      = useState(project.point_spacing_meters || 50)
  const [preview,      setPreview]      = useState([])
  const [cost,         setCost]         = useState(null)
  const [generating,   setGenerating]   = useState(false)
  const [error,        setError]        = useState(null)
  const [searchPin,    setSearchPin]    = useState(null)
  const [searchInput,  setSearchInput]  = useState('')
  const [suggestions,  setSuggestions]  = useState([])
  const [showDropdown, setShowDropdown] = useState(false)

  const togglePoint = useCallback((pointId) => {
    onSelectionChange(prev => {
      const next = new Set(prev)
      if (next.has(pointId)) next.delete(pointId)
      else next.add(pointId)
      return next
    })
  }, [onSelectionChange])

  const clearSelection = () => onSelectionChange(new Set())

  const mapRef         = useRef(null)
  const drawingMgrRef  = useRef(null)
  const searchInputRef = useRef(null)
  const debounceRef    = useRef(null)

  // Nominatim (OpenStreetMap) autocomplete — no API key required
  const fetchSuggestions = async (input) => {
    if (!input || input.length < 2) { setSuggestions([]); setShowDropdown(false); return }
    try {
      const res  = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input)}&format=json&countrycodes=us&limit=5&addressdetails=1`,
        { headers: { 'Accept-Language': 'en-US' } }
      )
      const data = await res.json()
      setSuggestions(data)
      setShowDropdown(data.length > 0)
    } catch { setSuggestions([]); setShowDropdown(false) }
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
    mapRef.current?.panTo({ lat, lng })
    mapRef.current?.setZoom(14)
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

  // Imperatively sync drawing mode to native DrawingManager instance
  useEffect(() => {
    if (!drawingMgrRef.current) return
    const mode = drawingMode ? window.google.maps.drawing.OverlayType.POLYGON : null
    drawingMgrRef.current.setDrawingMode(mode)
  }, [drawingMode])

  const handlePolygonComplete = useCallback((poly) => {
    const path   = poly.getPath().getArray()
    const coords = path.map(ll => [ll.lng(), ll.lat()])
    coords.push(coords[0])
    const geoJson = { type: 'Polygon', coordinates: [coords] }
    poly.setMap(null)
    setPolygon(geoJson)
    setDrawingMode(null)
    const pts = generateGridPoints(geoJson, spacing)
    setPreview(pts)
    setCost(estimateCost(pts.length, 1))
  }, [spacing])

  const handleSpacingChange = (val) => {
    setSpacing(val)
    if (polygon) {
      const pts = generateGridPoints(polygon, val)
      setPreview(pts)
      setCost(estimateCost(pts.length, 1))
    }
  }

  const handleGenerate = async () => {
    if (!polygon) return
    setGenerating(true)
    setError(null)
    try {
      const result = await generatePoints(project.id, { geojson: polygon, spacingMeters: spacing })
      onPointsGenerated(result)
      setPreview([])
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
              styles: MAP_STYLE,
              zoomControl: true,
              streetViewControl: false,
              mapTypeControl: false,
              fullscreenControl: false,
            }}
            onLoad={onMapLoad}
          >
            {/* Drawing manager */}
            {!polygon && (
              <DrawingManager
                onLoad={dm => { drawingMgrRef.current = dm }}
                options={{
                  drawingControl: false,
                  polygonOptions: {
                    fillColor:   '#0d9488',
                    fillOpacity: 0.15,
                    strokeColor: '#0d9488',
                    strokeWeight: 2,
                  },
                }}
                onPolygonComplete={handlePolygonComplete}
              />
            )}

            {polygon && (
              <Polygon
                paths={polygon.coordinates[0].map(([lng, lat]) => ({ lat, lng }))}
                options={{ fillColor: '#0d9488', fillOpacity: 0.08, strokeColor: '#0d9488', strokeWeight: 2 }}
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

            {/* Scan points — clickable to select for scanning */}
            {displayPoints.slice(0, 2000).map((pt, i) => {
              const isSelected = pt.id && selectedPointIds?.has(pt.id)
              return (
                <Marker
                  key={`${pt.id || i}`}
                  position={{ lat: pt.lat, lng: pt.lng }}
                  onClick={pt.id ? () => togglePoint(pt.id) : undefined}
                  options={{
                    icon: {
                      path:        window.google.maps.SymbolPath.CIRCLE,
                      scale:       isSelected ? 5 : 3,
                      fillColor:   isSelected ? '#3b82f6' : (pt.overall_score != null ? scoreColor(pt.overall_score) : '#0d9488'),
                      fillOpacity: isSelected ? 1 : 0.8,
                      strokeColor: isSelected ? '#ffffff' : 'transparent',
                      strokeWeight: isSelected ? 1.5 : 0,
                    },
                    zIndex: isSelected ? 10 : 1,
                  }}
                />
              )
            })}
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

          {/* Point count / selection badge */}
          {ptCount > 0 && (
            <div className="absolute top-4 left-4 flex flex-col gap-1.5">
              <div className="bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 backdrop-blur-sm">
                {ptCount.toLocaleString()} scan points
                {ptCount > 2000 && <span className="text-slate-500 ml-1">(showing 2,000)</span>}
              </div>
              {(selectedPointIds?.size ?? 0) > 0 && (
                <div className="bg-blue-600/90 border border-blue-500 rounded-lg px-3 py-1.5 text-xs text-white font-medium backdrop-blur-sm">
                  {selectedPointIds.size} selected for scan
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="w-72 bg-white border-l border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Scan Area</h3>
          <p className="text-xs text-slate-500 mt-0.5">Draw your target neighborhood</p>
        </div>

        <div className="flex-1 p-4 space-y-5 overflow-y-auto">
          {/* Draw polygon */}
          {!polygon ? (
            <div>
              <p className="text-xs text-slate-500 mb-3">
                Click below, then draw a polygon on the map around the neighborhood you want to scan.
              </p>
              <button
                onClick={() => setDrawingMode('polygon')}
                className={`btn w-full ${drawingMode === 'polygon' ? 'btn-primary' : 'btn-outline'}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                </svg>
                {drawingMode === 'polygon' ? 'Drawing… click map to place points' : 'Draw Polygon'}
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-700">Polygon drawn</span>
                <button onClick={handleClear} className="text-xs text-slate-400 hover:text-red-500 transition">Clear</button>
              </div>
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                <p className="text-xs text-green-400">Area selected</p>
              </div>
            </div>
          )}

          {/* Point spacing */}
          <div>
            <label className="label">Point Spacing</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={20} max={200} step={10}
                value={spacing}
                onChange={e => handleSpacingChange(+e.target.value)}
                className="flex-1 accent-brand-500"
              />
              <span className="text-sm font-mono text-slate-700 w-14 text-right">{spacing}m</span>
            </div>
            <p className="text-xs text-slate-600 mt-1">Smaller = more points, higher cost</p>
          </div>

          {/* Cost estimate */}
          {cost && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Estimated Cost</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Street View ({ptCount} imgs)</span>
                  <span className="text-slate-700">${cost.streetView}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Geocoding</span>
                  <span className="text-emerald-600">Free</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">AI Analysis</span>
                  <span className="text-slate-700">${cost.ai}</span>
                </div>
                <div className="divider pt-1 mt-1" />
                <div className="flex justify-between font-semibold">
                  <span className="text-slate-700">Total</span>
                  <span className="text-brand-600">${cost.total}</span>
                </div>
              </div>
              <p className="text-xs text-slate-400 pt-1">
                ≤ {ptCount.toLocaleString()} pts × 1 img — road points may be fewer
              </p>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Point selection controls — shown after points generated */}
        {scanPoints?.length > 0 && (
          <div className="px-4 py-3 border-b border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">Select Points to Scan</span>
              <span className="text-xs text-brand-600 font-medium tabular-nums">
                {selectedPointIds?.size ?? 0} selected
              </span>
            </div>
            <p className="text-[11px] text-slate-500">Click dots on the map to select. Only selected points will be scanned, saving API cost.</p>
            {(selectedPointIds?.size ?? 0) > 0 && (
              <button onClick={clearSelection} className="w-full text-xs py-1.5 btn border border-red-200 text-red-500 hover:bg-red-50 bg-white">
                Clear Selection
              </button>
            )}
          </div>
        )}

        {/* Generate button */}
        <div className="p-4 border-t border-slate-200">
          {scanPoints?.length > 0 ? (
            <div className="text-center">
              <p className="text-xs text-green-600 font-medium mb-2">
                {scanPoints.length.toLocaleString()} points generated
              </p>
              <p className="text-xs text-slate-500">Select points above, then go to Results to scan.</p>
            </div>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={!polygon || generating}
              className="btn-primary w-full"
            >
              {generating ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Generating…</>
              ) : (
                <>Generate {ptCount > 0 ? `${ptCount.toLocaleString()} ` : ''}Points</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
