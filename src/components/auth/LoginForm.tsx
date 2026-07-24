'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { isGoogleAuthEnabled } from '@/lib/auth/googleAuth'
import { safeInternalPath } from '@/lib/utils'
import { ROLE_HOME, type AppRole } from '@/types'

/**
 * Traduce los errores de Supabase a mensajes en español accionables. Nunca
 * mostrar el texto crudo en inglés al usuario (primera impresión del producto).
 */
function mensajeDeError(message: string, status?: number): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) {
    return 'Correo o contraseña incorrectos. Revísalos e intenta de nuevo.'
  }
  if (m.includes('email not confirmed')) {
    return 'Aún no has confirmado tu correo. Abre el enlace que te enviamos (revisa spam) y vuelve a intentar.'
  }
  if (m.includes('too many requests') || status === 429) {
    return 'Demasiados intentos. Espera unos minutos antes de volver a intentar.'
  }
  if (m.includes('network') || m.includes('fetch')) {
    return 'No pudimos conectar. Verifica tu conexión a internet e intenta de nuevo.'
  }
  if (status === 400 || m.includes('invalid')) {
    return 'No se pudo iniciar sesión. Verifica tus datos e intenta de nuevo.'
  }
  return 'No se pudo iniciar sesión. Intenta de nuevo en unos momentos.'
}

// Simple client-side rate limiting cache
const loginAttempts = new Map<string, { count: number; resetAt: number }>()

function checkLoginRateLimit(email: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(email)

  // Poda de entradas expiradas: el Map vive lo que viva la pestaña y antes
  // solo crecía (un email nuevo por intento quedaba para siempre).
  for (const [key, value] of loginAttempts) {
    if (now > value.resetAt) loginAttempts.delete(key)
  }

  if (!entry || now > entry.resetAt) {
    // New or expired window (15 minutes)
    loginAttempts.set(email, { count: 1, resetAt: now + 15 * 60 * 1000 })
    return true
  }

  // Within existing window
  if (entry.count < 5) { // 5 attempts per 15 minutes
    entry.count++
    return true
  }

  return false
}

export function LoginForm({
  audience = 'cliente',
}: {
  /** 'cliente' = acceso público; 'staff' = acceso de administradores/empleados. */
  audience?: 'cliente' | 'staff'
}) {
  const isStaff = audience === 'staff'
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!checkLoginRateLimit(email)) {
      setError('Demasiados intentos de acceso. Intenta de nuevo en 15 minutos.')
      return
    }

    setLoading(true)

    // try/catch obligatorio: `createClient()` LANZA si faltan las variables
    // NEXT_PUBLIC_SUPABASE_* (p. ej. un preview de Vercel sin envs marcadas
    // para Preview). Sin él, la excepción escapaba del handler y el botón se
    // quedaba "cargando" para siempre sin mostrar ningún error.
    try {
      const supabase = createClient()
      const { data, error: signInError } = await supabase.auth.signInWithPassword(
        { email, password }
      )

      if (signInError) {
        setError(mensajeDeError(signInError.message, signInError.status))
        setLoading(false)
        return
      }

      const role = (data.user?.app_metadata?.role ?? 'CLIENTE') as AppRole
      const redirect = safeInternalPath(searchParams.get('redirect'), ROLE_HOME[role])
      router.replace(redirect)
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      setError(
        message.includes('Missing env var')
          ? `Este entorno no está configurado (${message.replace('Missing env var: ', 'falta ')}). Configura las variables de Supabase para este entorno en Vercel.`
          : 'No se pudo iniciar sesión. Intenta de nuevo en unos momentos.'
      )
      setLoading(false)
    }
  }, [email, password, searchParams, router])

  // Avisos del flujo de verificación de correo (Fase 1 · O-1).
  const verificaPendiente = searchParams.get('verifica') === '1'
  const verificado = searchParams.get('verificado') === '1'
  const errorParam = searchParams.get('error')
  const errorVerify = errorParam === 'verify'
  // Avisos del login social con Google (Fase 5 · O-16).
  const GOOGLE_ERRORS: Record<string, string> = {
    google: 'No se pudo iniciar sesión con Google. Intenta de nuevo.',
    google_email: 'Ya existe una cuenta con ese correo. Inicia sesión con tu contraseña.',
    google_company: 'El enlace de registro no es válido. Vuelve a intentarlo desde la empresa.',
    google_off: 'El acceso con Google no está disponible en este momento.',
    google_rate: 'Demasiados registros desde esta conexión. Intenta de nuevo en unos minutos.',
  }
  const errorGoogle = errorParam ? (GOOGLE_ERRORS[errorParam] ?? null) : null

  return (
    <Card className="border-white/10 bg-white/5 text-white">
      <CardHeader>
        <CardTitle className="text-2xl">
          {isStaff ? 'Acceso del equipo' : 'Iniciar sesión'}
        </CardTitle>
        <CardDescription className="text-white/60">
          {isStaff
            ? 'Panel para administradores y empleados.'
            : 'Accede a tu cuenta de MembeGo.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {verificaPendiente && (
          <Alert className="mb-4 border-info/40 bg-info/15 text-info-foreground">
            <AlertDescription>
              Te enviamos un enlace de confirmación a tu correo. Ábrelo (revisa
              también spam) para activar tu cuenta y luego inicia sesión.
            </AlertDescription>
          </Alert>
        )}
        {verificado && (
          <Alert className="mb-4 border-success/40 bg-success/15 text-success-foreground">
            <AlertDescription>
              Correo confirmado. Ya puedes iniciar sesión.
            </AlertDescription>
          </Alert>
        )}
        {errorVerify && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              El enlace de confirmación no es válido o expiró. Intenta
              registrarte de nuevo o solicita uno nuevo.
            </AlertDescription>
          </Alert>
        )}
        {errorGoogle && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{errorGoogle}</AlertDescription>
          </Alert>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Correo electrónico</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-white/10 text-white"
              placeholder="tu@correo.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <PasswordInput
              id="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-white/10 text-white"
              placeholder="••••••••"
            />
          </div>
          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary/90"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Entrar
          </Button>
        </form>
        {!isStaff && isGoogleAuthEnabled() && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-3 text-xs text-white/50">
              <span className="h-px flex-1 bg-white/10" />
              o
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <GoogleSignInButton />
          </div>
        )}
        <p className="mt-4 text-center text-sm text-white/60">
          <Link href="/recuperar" className="text-primary hover:underline">
            ¿Olvidaste tu contraseña?
          </Link>
        </p>
        {!isStaff && (
          <p className="mt-2 text-center text-sm text-white/60">
            ¿No tienes cuenta?{' '}
            <Link href="/registro/cuenta" className="text-primary hover:underline">
              Regístrate
            </Link>
          </p>
        )}
        {isStaff && (
          <p className="mt-2 text-center text-xs text-white/50">
            ¿Eres cliente?{' '}
            <Link href="/login" className="text-primary hover:underline">
              Entra por aquí
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
