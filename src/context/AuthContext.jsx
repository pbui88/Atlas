import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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

  useEffect(() => {
    // Keep callback synchronous — fire fetchProfile without await so Supabase
    // doesn't swallow the promise and setLoading(false) fires on time.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
      } else {
        setProfile(null)
        setProfileLoaded(true)
      }
      if (event === 'INITIAL_SESSION') setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Trigger admin notification on first login (when admin_notified is false)
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
    <AuthContext.Provider value={{ user, profile, profileLoaded, loading, isAdmin, isPending, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, signOut, fetchProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
