import { useOutletContext } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

function CreditIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function StatCard({ value, label, accent = false }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={`text-2xl sm:text-3xl font-bold tabular-nums tracking-tight ${accent ? 'text-brand-400' : 'text-white'}`}>
        {value}
      </span>
      <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">{label}</span>
    </div>
  )
}

export default function BuyCreditsPage() {
  const { openSidebar } = useOutletContext()
  const { usage } = useAuth()

  return (
    <div className="min-h-full bg-slate-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8 sm:mb-10">
          <button
            onClick={openSidebar}
            className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.05] transition lg:hidden shrink-0"
            aria-label="Open navigation"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-7 h-7 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center text-brand-400">
                <CreditIcon />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Credits</h1>
            </div>
            <p className="text-sm text-slate-500">Track your scan credit balance and usage</p>
          </div>
        </div>

        {/* Balance strip */}
        {usage && (
          <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 to-navy-900 border border-white/[0.07] rounded-2xl p-5 sm:p-6 mb-8 sm:mb-10">
            <div className="absolute inset-0 bg-gradient-to-r from-brand-600/5 via-transparent to-cyan-500/5 pointer-events-none" />
            <div className="relative">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-4">Account Balance</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
                <StatCard value={usage.remaining.toLocaleString()} label="Total remaining" accent />
                <StatCard value={usage.used.toLocaleString()} label="Used this cycle" />
                <StatCard value={usage.limit.toLocaleString()} label="Monthly quota" />
                {usage.purchasedCredits > 0 && (
                  <StatCard value={usage.purchasedRemaining.toLocaleString()} label="Granted left" accent />
                )}
              </div>
              {usage.purchasedCredits > 0 && (
                <div className="mt-4 pt-4 border-t border-white/[0.05]">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-slate-500">Credits used</span>
                    <span className="text-xs text-slate-400 tabular-nums">
                      {usage.purchasedCreditsUsed?.toLocaleString() ?? 0} / {usage.purchasedCredits.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-brand-600 to-brand-400 rounded-full transition-all duration-700"
                      style={{ width: `${Math.min(100, ((usage.purchasedCreditsUsed ?? 0) / usage.purchasedCredits) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Need more credits */}
        <div className="flex flex-col items-center text-center bg-slate-900 border border-white/[0.06] rounded-2xl px-6 py-10 sm:py-12">
          <div className="w-12 h-12 rounded-xl bg-brand-600/15 border border-brand-600/25 flex items-center justify-center text-brand-400 mb-4">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-white mb-2">Need more credits?</h2>
          <p className="text-sm text-slate-500 max-w-md">
            Scan credits are granted by your administrator. Contact your admin to request additional credits for your account.
          </p>
        </div>

      </div>
    </div>
  )
}
