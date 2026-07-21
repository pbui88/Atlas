import { useEffect, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

function GoogleIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function AtlasLogo() {
  return (
    <div className="flex items-center justify-center mb-8">
      <img src="/atlas_logo.jpeg" alt="AI Dream Team" className="h-20 w-auto rounded-xl" />
    </div>
  )
}

// ── Reusable input ────────────────────────────────────────────
function Field({ label, type = 'text', value, onChange, placeholder, autoComplete }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
      />
    </div>
  )
}

// ── Pending approval screen (after sign up) ───────────────────
function PendingApprovalScreen({ email, onBack }) {
  return (
    <div className="text-center">
      <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-5">
        <svg className="w-7 h-7 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-white mb-2">Account pending approval</h2>
      <p className="text-sm text-slate-400 mb-1">Thanks for signing up,</p>
      <p className="text-sm font-semibold text-slate-200 mb-6">{email}</p>
      <p className="text-xs text-slate-500 mb-8 leading-relaxed">
        Your account is waiting for admin activation. You'll have full access once an admin reviews and activates your account — this usually happens within 24 hours.
      </p>
      <a
        href="https://api.leadconnectorhq.com/widget/bookings/atlas-set-up-xgrsu"
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full py-2.5 mb-4 bg-brand-600 hover:bg-brand-500 text-white font-semibold rounded-lg transition text-sm"
      >
        Book your setup call
      </a>
      <button onClick={onBack} className="text-sm text-brand-400 hover:text-brand-300 transition underline underline-offset-2">
        Back to sign in
      </button>
    </div>
  )
}

// ── Forgot password screen ────────────────────────────────────
function ForgotPasswordScreen({ onBack, resetPassword }) {
  const [email,   setEmail]   = useState('')
  const [sent,    setSent]    = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const handle = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await resetPassword(email)
    setLoading(false)
    if (error) return setError(error.message)
    setSent(true)
  }

  if (sent) return (
    <div className="text-center">
      <div className="w-14 h-14 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-5">
        <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-white mb-2">Email sent</h2>
      <p className="text-sm text-slate-400 mb-8">Check your inbox for a password reset link.</p>
      <button onClick={onBack} className="text-sm text-brand-400 hover:text-brand-300 transition underline underline-offset-2">Back to sign in</button>
    </div>
  )

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition mb-6">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>
        Back
      </button>
      <h2 className="text-xl font-bold text-white mb-1">Reset password</h2>
      <p className="text-sm text-slate-400 mb-6">Enter your email and we'll send a reset link.</p>
      <form onSubmit={handle} className="space-y-4">
        <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" autoComplete="email" />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button type="submit" disabled={loading} className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-semibold rounded-lg transition text-sm">
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────
export default function LoginPage() {
  const { user, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [tab,      setTab]      = useState(location.state?.tab === 'signup' ? 'signup' : 'signin')
  const [screen,   setScreen]   = useState('form')     // 'form' | 'verify' | 'forgot'
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    if (user && screen !== 'verify') navigate('/dashboard')
  }, [user, navigate, screen])

  const switchTab = (t) => { setTab(t); setError(''); setPassword(''); setConfirm('') }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (tab === 'signup' && password !== confirm) {
      return setError('Passwords do not match.')
    }
    if (tab === 'signup' && password.length < 8) {
      return setError('Password must be at least 8 characters.')
    }

    setLoading(true)
    if (tab === 'signin') {
      const { error } = await signInWithEmail(email, password)
      setLoading(false)
      if (error) setError(error.message)
    } else {
      const { error } = await signUpWithEmail(email, password)
      setLoading(false)
      if (error) return setError(error.message)
      setScreen('verify')
    }
  }

  if (screen === 'verify') return (
    <PageShell>
      <PendingApprovalScreen email={email} onBack={() => { setScreen('form'); setTab('signin') }} />
    </PageShell>
  )

  if (screen === 'forgot') return (
    <PageShell>
      <ForgotPasswordScreen onBack={() => setScreen('form')} resetPassword={resetPassword} />
    </PageShell>
  )

  return (
    <PageShell>
      <AtlasLogo />

      {/* Tabs */}
      <div className="flex bg-slate-800 border border-slate-700 rounded-lg p-1 mb-6">
        {[['signin', 'Sign In'], ['signup', 'Create Account']].map(([t, label]) => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition ${
              tab === t ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Google button */}
      <button
        onClick={signInWithGoogle}
        className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-100 text-slate-900 font-semibold px-4 py-2.5 rounded-lg transition text-sm mb-5"
      >
        <GoogleIcon className="w-4 h-4" />
        {tab === 'signin' ? 'Sign in with Google' : 'Sign up with Google'}
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 h-px bg-slate-700" />
        <span className="text-xs text-slate-500">or with email</span>
        <div className="flex-1 h-px bg-slate-700" />
      </div>

      {/* Email form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" autoComplete="email" />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder={tab === 'signup' ? 'Min. 8 characters' : '••••••••'}
          autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
        />
        {tab === 'signup' && (
          <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} placeholder="••••••••" autoComplete="new-password" />
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        {tab === 'signin' && (
          <div className="flex justify-end">
            <button type="button" onClick={() => setScreen('forgot')} className="text-xs text-slate-500 hover:text-brand-400 transition">
              Forgot password?
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-semibold rounded-lg transition text-sm"
        >
          {loading ? '…' : tab === 'signin' ? 'Sign In' : 'Create Account'}
        </button>
      </form>

      {tab === 'signup' && (
        <p className="text-xs text-slate-500 text-center mt-4 leading-relaxed">
          New accounts require admin approval before access is granted.
        </p>
      )}
    </PageShell>
  )
}

function PageShell({ children }) {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiMyMjIiIG9wYWNpdHk9IjAuNCI+PHBhdGggZD0iTTM2IDM0di00aC0ydjRoLTR2MmgwdjJoNHYtMmgydi0yaDR2LTJoLTR6bTAtMzBWMGgtMnY0aC00djJoNHYyaDJ2LTJoNFY0aC00ek02IDM0di00SDR2NGgwdjJoNHYtMmgydi0yaDR2LTJINnpNNiA0VjBoLTJ2NEgwdjJoNHYyaDJWNmg0VjRINnoiLz48L2c+PC9nPjwvc3ZnPg==')] opacity-[0.03] pointer-events-none" />
      <Link
        to="/"
        className="absolute top-6 left-6 z-20 flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
        Home
      </Link>
      <div className="relative z-10 w-full max-w-sm">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl shadow-black/40">
          {children}
        </div>
      </div>
    </div>
  )
}
