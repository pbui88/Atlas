import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getMyUsage } from '../lib/api'

const AuthContext = createContext(null)

async function triggerAdminNotify(token) {
  try {
    await fetch('/.netlify/functions/notify-admin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
  } catch {
    // non-critical — ignore failures
  }
}

export function AuthProvider({ children }) {
  const [user,          setUser]          = useState(null)
  const [profile,       setProfile]       = useState(null)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [loading,       setLoading]       = useState(true)
  const [usage,         setUsage]         = useState(null)

  const fetchProfile = async (userId) => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
      setProfile(data)
      return data
    } finally {
      setProfileLoaded(true)
    }
  }

  const refreshUsage = useCallback(async () => {
    try {
      const data = await getMyUsage()
      setUsage(data)
    } catch (e) {
      console.warn('Failed to load usage quota:', e?.message)
      // Keep last known good state — don't reset to null
    }
  }, [])

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
      } else {
        setProfile(null)
        setProfileLoaded(true)
        setUsage(null)
      }
      if (event === 'INITIAL_SESSION') setLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Load usage once the profile is confirmed active, then poll every 30s
  useEffect(() => {
    if (!user || !profile?.is_active) return
    refreshUsage()
    const interval = setInterval(refreshUsage, 30000)
    return () => clearInterval(interval)
  }, [user?.id, profile?.is_active, refreshUsage])

  // Trigger admin notification on first login
  useEffect(() => {
    if (!user || !profile || profile.admin_notified) return
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) triggerAdminNotify(session.access_token)
    })
  }, [user?.id, profile?.id])

  const redirectTo = import.meta.env.DEV
    ? 'http://localhost:3000'
    : (import.meta.env.VITE_SITE_URL || window.location.origin)

  const signInWithGoogle = () =>
    supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })

  const signInWithEmail = (email, password) =>
    supabase.auth.signInWithPassword({ email, password })

  const signUpWithEmail = (email, password) =>
    supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } })

  const resetPassword = (email) =>
    supabase.auth.resetPasswordForEmail(email, { redirectTo: `${redirectTo}/reset-password` })

  const signOut = () => supabase.auth.signOut()

  const isAdmin   = profile?.role === 'admin'
  const isPending = !!user && !!profile && !profile.is_active

  return (
    <AuthContext.Provider value={{
      user, profile, profileLoaded, loading, isAdmin, isPending, usage,
      signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword,
      signOut, fetchProfile, refreshUsage,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
