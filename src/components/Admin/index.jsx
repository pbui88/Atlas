import { useEffect, useState } from 'react'
import { adminGetUsers, adminUpdateUser, adminDeleteUser, adminGetUsage } from '../../lib/api'

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
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map(user => (
                <tr key={user.id} className="hover:bg-slate-50 transition-colors">
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
                      : <span className="badge-red">Suspended</span>}
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
