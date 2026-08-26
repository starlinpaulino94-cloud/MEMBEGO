'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { registrarCliente, type RegistroState } from '@/modules/registro/actions'
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
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { landingUrlFor } from '@/lib/site'
import { isGoogleAuthEnabled } from '@/lib/auth/googleAuth'

const initial: RegistroState = {}

export function RegisterForm({
  companySlug,
  companyName,
  isCarwash,
  colorPrimario = null,
}: {
  companySlug: string
  companyName: string
  isCarwash: boolean
  colorPrimario?: string | null
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const refCode = searchParams.get('ref') ?? ''
  // Growth Engine 3.0: código del enlace de invitación (landing) si vino de uno.
  const glCode = searchParams.get('gl') ?? ''
  const enlaceSlug = searchParams.get('e') ?? ''
  const vendedorCode = searchParams.get('v') ?? ''
  // Destino tras el registro (`?next=`): si el usuario llegó desde una promo,
  // plan o campaña compartida, lo PRIMERO que ve al entrar es la pantalla de
  // reclamar ese beneficio (no el home genérico). Solo rutas internas
  // (empieza con "/", no "//") para evitar open redirect.
  const nextRaw = searchParams.get('next') ?? ''
  const nextSeguro =
    nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : null

  // Si vino por enlace/código de vendedor, aterriza directamente en el catálogo de excursiones del negocio
  const destinoVendedor = (enlaceSlug || vendedorCode) && companySlug
    ? `/empresas/${companySlug}/excursiones${enlaceSlug ? `?e=${encodeURIComponent(enlaceSlug)}` : ''}`
    : null

  // Prioridad: ?next= explícito > referido de vendedor (excursiones) > referido general de cliente > celebración
  const destino =
    nextSeguro ??
    destinoVendedor ??
    (refCode ? `/cliente/bienvenida-ref/${companySlug}` : '/cliente/celebracion')
  const [state, formAction, pending] = useActionState(registrarCliente, initial)
  // Al enviar guardamos las credenciales para iniciar sesión automáticamente
  // en cuanto el registro se complete (sin volver a la pantalla de login).
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

    // Cuenta pendiente de confirmar el correo: no se puede autenticar todavía.
    if (state.pendingVerification) {
      handledRef.current = true
      toast.success(
        'Te enviamos un enlace de confirmación a tu correo. Ábrelo para activar tu cuenta.'
      )
      // Conserva el destino: al confirmar y entrar, aterriza en su beneficio.
      router.replace(`/login?verifica=1&redirect=${encodeURIComponent(destino)}`)
      return
    }

    if (state.success) {
      handledRef.current = true
      // La excepción es deliberada: reacciona al RESULTADO async de useActionState (el registro terminó), no a un render. `handledRef` garantiza que corre una sola vez.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRedirecting(true)
      toast.success('¡Bienvenido! Tu cuenta está lista.')
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
  }, [state.success, state.pendingVerification, router, glCode, destino])

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-2xl">Crear cuenta</CardTitle>
          <CardDescription>
            Regístrate en {companyName}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} onSubmit={captureCreds} className="space-y-4">
            <input type="hidden" name="companySlug" value={companySlug} />
            {refCode && <input type="hidden" name="refCode" value={refCode} />}
            {glCode && <input type="hidden" name="glCode" value={glCode} />}
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

            {!refCode && <ComoNosConociste />}

            {isCarwash && (
              <div className="space-y-4 rounded-lg border border-border p-4">
                <p className="text-small font-medium text-foreground">
                  Tu vehículo (opcional)
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="marca">Marca</Label>
                    <Input id="marca" name="marca" placeholder="Toyota" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="modelo">Modelo</Label>
                    <Input id="modelo" name="modelo" placeholder="Corolla" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="anio">Año</Label>
                    <Input
                      id="anio"
                      name="anio"
                      type="number"
                      placeholder={String(new Date().getFullYear())}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="color">Color</Label>
                    <Input id="color" name="color" placeholder="Blanco" />
                  </div>
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="placa">Placa</Label>
                    <Input id="placa" name="placa" placeholder="A123456" />
                  </div>
                </div>
              </div>
            )}

            {/* F5.2: auto-seguir con opción de desmarcar (el hidden va primero;
                si el checkbox está marcado, su valor "on" queda al final). */}
            <label className="flex items-start gap-2 text-small text-foreground">
              <input type="hidden" name="seguirEmpresa" value="off" />
              <input
                type="checkbox"
                name="seguirEmpresa"
                value="on"
                defaultChecked
                className="mt-0.5 h-4 w-4 rounded border-input"
              />
              <span>
                Seguir a {companyName} para recibir sus promociones y novedades.
              </span>
            </label>

            {/* Aceptación de términos (obligatoria) — se persiste con versión. */}
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

            {/* Consentimiento de marketing (opcional). El hidden "off" va
                primero; si se marca, "on" queda al final. */}
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
              style={colorPrimario ? { backgroundColor: colorPrimario } : undefined}
            >
              {(pending || redirecting) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {redirecting ? 'Entrando…' : 'Crear cuenta'}
            </Button>
          </form>
          {isGoogleAuthEnabled() && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-3 text-caption">
                <span className="h-px flex-1 bg-border" />
                o
                <span className="h-px flex-1 bg-border" />
              </div>
              <GoogleSignInButton companySlug={companySlug} refCode={refCode || null} />
              <p className="text-center text-caption">
                Al continuar con Google aceptas los{' '}
                <a href={landingUrlFor('/terms')} target="_blank" className="text-primary hover:underline">
                  términos
                </a>{' '}
                y la{' '}
                <a href={landingUrlFor('/privacy')} target="_blank" className="text-primary hover:underline">
                  política de privacidad
                </a>
                .
              </p>
            </div>
          )}
          <p className="mt-4 text-center text-small text-muted-foreground">
            ¿Ya tienes cuenta?{' '}
            <a href="/login" className="text-primary hover:underline">
              Inicia sesión
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
