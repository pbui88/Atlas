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
        border-r border-white/[0.05] flex flex-col h-full
        transition-transform duration-200 ease-in-out
        ${open ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0
      `}
        style={{
          backgroundImage: 'url(/hero.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        {/* Dark overlay so content remains readable */}
        <div className="absolute inset-0 bg-navy-950/85 pointer-events-none" />

        {/* Close button — mobile only */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.05] transition lg:hidden"
          aria-label="Close navigation"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Logo */}
        <div className="relative z-10 px-4 py-4 border-b border-white/[0.05] flex justify-center">
          <img
            src="/atlas_logo.jpeg"
            alt="AI Dream Team"
            className="h-[7.5rem] w-auto"
            style={{
              maskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%)',
              WebkitMaskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%)',
            }}
          />
        </div>

        {/* Nav */}
        <nav className="relative z-10 flex-1 p-3 space-y-0.5">
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
            label="Credits"
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
          <NavItem
            to="/settings"
            label="Settings"
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.109-.94h1.096c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.774.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.764.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.27 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.02-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
          />
        </nav>

        {/* Usage */}
        <div className="relative z-10"><UsageWidget /></div>

        {/* User */}
        <div className="relative z-10 p-3 border-t border-white/[0.05]">
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
