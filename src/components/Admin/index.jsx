import { useEffect, useState } from 'react'
import {
  adminGetUsers, adminUpdateUser, adminDeleteUser, adminGetUsage,
  adminSetUserLimit, adminResetUserCycle, adminSetUserKey,
} from '../../lib/api'

function StatCard({ label, value, sub }) {
  return (
    <div className="stat-card">
      <p className="text-xs text-slate-500 mb-1 uppercase tracking-wide font-semibold">{label}</p>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

function RoleBadge({ role }) {
  return role === 'admin'
    ? <span className="badge-orange">Admin</span>
    : <span className="badge-slate">User</span>
}

function UsageBar({ used, limit }) {
  const safeLimit = limit || 10000
  const pct  = Math.min(100, Math.round((used / safeLimit) * 100))
  const over = pct >= 90
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-medium ${over ? 'text-red-500' : used > 0 ? 'text-slate-700' : 'text-slate-400'}`}>
          {used.toLocaleString()} <span className="font-normal text-slate-400">/ {safeLimit.toLocaleString()}</span>
        </span>
        {used > 0 && <span className="text-xs text-slate-400">{pct}%</span>}
      </div>
      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${over ? 'bg-red-400' : 'bg-brand-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function LimitEditor({ user, onSave }) {
  const [editing, setEditing] = useState(false)
  const [value,   setValue]   = useState(String(user.points_limit ?? 10000))
  const [saving,  setSaving]  = useState(false)

  const save = async () => {
    const num = parseInt(value, 10)
    if (isNaN(num) || num < 0) return
    setSaving(true)
    try {
      await onSave(user.id, num)
      setEditing(false)
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-xs text-slate-400 hover:text-brand-600 transition underline underline-offset-2"
        title="Edit limit"
      >
        {(user.points_limit ?? 10000).toLocaleString()} pts
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        className="w-20 px-1.5 py-0.5 text-xs border border-brand-400 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
        autoFocus
      />
      <button
        onClick={save}
        disabled={saving}
        className="text-xs text-brand-600 hover:text-brand-800 font-medium disabled:opacity-50"
      >
        {saving ? '…' : 'Save'}
      </button>
      <button onClick={() => setEditing(false)} className="text-xs text-slate-400 hover:text-slate-600">✕</button>
    </div>
  )
}

function KeyEditor({ user, onSave }) {
  const [editing, setEditing] = useState(false)
  const [value,   setValue]   = useState('')
  const [saving,  setSaving]  = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await onSave(user.id, value.trim() || null)
      setEditing(false)
      setValue('')
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  const clear = async () => {
    if (!confirm(`Remove Google Maps key for ${user.email}?`)) return
    setSaving(true)
    try {
      await onSave(user.id, null)
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  if (!editing) {
    return user.has_own_key ? (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-600 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full" /> Own key
        </span>
        <button
          onClick={clear}
          disabled={saving}
          className="text-xs text-slate-400 hover:text-red-500 transition disabled:opacity-50"
          title="Remove key"
        >
          ✕
        </button>
      </div>
    ) : (
      <button
        onClick={() => setEditing(true)}
        className="text-xs text-slate-400 hover:text-brand-600 transition underline underline-offset-2"
      >
        + Set key
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="password"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        placeholder="AIzaSy…"
        className="w-32 px-1.5 py-0.5 text-xs font-mono border border-brand-400 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
        autoFocus
      />
      <button
        onClick={save}
        disabled={saving || !value.trim()}
        className="text-xs text-brand-600 hover:text-brand-800 font-medium disabled:opacity-50"
      >
        {saving ? '…' : 'Save'}
      </button>
      <button onClick={() => setEditing(false)} className="text-xs text-slate-400 hover:text-slate-600">✕</button>
    </div>
  )
}

export default function AdminPanel() {
  const [users,   setUsers]   = useState([])
  const [usage,   setUsage]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState('users')

  const load = async () => {
    setLoading(true)
    try {
      const [u, us] = await Promise.all([adminGetUsers(), adminGetUsage()])
      setUsers(u)
      setUsage(us)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleRole = async (user) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin'
    if (!confirm(`Change ${user.email} to ${newRole}?`)) return
    try {
      await adminUpdateUser(user.id, { role: newRole })
      setUsers(u => u.map(x => x.id === user.id ? { ...x, role: newRole } : x))
    } catch (err) { alert(err.message) }
  }

  const toggleActive = async (user) => {
    const newActive = !user.is_active
    if (!confirm(`${newActive ? 'Activate' : 'Deactivate'} ${user.email}?`)) return
    try {
      await adminUpdateUser(user.id, { is_active: newActive })
      setUsers(u => u.map(x => x.id === user.id ? { ...x, is_active: newActive } : x))
    } catch (err) { alert(err.message) }
  }

  const deleteUser = async (user) => {
    if (!confirm(`Permanently delete ${user.email} and all their data?`)) return
    try {
      await adminDeleteUser(user.id)
      setUsers(u => u.filter(x => x.id !== user.id))
    } catch (err) { alert(err.message) }
  }

  const updateLimit = async (userId, points_limit) => {
    await adminSetUserLimit(userId, points_limit)
    setUsers(u => u.map(x => x.id === userId ? { ...x, points_limit } : x))
  }

  const updateKey = async (userId, key) => {
    await adminSetUserKey(userId, key)
    setUsers(u => u.map(x => x.id === userId ? { ...x, has_own_key: !!key } : x))
  }

  const resetCycle = async (user) => {
    if (!confirm(`Reset ${user.email}'s usage cycle to today?`)) return
    try {
      await adminResetUserCycle(user.id)
      setUsers(u => u.map(x => x.id === user.id ? { ...x, points_used_cycle: 0 } : x))
    } catch (err) { alert(err.message) }
  }

  const fmt = (d) => new Date(d).toLocaleDateString()

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Admin</h1>
          <p className="text-sm text-slate-500 mt-1">Manage users and monitor platform usage</p>
        </div>
        <button onClick={load} className="btn-outline text-xs">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Pending activation banner */}
      {users.filter(u => !u.is_active).length > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6">
          <span className="w-2.5 h-2.5 bg-amber-400 rounded-full animate-pulse shrink-0" />
          <p className="text-sm text-amber-800 font-medium">
            {users.filter(u => !u.is_active).length} user{users.filter(u => !u.is_active).length > 1 ? 's' : ''} waiting for activation
          </p>
          <button onClick={() => setTab('users')} className="ml-auto text-xs text-amber-700 underline underline-offset-2 hover:text-amber-900">
            Review
          </button>
        </div>
      )}

      {/* Stats */}
      {usage && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Users"    value={users.length} />
          <StatCard label="Active Users"   value={users.filter(u => u.is_active).length} />
          <StatCard label="Total Projects" value={usage.totalProjects || 0} />
          <StatCard label="API Calls (30d)" value={(usage.totalCalls30d || 0).toLocaleString()} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-100 border border-slate-200 rounded-lg p-1 w-fit">
        {['users', 'usage'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition ${
              tab === t
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tab === 'users' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">User</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Role</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Usage (cycle)</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Limit</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">API Key</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map(user => (
                <tr key={user.id} className={`transition-colors ${!user.is_active ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-slate-50'}`}>
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-semibold text-slate-900">{user.full_name || '—'}</p>
                      <p className="text-xs text-slate-500">{user.email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <RoleBadge role={user.role} />
                  </td>
                  <td className="px-4 py-3">
                    {user.is_active
                      ? <span className="badge-green">Active</span>
                      : <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200">
                          <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                          Pending
                        </span>}
                  </td>
                  <td className="px-4 py-3 min-w-[140px]">
                    <UsageBar
                      used={user.points_used_cycle || 0}
                      limit={user.points_limit ?? 10000}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <LimitEditor user={user} onSave={updateLimit} />
                  </td>
                  <td className="px-4 py-3">
                    <KeyEditor user={user} onSave={updateKey} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmt(user.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => toggleRole(user)} className="text-xs text-slate-500 hover:text-slate-900 transition font-medium">
                        {user.role === 'admin' ? 'Demote' : 'Promote'}
                      </button>
                      <button onClick={() => toggleActive(user)} className="text-xs text-slate-500 hover:text-amber-600 transition font-medium">
                        {user.is_active ? 'Suspend' : 'Activate'}
                      </button>
                      <button onClick={() => resetCycle(user)} className="text-xs text-slate-500 hover:text-brand-600 transition font-medium">
                        Reset cycle
                      </button>
                      <button onClick={() => deleteUser(user)} className="text-xs text-slate-500 hover:text-red-500 transition font-medium">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <p className="text-center text-sm text-slate-400 py-10">No users found.</p>
          )}
        </div>
      ) : (
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Usage Summary (Last 30 Days)</h3>
          {usage?.byService?.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {usage.byService.map(row => (
                <div key={row.service} className="flex items-center justify-between py-3 text-sm">
                  <span className="text-slate-600 capitalize">{row.service.replace(/_/g, ' ')}</span>
                  <div className="text-right">
                    <span className="text-slate-900 font-semibold">{row.total_count.toLocaleString()} calls</span>
                    {row.total_cost != null && (
                      <span className="text-slate-400 ml-3">${(+row.total_cost).toFixed(2)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No usage data yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
