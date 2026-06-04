import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { getUserKeyStatus, saveUserKey, deleteUserKey } from '../../lib/api'

function KeyIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
}

export default function SettingsPage() {
  const { openSidebar } = useOutletContext()

  const [hasKey,     setHasKey]     = useState(null)   // null = loading
  const [updatedAt,  setUpdatedAt]  = useState(null)
  const [keyInput,   setKeyInput]   = useState('')
  const [editing,    setEditing]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [removing,   setRemoving]   = useState(false)
  const [error,      setError]      = useState(null)
  const [saved,      setSaved]      = useState(false)

  useEffect(() => {
    getUserKeyStatus()
      .then(({ has_key, updated_at }) => {
        setHasKey(has_key)
        setUpdatedAt(updated_at)
      })
      .catch(() => setHasKey(false))
  }, [])

  const handleSave = async (e) => {
    e.preventDefault()
    setError(null)
    const key = keyInput.trim()
    if (!key) return setError('Please enter your API key.')
    setSaving(true)
    try {
      await saveUserKey(key)
      setHasKey(true)
      setUpdatedAt(new Date().toISOString())
      setEditing(false)
      setKeyInput('')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    if (!window.confirm('Remove your Google Maps API key? Image collection will be disabled until a new key is added.')) return
    setRemoving(true)
    setError(null)
    try {
      await deleteUserKey()
      setHasKey(false)
      setUpdatedAt(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setRemoving(false)
    }
  }

  const handleEdit = () => {
    setKeyInput('')
    setEditing(true)
    setError(null)
  }

  const handleCancel = () => {
    setEditing(false)
    setKeyInput('')
    setError(null)
  }

  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={openSidebar}
          className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.05] transition lg:hidden shrink-0"
          aria-label="Open navigation"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Settings</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage your account configuration</p>
        </div>
      </div>

      {/* Google Maps API Key Card */}
      <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6">

        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-brand-600/15 border border-brand-600/25 flex items-center justify-center shrink-0 text-brand-400">
            <KeyIcon />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Google Maps API Key</h2>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Required for Street View image collection. Costs are billed directly to your Google account ($7.00 per 1,000 images).
            </p>
          </div>
        </div>

        {/* Status badge */}
        {hasKey === null ? (
          <div className="h-8 w-32 bg-white/[0.05] rounded-lg animate-pulse mb-5" />
        ) : hasKey ? (
          <div className="flex items-center gap-2 mb-5">
            <span className="inline-flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold px-2.5 py-1 rounded-full">
              <CheckIcon />
              Key configured
            </span>
            {updatedAt && (
              <span className="text-xs text-slate-600">
                Last updated {new Date(updatedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-5">
            <span className="inline-flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" />
              No key — image collection disabled
            </span>
          </div>
        )}

        {/* Success flash */}
        {saved && (
          <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 mb-4">
            <span className="text-emerald-400"><CheckIcon /></span>
            <span className="text-sm text-emerald-400 font-medium">API key saved successfully.</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Form — show when no key exists, or when editing */}
        {(!hasKey || editing) && (
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="label mb-1.5 block">
                {hasKey ? 'Replace with new key' : 'Paste your API key'}
              </label>
              <input
                type="password"
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
                placeholder="AIza..."
                className="input w-full font-mono text-sm"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-slate-600 mt-1.5">
                Only the Street View Static API needs to be enabled on this key.
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Key'}
              </button>
              {editing && (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="btn-outline text-sm px-4 py-2"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}

        {/* Actions — show when key is saved and not editing */}
        {hasKey && !editing && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleEdit}
              className="btn-outline text-sm px-4 py-2"
            >
              Replace Key
            </button>
            <button
              onClick={handleRemove}
              disabled={removing}
              className="text-sm px-4 py-2 rounded-lg text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition disabled:opacity-50"
            >
              {removing ? 'Removing…' : 'Remove Key'}
            </button>
          </div>
        )}

        {/* Setup guide link */}
        <div className="mt-6 pt-5 border-t border-white/[0.06]">
          <p className="text-xs text-slate-500 mb-2 font-medium">Don't have a key yet?</p>
          <ol className="text-xs text-slate-600 space-y-1 list-decimal list-inside leading-relaxed">
            <li>Go to <span className="text-slate-400 font-mono">console.cloud.google.com</span> and create a project</li>
            <li>Enable billing on the project (free $200/month credit included)</li>
            <li>Go to <span className="text-slate-400">APIs & Services → Library</span> and enable <span className="text-slate-400">Street View Static API</span></li>
            <li>Go to <span className="text-slate-400">APIs & Services → Credentials</span>, click <span className="text-slate-400">+ Create Credentials → API Key</span></li>
            <li>Restrict the key to <span className="text-slate-400">Street View Static API</span> only, then paste it above</li>
          </ol>
        </div>

      </div>
    </div>
  )
}
