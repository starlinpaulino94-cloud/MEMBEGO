'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { landingUrlFor } from '@/lib/site'
import {
  registrarCuentaGeneral,
  type RegistroState,
} from '@/modules/registro/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { ComoNosConociste } from '@/components/adquisicion/ComoNosConociste'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

const initial: RegistroState = {}

/**
 * Registro general de MembeGo: crea la cuenta sin obligar a elegir empresa,
 * seguirla ni tener membresía. Tras el alta entra directo a la app
 * (auto-login) y aterriza en el explorador de empresas del portal.
 */
export function RegisterGeneralForm() {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(registrarCuentaGeneral, initial)
  const credsRef = useRef<{ email: string; password: string } | null>(null)
  const handledRef = useRef(false)
  const [redirecting, setRedirecting] = useState(false)

  function captureCreds(e: React.FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget)
    credsRef.current = {
      email: String(fd.get('email') ?? '').trim().toLowerCase(),
      password: String(fd.get('password') ?? ''),
    }
  }

  useEffect(() => {
    if (handledRef.current) return

    if (state.pendingVerification) {
      handledRef.current = true
      toast.success(
        'Te enviamos un enlace de confirmación a tu correo. Ábrelo para activar tu cuenta.'
      )
      router.replace('/login?verifica=1')
      return
    }

    if (state.success) {
      handledRef.current = true
      // La excepción es deliberada: reacciona al RESULTADO async de useActionState (el registro terminó), no a un render. `handledRef` garantiza que corre una sola vez.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRedirecting(true)
      toast.success('¡Bienvenido a MembeGo! Tu cuenta está lista.')
      const destino = '/cliente/celebracion'
      const creds = credsRef.current
      if (creds) {
        const supabase = createClient()
        supabase.auth
          .signInWithPassword({ email: creds.email, password: creds.password })
          .finally(() => {
            window.location.href = destino
          })
      } else {
        window.location.href = destino
      }
    }
  }, [state.success, state.pendingVerification, router])

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-2xl">Crear cuenta MembeGo</CardTitle>
        <CardDescription>
          Una sola cuenta para todas las empresas. Sin compromiso: sigues o te
          unes a las que tú quieras, cuando quieras.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} onSubmit={captureCreds} className="space-y-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="nombre">Nombre completo *</Label>
            <Input
              id="nombre"
              name="nombre"
              required
             
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Correo electrónico *</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
             
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Contraseña *</Label>
            <PasswordInput
              id="password"
              name="password"
              required
              minLength={6}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="telefono">Teléfono</Label>
            <Input
              id="telefono"
              name="telefono"
              type="tel"
              required
             
              placeholder="809-555-0000"
            />
            <p className="text-caption">
              Lo usamos para confirmar tus citas y beneficios.
            </p>
          </div>

          <ComoNosConociste />

          <label className="flex items-start gap-2 text-small text-foreground">
            <input
              type="checkbox"
              name="terminos"
              value="on"
              required
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>
              Acepto los{' '}
              <a href={landingUrlFor('/terms')} target="_blank" className="text-primary hover:underline">
                términos y condiciones
              </a>{' '}
              y la{' '}
              <a href={landingUrlFor('/privacy')} target="_blank" className="text-primary hover:underline">
                política de privacidad
              </a>
              .
            </span>
          </label>

          <label className="flex items-start gap-2 text-small text-foreground">
            <input type="hidden" name="marketingConsent" value="off" />
            <input
              type="checkbox"
              name="marketingConsent"
              value="on"
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>
              Quiero recibir novedades y ofertas de MembeGo por correo (opcional).
            </span>
          </label>

          <Button
            type="submit"
            disabled={pending || redirecting}
            className="w-full bg-primary hover:bg-primary/90"
          >
            {(pending || redirecting) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {redirecting ? 'Entrando…' : 'Crear cuenta'}
          </Button>
        </form>
        <p className="mt-4 text-center text-small text-muted-foreground">
          ¿Ya tienes cuenta?{' '}
          <a href="/login" className="text-primary hover:underline">
            Inicia sesión
          </a>
        </p>
        <p className="mt-2 text-center text-small text-muted-foreground">
          ¿Prefieres registrarte directo en una empresa?{' '}
          <Link href="/registro" className="text-primary hover:underline">
            Elige una aquí
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
