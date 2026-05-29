import { useEffect, useState } from 'react'
import {
  adminGetUsers, adminUpdateUser, adminDeleteUser, adminGetUsage,
  adminSetUserLimit, adminResetUserCycle, adminSetUserKey,
} from '../../lib/api'

function Sparkline({ points = '0,20 20,16 40,14 60,8 80,6', color = '#3b82f6' }) {
  return (
    <svg viewBox="0 0 80 24" className="w-14 h-4 opacity-50" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StatCard({ label, value, sparkColor = '#3b82f6', sparkPoints }) {
  return (
    <div className="bg-navy-800 border border-white/[0.06] rounded-xl p-5">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{label}</p>
      <div className="flex items-end justify-between">
        <p className="text-3xl font-bold font-display text-white">{value}</p>
        <Sparkline color={sparkColor} points={sparkPoints} />
      </div>
    </div>
  )
}

function RoleBadge({ role }) {
  return role === 'admin'
    ? <span className="badge-blue">Admin</span>
    : <span className="badge-slate">User</span>
}

function UsageBar({ used, limit }) {
  const safeLimit = limit || 10000
  const pct  = Math.min(100, Math.round((used / safeLimit) * 100))
  const over = pct >= 90
  return (
    <div className="w-full min-w-[120px]">
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-medium ${over ? 'text-red-400' : used > 0 ? 'text-slate-300' : 'text-slate-600'}`}>
          {used.toLocaleString()} <span className="font-normal text-slate-600">/ {safeLimit.toLocaleString()}</span>
        </span>
        {used > 0 && <span className="text-xs text-slate-600 ml-2">{pct}%</span>}
      </div>
      <div className="h-1 w-full bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${over ? 'bg-red-500' : 'bg-brand-500'}`}
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
    try { await onSave(user.id, num); setEditing(false) }
    catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-xs text-slate-500 hover:text-brand-400 transition underline underline-offset-2"
      >
        {(user.points_limit ?? 10000).toLocaleString()} pts
      </button>
    )
  }
  return (
    <div className="flex items-center gap-1">
      <input
        type="number" value={value} onChange={e => setValue(e.target.value)} autoFocus
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        className="w-20 px-1.5 py-0.5 text-xs bg-navy-700 border border-brand-600/50 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <button onClick={save} disabled={saving} className="text-xs text-brand-400 hover:text-brand-300 font-medium disabled:opacity-50">{saving ? '…' : 'Save'}</button>
      <button onClick={() => setEditing(false)} className="text-xs text-slate-600 hover:text-slate-400">✕</button>
    </div>
  )
}

