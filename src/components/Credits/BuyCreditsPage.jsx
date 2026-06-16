import { useState, useEffect } from 'react'
import { useSearchParams, useOutletContext, useNavigate } from 'react-router-dom'
import { createPayment } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'

const PACKAGES = [
  { points:  2500, price:  35, perPoint: '1.4¢' },
  { points:  5000, price:  70, perPoint: '1.4¢' },
  { points: 10000, price: 140, perPoint: '1.4¢' },
  { points: 15000, price: 210, perPoint: '1.4¢', popular: true },
  { points: 20000, price: 280, perPoint: '1.4¢' },
]

const VALID_POINTS = new Set(PACKAGES.map(p => p.points))

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

// Builds a hidden form and submits it, navigating the browser to
// Authorize.net's hosted payment page (Accept Hosted).
function redirectToHostedForm(formUrl, token) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = formUrl

  const input = document.createElement('input')
  input.type  = 'hidden'
  input.name  = 'token'
  input.value = token
  form.appendChild(input)

  document.body.appendChild(form)
  form.submit()
}

export default function BuyCreditsPage() {
  const { openSidebar } = useOutletContext()
  const { usage, refreshUsage } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [loading,      setLoading]      = useState(null)
  const [paymentError, setPaymentError] = useState(null)

  const [showSuccess, setShowSuccess] = useState(false)
  const [successPts,  setSuccessPts]  = useState(0)

  const rawPts   = parseInt(searchParams.get('purchase') || '0', 10)
  const addedPts = VALID_POINTS.has(rawPts) ? rawPts : 0
  const success  = addedPts > 0

  useEffect(() => {
    if (!success || addedPts <= 0) return
    setShowSuccess(true)
    setSuccessPts(addedPts)
    refreshUsage()
    navigate('/credits', { replace: true })
  }, [success, addedPts, refreshUsage, navigate])

  // Reset loading when the user navigates back from the Authorize.net page
  // via the browser Back button (page is restored from bfcache with stale state).
  useEffect(() => {
    const handlePageShow = (e) => { if (e.persisted) setLoading(null) }
    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [])

  const handleBuy = async (points) => {
    setLoading(points)
    setPaymentError(null)
    try {
      const { token, formUrl } = await createPayment(points)
      redirectToHostedForm(formUrl, token)
    } catch (e) {
      setPaymentError(e.message)
      setLoading(null)
    }
  }

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
            <p className="text-sm text-slate-500">Track your scan credit balance and buy more when you need them</p>
          </div>
        </div>

        {/* Success banner */}
        {showSuccess && successPts > 0 && (
          <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3.5 mb-6">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-sm text-emerald-300 font-medium flex-1">
              Payment received — <span className="font-bold">{successPts.toLocaleString()} credits</span> will appear on your account shortly.
            </p>
            <button onClick={() => setShowSuccess(false)} className="text-emerald-600 hover:text-emerald-400 transition p-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Error banner */}
        {paymentError && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3.5 mb-6">
            <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <p className="text-sm text-red-300 font-medium flex-1">{paymentError}</p>
            <button onClick={() => setPaymentError(null)} className="text-red-500 hover:text-red-300 transition p-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}


        {/* Balance strip */}
        {usage && (
          <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 to-navy-900 border border-white/[0.07] rounded-2xl p-5 sm:p-6 mb-8 sm:mb-10">
            <div className="absolute inset-0 bg-gradient-to-r from-brand-600/5 via-transparent to-cyan-500/5 pointer-events-none" />
            <div className="relative">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-4">Account Balance</p>
              <div className="grid grid-cols-2 gap-4 sm:gap-6">
                <StatCard value={usage.used.toLocaleString()} label="Used this cycle" />
                {usage.purchasedCredits > 0 && (
                  <StatCard value={usage.purchasedRemaining.toLocaleString()} label="Credits left" accent />
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

        {/* Section label */}
        <div className="flex items-center gap-3 mb-5">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">Buy more credits</p>
          <div className="flex-1 h-px bg-white/[0.05]" />
          <p className="text-[11px] text-slate-600">All at 1.4¢ per credit</p>
        </div>

        {/* Package cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4 mb-8">
          {PACKAGES.map((pkg) => {
            return (
            <div
              key={pkg.points}
              className={`group relative flex flex-col rounded-2xl overflow-hidden transition-all duration-200 hover:-translate-y-0.5 ${
                pkg.popular
                  ? 'bg-gradient-to-b from-brand-600/15 to-slate-900 border border-brand-500/40 shadow-lg shadow-brand-600/10'
                  : 'bg-slate-900 border border-white/[0.06] hover:border-white/[0.12]'
              }`}
            >
              {pkg.popular && (
                <div className="bg-brand-600 px-3 py-1.5 text-center">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white">Most Popular</span>
                </div>
              )}

              <div className="flex flex-col flex-1 p-5">
                {/* Credits */}
                <div className="mb-4">
                  <p className={`text-2xl sm:text-3xl font-bold tabular-nums tracking-tight mb-0.5 ${pkg.popular ? 'text-white' : 'text-slate-100'}`}>
                    {pkg.points.toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">scan credits</p>
                </div>

                {/* Price */}
                <div className="mb-5">
                  <p className={`text-xl font-bold ${pkg.popular ? 'text-brand-400' : 'text-slate-300'}`}>
                    ${pkg.price.toFixed(2)}
                  </p>
                  <p className="text-[11px] text-slate-600 mt-0.5">{pkg.perPoint} per credit</p>
                </div>

                {/* Divider */}
                <div className={`h-px mb-4 ${pkg.popular ? 'bg-brand-500/20' : 'bg-white/[0.05]'}`} />

                {/* What you get */}
                <div className="flex items-center gap-2 mb-5">
                  <svg className={`w-3.5 h-3.5 shrink-0 ${pkg.popular ? 'text-brand-400' : 'text-slate-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                  <span className="text-xs text-slate-500">{pkg.points.toLocaleString()} property scans</span>
                </div>

                {/* Button */}
                <button
                  onClick={() => handleBuy(pkg.points)}
                  disabled={!!loading}
                  className={`mt-auto w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                    pkg.popular
                      ? 'bg-brand-600 hover:bg-brand-500 text-white shadow-md shadow-brand-600/30 hover:shadow-brand-600/50'
                      : 'bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] text-slate-300 hover:text-white'
                  }`}
                >
                  {loading === pkg.points ? (
                    <>
                      <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Redirecting…
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                      </svg>
                      Buy for ${pkg.price.toFixed(2)}
                    </>
                  )}
                </button>
              </div>
            </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center gap-2 text-xs text-slate-600">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          Payments processed securely by Authorize.net · Credits never expire
        </div>

      </div>
    </div>
  )
}
