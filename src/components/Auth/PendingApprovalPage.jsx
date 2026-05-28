import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function PendingApprovalPage() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-6">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiMyMjIiIG9wYWNpdHk9IjAuNCI+PHBhdGggZD0iTTM2IDM0di00aC0ydjRoLTR2MmgwdjJoNHYtMmgydi0yaDR2LTJoLTR6bTAtMzBWMGgtMnY0aC00djJoNHYyaDJ2LTJoNFY0aC00ek02IDM0di00SDR2NGgwdjJoNHYtMmgydi0yaDR2LTJINnpNNiA0VjBoLTJ2NEgwdjJoNHYyaDJWNmg0VjRINnoiLz48L2c+PC9nPjwvc3ZnPg==')] opacity-[0.03] pointer-events-none" />

      <div className="relative z-10 max-w-md w-full text-center">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>

        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-md shadow-brand-600/30">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
            </svg>
          </div>
          <span className="font-bold text-white text-sm tracking-tight">Atlas</span>
        </div>

        <h1 className="text-2xl font-bold text-white mb-3">Account Pending Approval</h1>
        <p className="text-slate-400 mb-2 leading-relaxed">
          Thanks for signing up{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}. Your account is waiting for admin activation.
        </p>
        <p className="text-slate-500 text-sm mb-10">
          You'll have full access once an admin reviews and activates your account. This usually happens within 24 hours.
        </p>

        {/* Status pill */}
        <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-full px-4 py-2 text-sm text-amber-400 mb-10">
          <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
          Waiting for activation
        </div>

        <div className="border-t border-slate-800 pt-8">
          <p className="text-xs text-slate-600 mb-4">Signed in as {profile?.email}</p>
          <button
            onClick={handleSignOut}
            className="text-sm text-slate-500 hover:text-slate-300 transition underline underline-offset-2"
          >
            Sign out and use a different account
          </button>
        </div>
      </div>
    </div>
  )
}
