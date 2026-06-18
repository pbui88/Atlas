import { useNavigate } from 'react-router-dom'
import { STATUS_LABELS, STATUS_BADGE_CLASS } from '../../lib/constants'

export default function ProjectCard({ project, onDelete }) {
  const navigate = useNavigate()
  const fmt = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  // Transient states (analyzing/collecting/queued) should never persist on the
  // dashboard — if the project has scan points it's effectively complete.
  const displayStatus = (
    ['analyzing', 'collecting', 'queued'].includes(project.status) && (project.total_points || 0) > 0
  ) ? 'complete' : project.status

  return (
    <div
      onClick={() => navigate(`/projects/${project.id}`)}
      className="group relative bg-navy-800 border border-white/[0.06] rounded-xl p-4 cursor-pointer hover:border-brand-600/30 hover:bg-navy-700 transition-all"
    >
      {/* Top row: status + menu */}
      <div className="flex items-start justify-between mb-3">
        <span className={STATUS_BADGE_CLASS[displayStatus] || 'badge-slate'}>
          {STATUS_LABELS[displayStatus] || displayStatus}
        </span>
        <button
          onClick={e => { e.stopPropagation(); onDelete(project.id) }}
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-red-500/10 text-slate-600 hover:text-red-400 transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Project name */}
      <h3 className="font-semibold text-slate-200 text-sm leading-snug line-clamp-2 mb-3">
        {project.name}
      </h3>

      {/* Bottom row: meta + icon */}
      <div className="flex items-end justify-between">
        <div className="space-y-0.5">
          <p className="text-xs text-slate-400">
            <span className="text-slate-200 font-semibold">{project.total_points.toLocaleString()}</span> properties
            {project.failed_points > 0 && (
              <span className="text-red-400 ml-2">{project.failed_points} failed</span>
            )}
          </p>
          <p className="text-xs text-slate-600">{fmt(project.created_at)}</p>
        </div>
        <div className="w-8 h-8 rounded-lg bg-brand-600/10 border border-brand-600/15 flex items-center justify-center shrink-0 group-hover:bg-brand-600/20 transition-colors">
          <svg className="w-4 h-4 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
          </svg>
        </div>
      </div>
    </div>
  )
}
