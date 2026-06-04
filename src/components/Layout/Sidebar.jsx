import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

function NavItem({ to, icon, label }) {
  return (
    <NavLink
      to={to}
      end={to === '/dashboard'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
          isActive
            ? 'bg-brand-600/15 text-brand-400 border border-brand-600/25 shadow-sm shadow-brand-600/10'
            : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}

function UsageWidget() {
  const { usage } = useAuth()
  if (!usage) return null

  const { purchasedCredits = 0, purchasedCreditsUsed = 0 } = usage
  const remaining = Math.max(0, purchasedCredits - purchasedCreditsUsed)
  const pct       = purchasedCredits > 0 ? Math.min(100, Math.round((purchasedCreditsUsed / purchasedCredits) * 100)) : 0
  const empty     = remaining <= 0
  const low       = !empty && pct >= 75

  const barColor   = empty ? 'bg-red-500' : low ? 'bg-amber-400' : 'bg-brand-500'
  const labelColor = empty ? 'text-red-400' : low ? 'text-amber-400' : 'text-slate-300'

  return (
    <div className="px-3 pb-3">
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-500">Credits</span>
          <span className={`text-xs font-bold ${labelColor}`}>
            {remaining.toLocaleString()} left
          </span>
        </div>
        <div className="h-1 w-full bg-white/[0.06] rounded-full overflow-hidden mb-2">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: purchasedCredits > 0 ? `${100 - pct}%` : '0%' }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-600">
            {purchasedCreditsUsed.toLocaleString()} used
          </span>
          <span className="text-xs text-slate-600">
            {purchasedCredits.toLocaleString()} total
          </span>
        </div>
        {empty && purchasedCredits > 0 && (
          <div className="mt-2 flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 rounded-md px-2 py-1.5">
            <span className="w-1.5 h-1.5 bg-red-400 rounded-full shrink-0" />
            <span className="text-xs text-red-400 font-medium">Credits exhausted</span>
          </div>
        )}
        {empty && purchasedCredits === 0 && (
          <div className="mt-2 flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-md px-2 py-1.5">
            <span className="w-1.5 h-1.5 bg-amber-400 rounded-full shrink-0" />
            <span className="text-xs text-amber-400 font-medium">No credits — contact admin</span>
          </div>
        )}
        {!empty && low && (
          <div className="mt-2 flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-md px-2 py-1.5">
            <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse shrink-0" />
            <span className="text-xs text-amber-400 font-medium">{remaining.toLocaleString()} pts remaining</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Sidebar({ open, onClose }) {
  const { profile, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const initial = (profile?.full_name || profile?.email || 'U')[0].toUpperCase()

  return (
    <>
      {/* Backdrop — mobile only */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-50 w-56 shrink-0
        bg-navy-950 border-r border-white/[0.05] flex flex-col h-full
        transition-transform duration-200 ease-in-out
        ${open ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0
      `}>

        {/* Close button — mobile only */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.05] transition lg:hidden"
          aria-label="Close navigation"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Logo */}
        <div className="px-4 py-5 border-b border-white/[0.05]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center shadow-lg shadow-brand-600/30">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c-.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
              </svg>
            </div>
            <div>
              <span className="font-bold text-white text-sm tracking-tight block leading-none">Atlas</span>
              <span className="text-[10px] text-brand-500 font-semibold tracking-widest uppercase">AI Dream Team</span>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5">
          <NavItem
            to="/dashboard"
            label="Records"
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
            }
          />
          <NavItem
            to="/credits"
            label="Add Credits"
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
              </svg>
            }
          />
          {isAdmin && (
            <NavItem
              to="/admin"
              label="Admin"
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                </svg>
              }
            />
          )}
        </nav>

        {/* Usage */}
        <UsageWidget />

        {/* User */}
        <div className="p-3 border-t border-white/[0.05]">
          <div className="flex items-center gap-2.5 px-2 py-1.5 mb-1.5">
            <div className="w-7 h-7 rounded-full bg-brand-600/20 border border-brand-600/30 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-brand-400">{initial}</span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-200 truncate">
                {profile?.full_name || profile?.email || 'User'}
              </p>
              {isAdmin && <p className="text-[10px] text-brand-500 font-semibold">Admin</p>}
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-600 hover:text-slate-300 hover:bg-white/[0.04] transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
            Sign out
          </button>
        </div>
      </aside>
    </>
  )
}
