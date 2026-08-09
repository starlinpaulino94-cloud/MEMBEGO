'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Rocket } from 'lucide-react'
import { toast } from 'sonner'
import {
  registrarEmpresa,
  type RegistroEmpresaState,
} from '@/modules/registro/empresaActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const init: RegistroEmpresaState = {}

const TIPOS = [
  { value: 'carwash', label: 'Car Wash' },
  { value: 'restaurante', label: 'Restaurante' },
  { value: 'gimnasio', label: 'Gimnasio' },
  { value: 'salon', label: 'Salón de belleza' },
  { value: 'otro', label: 'Otro' },
]

export function RegistroEmpresaForm() {
  const router = useRouter()
  const [state, action, pending] = useActionState(registrarEmpresa, init)

  useEffect(() => {
    if (state.pendingVerification) {
      toast.success(
        'Te enviamos un enlace de confirmación a tu correo. Ábrelo para activar tu empresa.'
      )
      router.push('/login?verifica=1')
      return
    }
    if (state.success) {
      toast.success('¡Empresa registrada! Inicia sesión para configurar tu perfil.')
      router.push('/login?registered=empresa')
    }
  }, [state.success, state.pendingVerification, router])

  return (
    <form action={action} className="space-y-5">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {/* Tu cuenta */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Tu cuenta</h3>
        <div className="space-y-1.5">
          <Label htmlFor="nombrePropietario">Nombre del propietario *</Label>
          <Input
            id="nombrePropietario"
            name="nombrePropietario"
            required
            placeholder="Nombre y apellido"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="email">Correo *</Label>
            <Input id="email" name="email" type="email" required placeholder="tu@correo.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña *</Label>
            <PasswordInput
              id="password"
              name="password"
              required
              minLength={6}
              placeholder="Mínimo 6 caracteres"
            />
          </div>
        </div>
      </div>

      {/* Tu empresa */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Tu empresa</h3>
        <div className="space-y-1.5">
          <Label htmlFor="nombreComercial">Nombre comercial *</Label>
          <Input
            id="nombreComercial"
            name="nombreComercial"
            required
            placeholder="Ej: CarTown Wash"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tipo">Tipo de negocio</Label>
            <Select name="tipo" defaultValue="otro">
              <SelectTrigger id="tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pais">País</Label>
            <Input id="pais" name="pais" placeholder="República Dominicana" />
          </div>
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm text-muted-foreground">
        <input type="checkbox" name="terminos" required className="mt-0.5 h-4 w-4 rounded border-border" />
        <span>
          Acepto los{' '}
          <Link href="/terms" target="_blank" className="text-primary underline">
            términos y condiciones
          </Link>{' '}
          y la{' '}
          <Link href="/privacy" target="_blank" className="text-primary underline">
            política de privacidad
          </Link>
          .
        </span>
      </label>

      {/* Consentimiento de marketing (opcional). El hidden "off" va primero;
          si se marca, "on" queda al final. */}
      <label className="flex items-start gap-2 text-sm text-muted-foreground">
        <input type="hidden" name="marketingConsent" value="off" />
        <input type="checkbox" name="marketingConsent" value="on" className="mt-0.5 h-4 w-4 rounded border-border" />
        <span>Quiero recibir novedades y consejos de MembeGo por correo (opcional).</span>
      </label>

      <Button type="submit" disabled={pending} size="lg" className="w-full bg-primary hover:bg-primary/90">
        {pending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Rocket className="mr-2 h-4 w-4" />
        )}
        Registrar mi empresa
      </Button>

      <p className="text-center text-caption text-muted-foreground">
        Tu empresa no será visible en el marketplace hasta que completes tu
        perfil y la publiques desde tu panel.
      </p>
    </form>
  )
}
