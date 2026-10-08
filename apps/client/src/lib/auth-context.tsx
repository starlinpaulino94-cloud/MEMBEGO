import React, { createContext, useContext, useEffect, useState, useMemo } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'

interface AuthContextType {
  session: Session | null
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  isCliente: boolean
  signIn: (email: string, pass: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    // Cargar sesión inicial
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (isMounted) {
        setSession(session)
        setIsLoading(false)
      }
    }).catch(() => {
      if (isMounted) {
        setIsLoading(false)
      }
    })

    // Escuchar cambios de estado en autenticación
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (isMounted) {
        setSession(newSession)
        setIsLoading(false)
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const user = session?.user ?? null
  const isAuthenticated = !!user
  const role = (user?.app_metadata?.role as string) ?? 'CLIENTE'
  const isCliente = role === 'CLIENTE'

  const value = useMemo<AuthContextType>(() => ({
    session,
    user,
    isLoading,
    isAuthenticated,
    isCliente,
    signIn: async (email: string, pass: string) => {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: pass,
      })
      return { error: error as Error | null }
    },
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }), [session, user, isLoading, isAuthenticated, isCliente])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth debe ser utilizado dentro de un AuthProvider')
  }
  return context
}
