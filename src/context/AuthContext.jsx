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
  const [user,    setUser]    = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = async (userId) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    setProfile(data)
    return data
  }

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setUser(session?.user ?? null)

      if (session?.user) {
        const profile = await fetchProfile(session.user.id)
        // First login: notify admin if not yet notified
        if (profile && !profile.admin_notified) {
          triggerAdminNotify(session.access_token)
        }
      } else {
        setProfile(null)
      }

      if (event === 'INITIAL_SESSION') setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signInWithGoogle = () => {
    const redirectTo = import.meta.env.DEV
      ? 'http://localhost:3000'
      : (import.meta.env.VITE_SITE_URL || window.location.origin)
    return supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
  }

  const signOut = () => supabase.auth.signOut()

  const isAdmin   = profile?.role === 'admin'
  const isPending = !!user && !!profile && !profile.is_active

  return (
    <AuthContext.Provider value={{ user, profile, loading, isAdmin, isPending, signInWithGoogle, signOut, fetchProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
