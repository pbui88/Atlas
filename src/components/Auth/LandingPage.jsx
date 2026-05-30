import { useNavigate } from 'react-router-dom'

function HeroVisual() {
  return (
    <div className="relative flex items-center justify-center w-full h-full min-h-[500px]">
      {/* Outer glow */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-[420px] h-[420px] rounded-full bg-brand-600/10 blur-3xl" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-[280px] h-[280px] rounded-full bg-cyan-500/10 blur-2xl" />
      </div>

      {/* Rings */}
      <div className="relative w-72 h-72 flex items-center justify-center">
        <div className="absolute inset-0 rounded-full border border-brand-600/20 animate-[spin_20s_linear_infinite]" />
        <div className="absolute inset-4 rounded-full border border-brand-600/15 animate-[spin_15s_linear_infinite_reverse]" />
        <div className="absolute inset-8 rounded-full border border-cyan-500/20 animate-[spin_10s_linear_infinite]" />

        {/* Orbiting dots */}
        {[0, 60, 120, 180, 240, 300].map((deg, i) => (
          <div
            key={i}
            className="absolute w-1.5 h-1.5 rounded-full bg-brand-400"
            style={{
              top:  `${50 - 46 * Math.cos((deg * Math.PI) / 180)}%`,
              left: `${50 + 46 * Math.sin((deg * Math.PI) / 180)}%`,
              transform: 'translate(-50%, -50%)',
              opacity: 0.5 + (i % 3) * 0.2,
            }}
          />
        ))}

        {/* Center globe */}
        <div className="w-32 h-32 rounded-full bg-gradient-to-br from-navy-700 via-brand-900/50 to-navy-800 border border-brand-600/30 flex items-center justify-center shadow-2xl shadow-brand-600/20">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-brand-600/40 to-cyan-500/20 border border-brand-500/20 flex items-center justify-center">
            <svg className="w-9 h-9 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
          </div>
        </div>
      </div>

      {/* Floating data points */}
      {[
        { top: '20%', left: '15%', label: '273 properties', delay: '0s' },
        { top: '65%', left: '10%', label: '98 score', delay: '0.5s' },
        { top: '25%', right: '10%', label: 'AI ready', delay: '1s' },
        { top: '70%', right: '15%', label: '$0.014/property', delay: '1.5s' },
      ].map((p, i) => (
        <div
          key={i}
          className="absolute bg-navy-800/90 border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-slate-300 font-medium backdrop-blur-sm shadow-lg"
          style={{ top: p.top, left: p.left, right: p.right, animation: `pulse 3s ease-in-out ${p.delay} infinite` }}
        >
          {p.label}
        </div>
      ))}
    </div>
  )
}

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-navy-900 flex flex-col overflow-hidden">
      {/* Background grid */}
      <div className="fixed inset-0 bg-grid-dark pointer-events-none" />
      {/* Radial glow */}
      <div className="fixed top-0 left-1/4 w-[600px] h-[600px] bg-brand-600/5 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-0 right-1/4 w-[400px] h-[400px] bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Nav */}
      <nav className="relative z-10 px-8 py-5 flex items-center justify-between max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center shadow-lg shadow-brand-600/40">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c-.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
            </svg>
          </div>
          <span className="font-bold text-white text-sm tracking-tight">Atlas</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/login', { state: { tab: 'signin' } })}
            className="text-sm text-slate-400 hover:text-white transition font-medium px-4 py-2 rounded-lg hover:bg-white/[0.05]"
          >
            Sign In
          </button>
          <button
            onClick={() => navigate('/login', { state: { tab: 'signup' } })}
            className="text-sm bg-brand-600 hover:bg-brand-700 text-white font-semibold px-5 py-2 rounded-lg transition shadow-lg shadow-brand-600/30"
          >
            Get Started
          </button>
        </div>
      </nav>

      {/* Hero — split layout */}
      <div className="relative z-10 flex-1 flex items-center max-w-7xl mx-auto w-full px-8 py-12 gap-16">

        {/* Left: content */}
        <div className="flex-1 max-w-xl">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-brand-600/10 border border-brand-600/20 rounded-full px-4 py-1.5 text-sm text-brand-400 mb-8">
            <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-pulse" />
            AI-powered neighborhood scanning
          </div>

          {/* Headline */}
          <h1 className="font-display text-5xl font-bold text-white leading-[1.1] tracking-tight mb-6">
            Find Distressed<br />
            <span className="text-brand-400">Properties</span> at Scale
          </h1>

          <p className="text-base text-slate-400 leading-relaxed mb-10 max-w-md">
            Draw a neighborhood on the map. Atlas scans every street
            with Google Street View, then AI scores each property for
            distress signals — automatically.
          </p>

          {/* CTAs */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => navigate('/login', { state: { tab: 'signup' } })}
              className="bg-brand-600 hover:bg-brand-700 text-white font-semibold px-7 py-3.5 rounded-xl transition text-sm shadow-xl shadow-brand-600/30"
            >
              Create a free account
            </button>
            <button
              onClick={() => navigate('/login', { state: { tab: 'signin' } })}
              className="bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.10] text-slate-200 font-semibold px-7 py-3.5 rounded-xl transition text-sm"
            >
              Sign in
            </button>
          </div>

          <p className="flex items-center gap-1.5 text-xs text-slate-600">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            New accounts are reviewed by an admin before access is granted.
          </p>
        </div>

        {/* Right: visual */}
        <div className="flex-1 hidden lg:flex items-center justify-center">
          <HeroVisual />
        </div>
      </div>

      {/* Feature cards */}
      <div className="relative z-10 max-w-7xl mx-auto w-full px-8 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: (
                <svg className="w-5 h-5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c-.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
                </svg>
              ),
              title: 'Draw Any Area',
              desc: 'Select a neighborhood polygon. Atlas generates hundreds of scan points along roads.',
            },
            {
              icon: (
                <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
              ),
              title: 'Street View Capture',
              desc: 'Downloads imagery at every point via Google Street View — automatically.',
            },
            {
              icon: (
                <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
              ),
              title: 'AI Distress Scoring',
              desc: 'Gemini Vision analyzes each property and scores distress signals automatically.',
            },
          ].map((f, i) => (
            <div key={i} className="bg-navy-800/70 border border-white/[0.06] rounded-2xl p-5 backdrop-blur-sm hover:border-white/[0.10] transition-colors">
              <div className="w-9 h-9 bg-white/[0.05] border border-white/[0.06] rounded-xl flex items-center justify-center mb-4">
                {f.icon}
              </div>
              <h3 className="text-sm font-semibold text-white mb-1.5">{f.title}</h3>
              <p className="text-xs text-slate-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