function KeyEditor({ user, onSave }) {
  const [editing, setEditing] = useState(false)
  const [value,   setValue]   = useState('')
  const [saving,  setSaving]  = useState(false)

  const save = async () => {
    setSaving(true)
    try { await onSave(user.id, value.trim() || null); setEditing(false); setValue('') }
    catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  const clear = async () => {
    if (!confirm(`Remove Google Maps key for ${user.email}?`)) return
    setSaving(true)
    try { await onSave(user.id, null) }
    catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  if (!editing) {
    return user.has_own_key ? (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" /> Own key
        </span>
        <button onClick={clear} disabled={saving} className="text-xs text-slate-600 hover:text-red-400 transition disabled:opacity-50" title="Remove key">✕</button>
      </div>
    ) : (
      <button onClick={() => setEditing(true)} className="text-xs text-slate-600 hover:text-brand-400 transition underline underline-offset-2">
        + Set key
      </button>
    )
  }
  return (
    <div className="flex items-center gap-1">
      <input
        type="password" value={value} onChange={e => setValue(e.target.value)} placeholder="AIzaSy…" autoFocus
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        className="w-28 px-1.5 py-0.5 text-xs font-mono bg-navy-700 border border-brand-600/50 rounded text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <button onClick={save} disabled={saving || !value.trim()} className="text-xs text-brand-400 hover:text-brand-300 font-medium disabled:opacity-50">{saving ? '…' : 'Save'}</button>
      <button onClick={() => setEditing(false)} className="text-xs text-slate-600 hover:text-slate-400">✕</button>
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
      setUsers(u); setUsage(us)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const toggleRole   = async (user) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin'
    if (!confirm(`Change ${user.email} to ${newRole}?`)) return
    try { await adminUpdateUser(user.id, { role: newRole }); setUsers(u => u.map(x => x.id === user.id ? { ...x, role: newRole } : x)) }
    catch (err) { alert(err.message) }
  }
  const toggleActive = async (user) => {
    const newActive = !user.is_active
    if (!confirm(`${newActive ? 'Activate' : 'Deactivate'} ${user.email}?`)) return
    try { await adminUpdateUser(user.id, { is_active: newActive }); setUsers(u => u.map(x => x.id === user.id ? { ...x, is_active: newActive } : x)) }
    catch (err) { alert(err.message) }
  }
  const deleteUser   = async (user) => {
    if (!confirm(`Permanently delete ${user.email} and all their data?`)) return
    try { await adminDeleteUser(user.id); setUsers(u => u.filter(x => x.id !== user.id)) }
    catch (err) { alert(err.message) }
  }
  const updateLimit  = async (userId, points_limit) => {
    await adminSetUserLimit(userId, points_limit)
    setUsers(u => u.map(x => x.id === userId ? { ...x, points_limit } : x))
  }
  const updateKey    = async (userId, key) => {
    await adminSetUserKey(userId, key)
    setUsers(u => u.map(x => x.id === userId ? { ...x, has_own_key: !!key } : x))
  }
  const resetCycle   = async (user) => {
    if (!confirm(`Reset ${user.email}'s usage cycle to today?`)) return
    try { await adminResetUserCycle(user.id); setUsers(u => u.map(x => x.id === user.id ? { ...x, points_used_cycle: 0 } : x)) }
    catch (err) { alert(err.message) }
  }

  const fmt = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const pendingUsers = users.filter(u => !u.is_active)

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold font-display text-white">Admin</h1>
          <p className="text-sm text-slate-500 mt-1">Manage users and monitor platform usage</p>
        </div>
        <button onClick={load} className="btn-outline text-xs gap-2">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Pending banner */}
      {pendingUsers.length > 0 && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 mb-6">
          <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse shrink-0" />
          <p className="text-sm text-amber-400 font-medium">
            {pendingUsers.length} user{pendingUsers.length > 1 ? 's' : ''} waiting for activation
          </p>
          <button onClick={() => setTab('users')} className="ml-auto text-xs text-amber-500 hover:text-amber-300 underline underline-offset-2">
            Review
          </button>
        </div>
      )}

      {/* Stats */}
      {usage && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Users"     value={users.length}                           sparkColor="#3b82f6" sparkPoints="0,20 20,18 40,14 60,10 80,8" />
          <StatCard label="Active Users"    value={users.filter(u => u.is_active).length}  sparkColor="#10b981" sparkPoints="0,18 20,16 40,12 60,10 80,8" />
          <StatCard label="Total Records"   value={usage.totalProjects || 0}               sparkColor="#06b6d4" sparkPoints="0,22 20,18 40,14 60,10 80,6" />
          <StatCard label="API Calls (30d)" value={(usage.totalCalls30d || 0).toLocaleString()} sparkColor="#8b5cf6" sparkPoints="0,20 20,14 40,16 60,8 80,10" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-navy-800 border border-white/[0.06] rounded-lg p-1 w-fit">
        {['users', 'usage'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition ${
              tab === t
                ? 'bg-brand-600/20 text-brand-400 border border-brand-600/25'
                : 'text-slate-500 hover:text-slate-300'
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
        <div className="bg-navy-800 border border-white/[0.06] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] bg-navy-900/50">
                {['User', 'Role', 'Status', 'Usage (cycle)', 'Limit', 'API Key', 'Joined', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {users.map(user => {
                const initial = (user.full_name || user.email || 'U')[0].toUpperCase()
                return (
                  <tr key={user.id} className={`transition-colors ${!user.is_active ? 'bg-amber-500/5' : 'hover:bg-white/[0.02]'}`}>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-brand-600/15 border border-brand-600/20 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-brand-400">{initial}</span>
                        </div>
                        <div>
                          <p className="font-semibold text-slate-200 text-xs">{user.full_name || '—'}</p>
                          <p className="text-xs text-slate-600">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5"><RoleBadge role={user.role} /></td>
                    <td className="px-4 py-3.5">
                      {user.is_active
                        ? <span className="badge-green">Active</span>
                        : <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />Pending
                          </span>}
                    </td>
                    <td className="px-4 py-3.5 min-w-[160px]">
                      <UsageBar used={user.points_used_cycle || 0} limit={user.points_limit ?? 10000} />
                    </td>
                    <td className="px-4 py-3.5"><LimitEditor user={user} onSave={updateLimit} /></td>
                    <td className="px-4 py-3.5"><KeyEditor user={user} onSave={updateKey} /></td>
                    <td className="px-4 py-3.5 text-xs text-slate-600 whitespace-nowrap">{fmt(user.created_at)}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => toggleRole(user)}   className="text-xs text-slate-600 hover:text-slate-300 transition font-medium">{user.role === 'admin' ? 'Demote' : 'Promote'}</button>
                        <button onClick={() => toggleActive(user)} className="text-xs text-slate-600 hover:text-amber-400 transition font-medium">{user.is_active ? 'Suspend' : 'Activate'}</button>
                        <button onClick={() => resetCycle(user)}   className="text-xs text-slate-600 hover:text-brand-400 transition font-medium">Reset</button>
                        <button onClick={() => deleteUser(user)}   className="text-xs text-slate-600 hover:text-red-400 transition font-medium">Delete</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {users.length === 0 && (
            <p className="text-center text-sm text-slate-600 py-10">No users found.</p>
          )}
        </div>
      ) : (
        <div className="bg-navy-800 border border-white/[0.06] rounded-xl p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Usage Summary — Last 30 Days</h3>
          {usage?.byService?.length > 0 ? (
            <div className="divide-y divide-white/[0.04]">
              {usage.byService.map(row => (
                <div key={row.service} className="flex items-center justify-between py-3 text-sm">
                  <span className="text-slate-500 capitalize">{row.service.replace(/_/g, ' ')}</span>
                  <div className="text-right">
                    <span className="text-slate-200 font-semibold">{row.total_count.toLocaleString()} calls</span>
                    {row.total_cost != null && (
                      <span className="text-slate-600 ml-3">${(+row.total_cost).toFixed(2)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-600">No usage data yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
