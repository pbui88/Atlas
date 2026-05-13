import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useJsApiLoader } from '@react-google-maps/api'
import { supabase } from '../../lib/supabase'
import { updateProject } from '../../lib/api'
import { STATUS_LABELS, STATUS_BADGE_CLASS } from '../../lib/constants'
import MapTab     from './MapTab'
import ScanTab    from './ScanTab'
import ResultsTab from './ResultsTab'

const LIBRARIES = ['drawing', 'geometry']

const TABS = [
  {
    id: 'map',
    label: 'Map',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c-.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
      </svg>
    ),
  },
  {
    id: 'scan',
    label: 'Scan',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75z" />
      </svg>
    ),
  },
  {
    id: 'results',
    label: 'Results',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
]

export default function ProjectPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY || '',
    libraries: LIBRARIES,
  })
  const [project,    setProject]    = useState(null)
  const [scanPoints, setScanPoints] = useState([])
  const [activeTab,  setActiveTab]  = useState('map')
  const [loading,    setLoading]    = useState(true)

  const loadProject = async () => {
    const { data: proj } = await supabase.from('projects').select('*').eq('id', id).single()
    if (!proj) { navigate('/'); return }
    setProject(proj)

    const { data: pts } = await supabase
      .from('scan_points')
      .select('id, lat, lng, status')
      .eq('project_id', id)
      .limit(5000)
    setScanPoints(pts || [])
    setLoading(false)

    if (pts?.length > 0 && activeTab === 'map') setActiveTab('scan')
  }

  useEffect(() => { loadProject() }, [id])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!project) return null

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <header className="flex items-center gap-4 px-5 py-3 border-b border-slate-200 shrink-0 bg-white">
        <Link to="/" className="text-slate-400 hover:text-slate-700 transition">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-slate-900 truncate">{project.name}</h1>
            <span className={`${STATUS_BADGE_CLASS[project.status] || 'badge-slate'} shrink-0`}>
              {STATUS_LABELS[project.status] || project.status}
            </span>
          </div>
          {scanPoints.length > 0 && (
            <p className="text-xs text-slate-400">{scanPoints.length.toLocaleString()} scan points</p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center bg-slate-100 border border-slate-200 rounded-lg p-0.5 gap-0.5">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'map' && (
          <MapTab
            project={project}
            scanPoints={scanPoints}
            onPointsGenerated={() => loadProject()}
            isLoaded={isLoaded}
            loadError={loadError}
          />
        )}
        {activeTab === 'scan' && (
          <ScanTab
            project={project}
            onProjectUpdate={loadProject}
          />
        )}
        {activeTab === 'results' && (
          <ResultsTab project={project} isLoaded={isLoaded} />
        )}
      </div>
    </div>
  )
}
