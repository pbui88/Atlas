import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { getProjects, deleteProject } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import ProjectCard from './ProjectCard'
import NewProjectModal from './NewProjectModal'

function Sparkline({ points = '0,20 10,16 20,18 30,10 40,14 50,6 60,10 70,4 80,8', color = '#3b82f6' }) {
  return (
    <svg viewBox="0 0 80 24" className="w-16 h-5 opacity-50" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StatCard({ label, value, sparkColor, sparkPoints, highlight }) {
  return (
    <div className="bg-navy-800 border border-white/[0.06] rounded-xl p-5">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{label}</p>
      <div className="flex items-end justify-between">
        <p className={`text-3xl font-bold font-display ${highlight ? 'text-brand-400' : 'text-white'}`}>
          {value}
        </p>
        <Sparkline color={sparkColor} points={sparkPoints} />
      </div>
    </div>
  )
}

function EmptyState({ onNew }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="w-16 h-16 rounded-2xl bg-brand-600/10 border border-brand-600/20 flex items-center justify-center mb-5">
        <svg className="w-8 h-8 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c-.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-slate-300 mb-2">No scan projects yet</h3>
      <p className="text-sm text-slate-600 mb-8 max-w-xs leading-relaxed">
        Create a project, draw your scan area on the map, and Atlas will start collecting Street View imagery.
      </p>
      <button onClick={onNew} className="btn-primary px-6 py-2.5">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New List
      </button>
    </div>
  )
}

export default function Dashboard() {
  const { openSidebar } = useOutletContext()
  const { profile } = useAuth()
  const [projects, setProjects] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showNew,  setShowNew]  = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await getProjects()

      // Batch-fix any projects stuck in a non-terminal status that have scan points.
      // Transient states (analyzing/collecting/queued) should not persist after
      // the scan tab closes — mark them complete so the DB matches the UI.
      const toFix = (data || [])
        .filter(p => ['analyzing', 'collecting', 'queued'].includes(p.status) && (p.total_points || 0) > 0)
        .map(p => p.id)
      if (toFix.length > 0) {
        await supabase.from('projects').update({ status: 'complete' }).in('id', toFix)
        data.forEach(p => { if (toFix.includes(p.id)) p.status = 'complete' })
      }

      setProjects(data || [])
    } catch { /* silent */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (id) => {
    if (!confirm('Delete this project and all its scan data?')) return
    try {
      await deleteProject(id)
      setProjects(p => p.filter(pr => pr.id !== id))
    } catch (err) { alert(err.message) }
  }

  const totalPoints    = projects.reduce((s, p) => s + (p.total_points || 0), 0)
  const activeProjects = projects.filter(p => ['collecting', 'analyzing'].includes(p.status)).length

  const firstName = profile?.full_name ? profile.full_name.split(' ')[0] : null

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-start gap-3">
          <button
            onClick={openSidebar}
            className="mt-1 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.05] transition lg:hidden shrink-0"
            aria-label="Open navigation"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold font-display text-white">
              {firstName ? `${firstName}'s Records` : 'Records'}
            </h1>
            <p className="text-sm text-slate-500 mt-1">Manage your neighborhood scan records</p>
          </div>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New List
        </button>
      </div>

      {/* Stats */}
      {projects.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <StatCard
            label="Total Records"
            value={projects.length}
            sparkColor="#3b82f6"
            sparkPoints="0,20 15,18 25,15 40,12 55,10 65,8 80,6"
          />
          <StatCard
            label="Active Scans"
            value={activeProjects}
            highlight={activeProjects > 0}
            sparkColor={activeProjects > 0 ? '#06b6d4' : '#475569'}
            sparkPoints="0,18 10,16 25,14 35,10 50,12 65,8 80,10"
          />
          <StatCard
            label="Properties Scan"
            value={totalPoints.toLocaleString()}
            sparkColor="#10b981"
            sparkPoints="0,22 10,18 25,16 35,12 50,10 65,6 80,4"
          />
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {projects.map(p => (
            <ProjectCard key={p.id} project={p} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} onCreated={load} />}
    </div>
  )
}
