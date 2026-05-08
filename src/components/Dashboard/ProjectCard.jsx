import { useNavigate } from 'react-router-dom'
import { STATUS_LABELS, STATUS_BADGE_CLASS } from '../../lib/constants'

function ProgressRing({ pct, size = 36, stroke = 3 }) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (pct / 100) * circ
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={pct === 100 ? '#22c55e' : '#ea580c'}
        strokeWidth={stroke}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.4s ease' }}
      />
    </svg>
  )
}

export default function ProjectCard({ project, onDelete }) {
  const navigate = useNavigate()
  const pct = project.total_points > 0
    ? Math.round((project.completed_points / project.total_points) * 100)
    : 0

  const fmt = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div
      onClick={() => navigate(`/projects/${project.id}`)}
      className="card-hover group relative"
    >
      {/* Status badge */}
      <div className="flex items-start justify-between mb-3">
        <span className={STATUS_BADGE_CLASS[project.status] || 'badge-slate'}>
          {STATUS_LABELS[project.status] || project.status}
        </span>
        <button
          onClick={e => { e.stopPropagation(); onDelete(project.id) }}
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-slate-800 text-slate-500 hover:text-red-400 transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Title */}
      <h3 className="font-semibold text-slate-100 mb-1 text-sm leading-snug line-clamp-2">
        {project.name}
      </h3>
      {project.description && (
        <p className="text-xs text-slate-500 mb-4 line-clamp-2">{project.description}</p>
      )}

      {/* Stats row */}
      <div className="flex items-center justify-between mt-4">
        <div className="space-y-1">
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span><span className="text-slate-300 font-medium">{project.total_points.toLocaleString()}</span> pts</span>
            {project.failed_points > 0 && (
              <span className="text-red-400">{project.failed_points} failed</span>
            )}
          </div>
          <p className="text-xs text-slate-600">{fmt(project.created_at)}</p>
        </div>

        {project.total_points > 0 && (
          <div className="relative flex items-center justify-center">
            <ProgressRing pct={pct} />
            <span className="absolute text-[9px] font-bold text-slate-300 rotate-90">{pct}%</span>
          </div>
        )}
      </div>
    </div>
  )
}
