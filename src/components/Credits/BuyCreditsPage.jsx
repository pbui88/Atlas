import { useState, useEffect } from 'react'
import { useSearchParams, useOutletContext, useNavigate } from 'react-router-dom'
import { createCheckoutSession } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'

const PACKAGES = [
  { points: 10000, price: 140, perPoint: '1.4¢' },
  { points: 15000, price: 210, perPoint: '1.4¢', popular: true },
  { points: 20000, price: 280, perPoint: '1.4¢' },
]

export default function BuyCreditsPage() {
  const { openSidebar } = useOutletContext()
  const { usage, refreshUsage } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [loading,      setLoading]      = useState(null)
  const [checkoutError, setCheckoutError] = useState(null)  // Fix 7

  const success  = searchParams.get('success') === 'true'
  const addedPts = parseInt(searchParams.get('points') || '0', 10)

  // Fix 5: refreshUsage in deps. Fix 6: clear query params after banner shown.
  useEffect(() => {
    if (!success) return
    refreshUsage()
    navigate('/credits', { replace: true })
  }, [success, refreshUsage, navigate])

  const handleBuy = async (points) => {
    setLoading(points)
    setCheckoutError(null)
    try {
      const { url } = await createCheckoutSession(points)
      window.location.href = url
    } catch (e) {
      setCheckoutError(e.message)  // Fix 7: inline error instead of alert()
      setLoading(null)
    }
  }

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={openSidebar}
          className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.05] transition lg:hidden shrink-0"
          aria-label="Open navigation"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold font-display text-white">Add Credits</h1>
          <p className="text-sm text-slate-500 mt-1">Purchase scan credit points to run Atlas on more properties</p>
        </div>
      </div>

      {/* Success banner */}
      {success && addedPts > 0 && (
        <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 mb-8">
          <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-emerald-400 font-medium">
            Payment successful — {addedPts.toLocaleString()} credits added to your account.
          </p>
        </div>
      )}

      {/* Checkout error — Fix 7 */}
      {checkoutError && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-8">
          <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p className="text-sm text-red-400 font-medium">{checkoutError}</p>
          <button onClick={() => setCheckoutError(null)} className="ml-auto text-red-500 hover:text-red-300 transition">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Current balance */}
      {usage && (
        <div className="bg-navy-800 border border-white/[0.06] rounded-xl p-5 mb-8">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Current Balance</p>
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-2xl font-bold font-display text-white">{usage.remaining.toLocaleString()}</p>
              <p className="text-xs text-slate-500 mt-0.5">Total remaining</p>
            </div>
            <div>
              <p className="text-2xl font-bold font-display text-slate-400">{usage.used.toLocaleString()}</p>
              <p className="text-xs text-slate-500 mt-0.5">Used this cycle</p>
            </div>
            <div>
              <p className="text-2xl font-bold font-display text-slate-400">{usage.limit.toLocaleString()}</p>
              <p className="text-xs text-slate-500 mt-0.5">Monthly quota</p>
            </div>
            {usage.purchasedCredits > 0 && (
              <div>
                <p className="text-2xl font-bold font-display text-brand-400">
                  {(usage.purchasedRemaining ?? usage.purchasedCredits).toLocaleString()}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">Purchased remaining</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Package cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {PACKAGES.map(pkg => (
          <div
            key={pkg.points}
            className={`relative flex flex-col bg-navy-800 border rounded-2xl p-6 ${
              pkg.popular
                ? 'border-brand-500/60 shadow-lg shadow-brand-600/10'
                : 'border-white/[0.06]'
            }`}
          >
            {pkg.popular && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-600 text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full">
                Most popular
              </span>
            )}

            <p className="text-3xl font-bold font-display text-white mb-1">
              {pkg.points.toLocaleString()}
            </p>
            <p className="text-sm text-slate-400 mb-1">scan credits</p>
            <p className="text-xs text-slate-600 mb-6">{pkg.perPoint} per credit</p>

            <p className="text-2xl font-bold text-brand-400 mb-6">${pkg.price}</p>

            <button
              onClick={() => handleBuy(pkg.points)}
              disabled={!!loading}
              className={`mt-auto w-full py-2.5 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2 ${
                pkg.popular
                  ? 'bg-brand-600 hover:bg-brand-700 text-white shadow-lg shadow-brand-600/30'
                  : 'bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.10] text-slate-200'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
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
                  Buy for ${pkg.price}
                </>
              )}
            </button>
          </div>
        ))}
      </div>

      {/* Footer note */}
      <p className="text-xs text-slate-600 text-center">
        Payments are processed securely by Stripe. Credits are added instantly after payment and never expire.
      </p>
    </div>
  )
}
