'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { iniciarSesion } from '@/modules/auth/loginActions'
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

/**
 * El formulario ya NO comprueba credenciales aquí (auditoría · C-05).
 *
 * Antes llamaba a `supabase.auth.signInWithPassword` desde el navegador, con
 * un contador de intentos en memoria de la pestaña. Ese contador no defendía
 * nada: se reinicia con recargar, y desaparece en una ventana de incógnito.
 * Ahora el intento va a `iniciarSesion` (server action), que aplica el
 * limitador distribuido por IP y por correo antes de tocar Supabase, y
 * devuelve un mensaje ya traducido y uniforme.
 */

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
    setLoading(true)

    const datos = new FormData()
    datos.set('email', email)
    datos.set('password', password)
    datos.set('redirect', searchParams.get('redirect') ?? '')

    try {
      const resultado = await iniciarSesion({}, datos)
      if (resultado.error || !resultado.redirect) {
        setError(resultado.error ?? 'No se pudo iniciar sesión.')
        setLoading(false)
        return
      }
      // La sesión ya está en las cookies (la escribió la acción). Solo queda
      // navegar y refrescar para que el servidor la vea.
      router.replace(resultado.redirect)
      router.refresh()
    } catch {
      setError('No se pudo iniciar sesión. Intenta de nuevo en unos momentos.')
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
  // SSO de entrada desde un sistema satélite (car wash): el motivo es GRUESO a
  // propósito — suficiente para saber a quién le toca arreglarlo, sin decirle a
  // nadie si una cuenta existe. El detalle exacto queda en el log del servidor.
  const SSO_MOTIVOS: Record<string, string> = {
    token: 'El enlace de acceso no es válido o ya venció. Vuelve a intentarlo desde el otro sistema.',
    sistema: 'El sistema que intentó abrir tu sesión no está habilitado.',
    cuenta: 'Tu usuario no está disponible en esta empresa. Inicia sesión normalmente.',
    sesion: 'No pudimos abrir tu sesión automáticamente. Entra con tu correo y contraseña.',
  }
  const errorSso =
    errorParam === 'sso'
      ? (SSO_MOTIVOS[searchParams.get('motivo') ?? ''] ??
         'No pudimos abrirte la sesión desde el otro sistema. Inicia sesión aquí.')
      : null

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-2xl">
          {isStaff ? 'Acceso del equipo' : 'Iniciar sesión'}
        </CardTitle>
        <CardDescription>
          {isStaff
            ? 'Panel para administradores y empleados.'
            : 'Accede a tu cuenta de MembeGo.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {verificaPendiente && (
          <Alert className="mb-4 border-info/40 bg-info/15 text-info">
            <AlertDescription>
              Te enviamos un enlace de confirmación a tu correo. Ábrelo (revisa
              también spam) para activar tu cuenta y luego inicia sesión.
            </AlertDescription>
          </Alert>
        )}
        {verificado && (
          <Alert className="mb-4 border-success/40 bg-success/15 text-success">
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
        {errorSso && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{errorSso}</AlertDescription>
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
            <div className="flex items-center gap-3 text-caption">
              <span className="h-px flex-1 bg-border" />
              o
              <span className="h-px flex-1 bg-border" />
            </div>
            <GoogleSignInButton />
          </div>
        )}
        <p className="mt-4 text-center text-small text-muted-foreground">
          <Link href="/recuperar" className="text-primary hover:underline">
            ¿Olvidaste tu contraseña?
          </Link>
        </p>
        {!isStaff && (
          <p className="mt-2 text-center text-small text-muted-foreground">
            ¿No tienes cuenta?{' '}
            <Link href="/registro/cuenta" className="text-primary hover:underline">
              Regístrate
            </Link>
          </p>
        )}
        {isStaff && (
          <p className="mt-2 text-center text-caption">
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
