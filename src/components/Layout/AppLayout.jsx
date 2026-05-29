import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-navy-900">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-navy-900">
        <Outlet />
      </main>
    </div>
  )
}
