'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
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

/**
 * Consume el enlace de recuperación de contraseña de Supabase y permite fijar
 * una nueva contraseña. El enlace del correo redirige aquí; el cliente de
 * navegador de @supabase/ssr detecta el token en la URL y establece una sesión
 * de recuperación, con la que `updateUser({ password })` puede actualizarla.
 */
export default function ActualizarPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  // ¿Hay una sesión de recuperación válida? Empezamos optimistas y solo
  // marcamos error si al montar no hay sesión y no llega el evento de recovery.
  const [hasRecoverySession, setHasRecoverySession] = useState<boolean | null>(null)

  useEffect(() => {
    const supabase = createClient()

    // Si el token ya se intercambió en la carga, habrá sesión.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setHasRecoverySession(true)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setHasRecoverySession(true)
      }
    })

    // Damos un margen: si tras 2.5s no hay sesión, el enlace es inválido/expiró.
    const t = setTimeout(() => {
      setHasRecoverySession((prev) => (prev === null ? false : prev))
    }, 2500)

    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(t)
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (updateError) {
      setError(
        updateError.message ||
          'No se pudo actualizar la contraseña. Solicita un nuevo enlace.'
      )
      return
    }

    setSuccess(true)
    // Cerramos la sesión de recuperación y enviamos al login.
    await supabase.auth.signOut().catch(() => {})
    setTimeout(() => router.replace('/login'), 1500)
  }

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-2xl">Nueva contraseña</CardTitle>
        <CardDescription>
          Elige una contraseña nueva para tu cuenta.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {success ? (
          <Alert>
            <AlertDescription>
              Contraseña actualizada. Te llevamos a iniciar sesión…
            </AlertDescription>
          </Alert>
        ) : hasRecoverySession === false ? (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertDescription>
                El enlace de recuperación no es válido o expiró. Solicita uno
                nuevo.
              </AlertDescription>
            </Alert>
            <p className="text-center text-small text-muted-foreground">
              <a href="/recuperar" className="text-primary hover:underline">
                Solicitar nuevo enlace
              </a>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="password">Nueva contraseña</Label>
              <PasswordInput
                id="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirmar contraseña</Label>
              <PasswordInput
                id="confirm"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary/90"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Actualizar contraseña
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
