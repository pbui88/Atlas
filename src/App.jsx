import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import LandingPage         from './components/Auth/LandingPage'
import LoginPage           from './components/Auth/LoginPage'
import PendingApprovalPage from './components/Auth/PendingApprovalPage'
import AppLayout           from './components/Layout/AppLayout'
import Dashboard           from './components/Dashboard/index'
import ProjectPage         from './components/Project/index'
import BuyCreditsPage      from './components/Credits/BuyCreditsPage'
import SkipTracePage       from './components/SkipTrace/index'

// Lazy-loaded: pulls in recharts, only needed by admins
const AdminPanel = lazy(() => import('./components/Admin/index'))

function Spinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-950">
      <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// Public index: show landing page, but redirect logged-in users to the app
function IndexRoute() {
  const { user, profileLoaded, loading } = useAuth()
  if (loading || (user && !profileLoaded)) return <Spinner />
  if (user) return <Navigate to="/dashboard" replace />
  return <LandingPage />
}

function PrivateRoute({ children, adminOnly = false }) {
  const { user, profileLoaded, loading, isAdmin, isPending } = useAuth()
  if (loading || (user && !profileLoaded)) return <Spinner />
  if (!user) return <Navigate to="/login" replace />
  if (isPending) return <PendingApprovalPage />
  if (adminOnly && !isAdmin) return <Navigate to="/dashboard" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/"      element={<IndexRoute />} />
          <Route path="/login" element={<LoginPage />} />

          {/* App (authenticated) */}
          <Route path="/dashboard" element={<PrivateRoute><AppLayout /></PrivateRoute>}>
            <Route index element={<Dashboard />} />
          </Route>
          <Route path="/projects/:id" element={<PrivateRoute><AppLayout /></PrivateRoute>}>
            <Route index element={<ProjectPage />} />
          </Route>
          <Route path="/admin" element={<PrivateRoute adminOnly><AppLayout /></PrivateRoute>}>
            <Route index element={<Suspense fallback={<Spinner />}><AdminPanel /></Suspense>} />
          </Route>
          <Route path="/credits" element={<PrivateRoute><AppLayout /></PrivateRoute>}>
            <Route index element={<BuyCreditsPage />} />
          </Route>
          <Route path="/skiptrace" element={<PrivateRoute><AppLayout /></PrivateRoute>}>
            <Route index element={<SkipTracePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
