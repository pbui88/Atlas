import { useEffect, useState } from 'react'
import { getProjects, deleteProject } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import ProjectCard from './ProjectCard'
import NewProjectModal from './NewProjectModal'

function EmptyState({ onNew }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-5">
        <svg className="w-8 h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-slate-300 mb-2">No scan projects yet</h3>
      <p className="text-sm text-slate-500 mb-8 max-w-xs">
        Create a project, draw your scan area on the map, and Atlas will start collecting Street View imagery.
      </p>
      <button onClick={onNew} className="btn-primary px-6 py-2.5">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New Project
      </button>
    </div>
  )
}

export default function Dashboard() {
  const { profile } = useAuth()
  const [projects, setProjects] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showNew,  setShowNew]  = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await getProjects()
      setProjects(data)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (id) => {
    if (!confirm('Delete this project and all its scan data?')) return
    try {
      await deleteProject(id)
      setProjects(p => p.filter(pr => pr.id !== id))
    } catch (err) {
      alert(err.message)
    }
  }

  // Summary stats
  const totalPoints    = projects.reduce((s, p) => s + (p.total_points || 0), 0)
  const activeProjects = projects.filter(p => ['collecting', 'analyzing'].includes(p.status)).length
  const completeCount  = projects.filter(p => p.status === 'complete').length

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">
            {profile?.full_name ? `${profile.full_name.split(' ')[0]}'s Projects` : 'Projects'}
          </h1>
          <p className="text-sm text-slate-500 mt-1">Manage your neighborhood scan projects</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Project
        </button>
      </div>

      {/* Stats bar */}
      {projects.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Total Projects',  value: projects.length },
            { label: 'Active Scans',    value: activeProjects,  highlight: activeProjects > 0 },
            { label: 'Scan Points',     value: totalPoints.toLocaleString() },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <p className="text-xs text-slate-500 mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.highlight ? 'text-brand-400' : 'text-slate-100'}`}>
                {s.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-32">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState onNew={() => setShowNew(true)} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {projects.map(p => (
            <ProjectCard key={p.id} project={p} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
    </div>
  )
}
