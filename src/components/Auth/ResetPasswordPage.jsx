import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function Field({ label, value, onChange, placeholder, autoComplete }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
      <input
        type="password"
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

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [ready,    setReady]    = useState(false)
  const [invalid,  setInvalid]  = useState(false)
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [done,     setDone]     = useState(false)

  // The recovery link puts a token in the URL that supabase-js exchanges for a
  // session automatically (detectSessionInUrl). That exchange is async, so wait
  // for either a PASSWORD_RECOVERY event or an existing session before showing
  // the form — otherwise updateUser() below would run with no session to act on.
  useEffect(() => {
    let resolved = false
    const markReady = () => { resolved = true; setReady(true) }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) markReady()
    })
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) markReady()
    })
    const timeout = setTimeout(() => {
      if (!resolved) setInvalid(true)
    }, 3000)
    return () => { subscription.unsubscribe(); clearTimeout(timeout) }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) return setError('Passwords do not match.')
    if (password.length < 8) return setError('Password must be at least 8 characters.')

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) return setError(error.message)
    setDone(true)
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiMyMjIiIG9wYWNpdHk9IjAuNCI+PHBhdGggZD0iTTM2IDM0di00aC0ydjRoLTR2MmgwdjJoNHYtMmgydi0yaDR2LTJoLTR6bTAtMzBWMGgtMnY0aC00djJoNHYyaDJ2LTJoNFY0aC00ek02IDM0di00SDR2NGgwdjJoNHYtMmgydi0yaDR2LTJINnpNNiA0VjBoLTJ2NEgwdjJoNHYyaDJWNmg0VjRINnoiLz48L2c+PC9nPjwvc3ZnPg==')] opacity-[0.03] pointer-events-none" />
      <Link to="/login" className="absolute top-6 left-6 z-20 flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
        Back to sign in
      </Link>
      <div className="relative z-10 w-full max-w-sm">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl shadow-black/40">
          {invalid ? (
            <div className="text-center">
              <h2 className="text-xl font-bold text-white mb-2">Link expired</h2>
              <p className="text-sm text-slate-400 mb-6">This password reset link is invalid or has expired. Request a new one from the sign-in page.</p>
              <button onClick={() => navigate('/login')} className="text-sm text-brand-400 hover:text-brand-300 transition underline underline-offset-2">
                Back to sign in
              </button>
            </div>
          ) : done ? (
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-5">
                <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Password updated</h2>
              <p className="text-sm text-slate-400 mb-8">You can now sign in with your new password.</p>
              <button onClick={() => navigate('/dashboard')} className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white font-semibold rounded-lg transition text-sm">
                Continue to Atlas
              </button>
            </div>
          ) : !ready ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Set a new password</h2>
              <p className="text-sm text-slate-400 mb-6">Choose a new password for your account.</p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <Field label="New password" value={password} onChange={setPassword} placeholder="Min. 8 characters" autoComplete="new-password" />
                <Field label="Confirm password" value={confirm} onChange={setConfirm} placeholder="••••••••" autoComplete="new-password" />
                {error && <p className="text-xs text-red-400">{error}</p>}
                <button type="submit" disabled={loading} className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-semibold rounded-lg transition text-sm">
                  {loading ? '…' : 'Update password'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
