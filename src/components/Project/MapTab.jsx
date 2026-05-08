import { useState, useCallback, useRef } from 'react'
import { GoogleMap, DrawingManager, Polygon, Marker } from '@react-google-maps/api'
import { generatePoints } from '../../lib/api'
import { generateGridPoints, estimateCost, polygonBbox } from '../../lib/geo'
import { scoreColor } from '../../lib/geo'

const MAP_STYLE = [
  { elementType: 'geometry',            stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill',    stylers: [{ color: '#8892a4' }] },
  { elementType: 'labels.text.stroke',  stylers: [{ color: '#1a1a2e' }] },
  { featureType: 'road',                elementType: 'geometry', stylers: [{ color: '#2d2d44' }] },
  { featureType: 'road',                elementType: 'labels.text.fill', stylers: [{ color: '#8892a4' }] },
  { featureType: 'water',               elementType: 'geometry', stylers: [{ color: '#0f1a2e' }] },
  { featureType: 'poi',                 stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative',      elementType: 'geometry', stylers: [{ color: '#314158' }] },
  { featureType: 'transit',             stylers: [{ visibility: 'off' }] },
]

const DEFAULT_CENTER = { lat: 33.4484, lng: -112.0740 } // Phoenix

function CostBadge({ cost }) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-slate-400">Est. cost:</span>
      <span className="font-mono text-slate-200">
        SV <span className="text-brand-400">${cost.streetView}</span>
        {' · '}Geo <span className="text-brand-400">${cost.geocoding}</span>
        {' · '}AI <span className="text-brand-400">${cost.ai}</span>
        {' = '}
        <span className="font-bold text-white">${cost.total}</span>
      </span>
    </div>
  )
}

