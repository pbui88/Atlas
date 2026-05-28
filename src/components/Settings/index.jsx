import { useEffect, useState } from 'react'
import { getKeyStatus, saveGoogleKey, deleteGoogleKey } from '../../lib/api'

function StatusBadge({ configured }) {
  return configured
    ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-600 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">
        <span className="w-1.5 h-1.5 bg-green-500 rounded-full" /> Active
      </span>
    : <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-1">
        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> Not set — using platform key
      </span>
}

export default function SettingsPage() {
  const [status,   setStatus]  = useState(null)
  const [input,    setInput]   = useState('')
  const [saving,   setSaving]  = useState(false)
  const [removing, setRemoving] = useState(false)
  const [msg,      setMsg]     = useState(null)  // { type: 'success'|'error', text }

  useEffect(() => {
    getKeyStatus().then(setStatus).catch(() => {})
  }, [])

  const handleSave = async (e) => {
    e.preventDefault()
    if (!input.trim()) return
    setSaving(true)
    setMsg(null)
    try {
      const res = await saveGoogleKey(input.trim())
      setStatus(res)
      setInput('')
      setMsg({ type: 'success', text: 'API key saved. Your scans will now use your own Google Cloud account.' })
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    if (!confirm('Remove your API key? Scans will fall back to the platform key.')) return
    setRemoving(true)
    setMsg(null)
    try {
      const res = await deleteGoogleKey()
      setStatus(res)
      setMsg({ type: 'success', text: 'API key removed. Using platform key.' })
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Settings</h1>
      <p className="text-sm text-slate-500 mb-8">Manage your account preferences and API integrations.</p>

      {/* Google Maps API Key */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Google Maps API Key</h2>
            <p className="text-xs text-slate-500 mt-1">
              Add your own key so Street View usage is billed directly to your Google Cloud account.
              Leave empty to use the platform's shared key.
            </p>
          </div>
          {status && <StatusBadge configured={status.configured} />}
        </div>

        {/* Current key display */}
        {status?.configured && (
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Current key</p>
              <p className="text-sm font-mono text-slate-700">{status.maskedKey}</p>
              {status.updatedAt && (
                <p className="text-xs text-slate-400 mt-0.5">
                  Updated {new Date(status.updatedAt).toLocaleDateString()}
                </p>
              )}
            </div>
            <button
              onClick={handleRemove}
              disabled={removing}
              className="text-xs text-red-500 hover:text-red-700 transition font-medium disabled:opacity-50"
            >
              {removing ? 'Removing…' : 'Remove'}
            </button>
          </div>
        )}

        {/* Add / Update form */}
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">
              {status?.configured ? 'Replace key' : 'Enter your API key'}
            </label>
            <input
              type="password"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="AIzaSy…"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>

          {msg && (
            <p className={`text-xs ${msg.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
              {msg.text}
            </p>
          )}

          <button
            type="submit"
            disabled={!input.trim() || saving}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : status?.configured ? 'Update key' : 'Save key'}
          </button>
        </form>

        {/* Setup guide */}
        <div className="border-t border-slate-100 pt-4 space-y-2">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">How to get your key</p>
          <ol className="text-xs text-slate-500 space-y-1 list-decimal list-inside">
            <li>Go to <span className="font-mono text-slate-700">console.cloud.google.com</span></li>
            <li>Create a project (or select an existing one)</li>
            <li>Enable <strong className="text-slate-700">Street View Static API</strong></li>
            <li>Go to <strong className="text-slate-700">APIs &amp; Services → Credentials → Create API Key</strong></li>
            <li>Restrict the key to <strong className="text-slate-700">Street View Static API</strong> only</li>
            <li>Paste the key above</li>
          </ol>
          <p className="text-xs text-slate-400 mt-2">
            Google gives $200 free credit/month. At $0.007/image, that covers ~28,500 images free.
          </p>
        </div>
      </div>
    </div>
  )
}