export default function MapTab({ project, scanPoints, onPointsGenerated, isLoaded, loadError }) {
  const [drawingMode, setDrawingMode] = useState(null)
  const [polygon,     setPolygon]     = useState(project.scan_area_geojson || null)
  const [spacing,     setSpacing]     = useState(project.point_spacing_meters || 50)
  const [preview,     setPreview]     = useState([])  // local preview points
  const [cost,        setCost]        = useState(null)
  const [generating,  setGenerating]  = useState(false)
  const [error,       setError]       = useState(null)
  const mapRef = useRef(null)

  const onMapLoad = useCallback((map) => {
    mapRef.current = map
    if (polygon) {
      // Fit map to saved polygon
      const bounds = new window.google.maps.LatLngBounds()
      polygon.coordinates[0].forEach(([lng, lat]) => bounds.extend({ lat, lng }))
      map.fitBounds(bounds, 60)
    }
  }, [polygon])

  const handlePolygonComplete = useCallback((poly) => {
    const path = poly.getPath().getArray()
    const coords = path.map(ll => [ll.lng(), ll.lat()])
    coords.push(coords[0]) // close ring
    const geoJson = { type: 'Polygon', coordinates: [coords] }
    poly.setMap(null)
    setPolygon(geoJson)
    setDrawingMode(null)
    // Local preview
    const pts = generateGridPoints(geoJson, spacing)
    setPreview(pts)
    setCost(estimateCost(pts.length))
  }, [spacing])

  const handleSpacingChange = (val) => {
    setSpacing(val)
    if (polygon) {
      const pts = generateGridPoints(polygon, val)
      setPreview(pts)
      setCost(estimateCost(pts.length))
    }
  }

  const handleGenerate = async () => {
    if (!polygon) return
    setGenerating(true)
    setError(null)
    try {
      const result = await generatePoints(project.id, {
        geojson: polygon,
        spacingMeters: spacing,
      })
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
  const ptCount = displayPoints.length

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
      {/* Map */}
      <div className="flex-1 relative">
        <GoogleMap
          mapContainerStyle={{ width: '100%', height: '100%' }}
          center={DEFAULT_CENTER}
          zoom={12}
          options={{ styles: MAP_STYLE, disableDefaultUI: false, zoomControl: true, streetViewControl: false, mapTypeControl: false }}
          onLoad={onMapLoad}
        >
          {/* Drawing manager */}
          {!polygon && (
            <DrawingManager
              drawingMode={drawingMode}
              options={{
                drawingControl: false,
                polygonOptions: {
                  fillColor: '#ea580c',
                  fillOpacity: 0.15,
                  strokeColor: '#ea580c',
                  strokeWeight: 2,
                },
              }}
              onPolygonComplete={handlePolygonComplete}
            />
          )}

          {/* Drawn polygon overlay */}
          {polygon && (
            <Polygon
              paths={polygon.coordinates[0].map(([lng, lat]) => ({ lat, lng }))}
              options={{
                fillColor: '#ea580c',
                fillOpacity: 0.08,
                strokeColor: '#ea580c',
                strokeWeight: 2,
              }}
            />
          )}

          {/* Scan points (clustered visually by showing small dots) */}
          {displayPoints.slice(0, 2000).map((pt, i) => (
            <Marker
              key={`${pt.id || i}`}
              position={{ lat: pt.lat, lng: pt.lng }}
              options={{
                icon: {
                  path: window.google.maps.SymbolPath.CIRCLE,
                  scale: 3,
                  fillColor: pt.overall_score != null ? scoreColor(pt.overall_score) : '#ea580c',
                  fillOpacity: 0.8,
                  strokeColor: 'transparent',
                },
              }}
            />
          ))}
        </GoogleMap>

        {/* Point count overlay */}
        {ptCount > 0 && (
          <div className="absolute top-4 left-4 bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 backdrop-blur-sm">
            {ptCount.toLocaleString()} scan points
            {ptCount > 2000 && <span className="text-slate-500 ml-1">(showing 2,000)</span>}
          </div>
        )}
      </div>

      {/* Right panel */}
      <div className="w-72 bg-slate-950 border-l border-slate-800 flex flex-col">
        <div className="p-4 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-slate-200">Scan Area</h3>
          <p className="text-xs text-slate-500 mt-0.5">Draw your target neighborhood</p>
        </div>

        <div className="flex-1 p-4 space-y-5 overflow-y-auto">
          {/* Draw button */}
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
                <span className="text-xs font-medium text-slate-300">Polygon drawn</span>
                <button onClick={handleClear} className="text-xs text-slate-500 hover:text-red-400 transition">
                  Clear
                </button>
              </div>
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                <p className="text-xs text-green-400">Area selected</p>
              </div>
            </div>
          )}

          {/* Spacing */}
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
              <span className="text-sm font-mono text-slate-300 w-14 text-right">{spacing}m</span>
            </div>
            <p className="text-xs text-slate-600 mt-1">Smaller = more points, higher cost</p>
          </div>

          {/* Cost estimate */}
          {cost && (
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 space-y-2">
              <p className="text-xs font-medium text-slate-300">Estimated Cost</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Street View ({ptCount * 4} imgs)</span>
                  <span className="text-slate-300">${cost.streetView}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Geocoding</span>
                  <span className="text-slate-300">${cost.geocoding}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">AI Analysis</span>
                  <span className="text-slate-300">${cost.ai}</span>
                </div>
                <div className="divider pt-1 mt-1" />
                <div className="flex justify-between font-semibold">
                  <span className="text-slate-300">Total</span>
                  <span className="text-brand-400">${cost.total}</span>
                </div>
              </div>
              <p className="text-xs text-slate-600 pt-1">{ptCount.toLocaleString()} points × 4 directions</p>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Generate button */}
        <div className="p-4 border-t border-slate-800">
          {scanPoints?.length > 0 ? (
            <div className="text-center">
              <p className="text-xs text-green-400 mb-2">
                {scanPoints.length.toLocaleString()} points generated
              </p>
              <p className="text-xs text-slate-500">Go to the Scan tab to start image collection.</p>
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
