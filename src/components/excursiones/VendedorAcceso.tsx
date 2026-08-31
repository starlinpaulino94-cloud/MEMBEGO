'use client'

/**
 * Acceso del vendedor a SU panel. Al crear acceso, se envía un correo con las
 * instrucciones para establecer su contraseña. No se muestran credenciales.
 * Si se pierde, se quita el acceso y se vuelve a dar.
 */

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import {
  darAccesoVendedor,
  quitarAccesoVendedor,
  type VendedorActionState,
} from '@/modules/excursiones/vendedores/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

const init: VendedorActionState = {}

export function VendedorAcceso({
  vendedorId,
  tieneAcceso,
  correoActual,
}: {
  vendedorId: string
  tieneAcceso: boolean
  correoActual: string | null
}) {
  const router = useRouter()
  const [state, darAction, dando] = useActionState(darAccesoVendedor, init)
  const [quitarState, quitarAction, quitando] = useActionState(quitarAccesoVendedor, init)

  useEffect(() => {
    if (state.success) router.refresh()
  }, [state, router])

  useEffect(() => {
    if (quitarState.success) {
      toast.success(quitarState.success)
      router.refresh()
    }
    if (quitarState.error) toast.error(quitarState.error)
  }, [quitarState, router])

  if (state.success) {
    return (
      <section className="rounded-2xl border border-success/25 bg-success/5 p-5">
        <h2 className="text-h3 text-foreground">Acceso creado</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {state.success}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => router.refresh()}
        >
          Cerrar
        </Button>
      </section>
    )
  }

  if (tieneAcceso) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-h3 text-foreground">Acceso a su panel</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Entra con <strong className="text-foreground">{correoActual ?? 'su correo'}</strong> y ve
          solo lo suyo: su QR, sus clientes, sus reservas y lo que se le debe. No alcanza el panel
          de tu empresa.
        </p>
        <form action={quitarAction} className="mt-3">
          <input type="hidden" name="vendedorId" value={vendedorId} />
          <Button type="submit" size="sm" variant="ghost" disabled={quitando}>
            Quitar el acceso
          </Button>
        </form>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="text-h3 text-foreground">Acceso a su panel</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Dale una cuenta para que consulte desde su teléfono su QR, sus clientes captados y lo que
        se le debe. Solo verá lo suyo.
      </p>
      <form action={darAction} className="mt-3 space-y-3">
        <input type="hidden" name="vendedorId" value={vendedorId} />
        <div>
          <Label htmlFor="acc-correo">Correo con el que va a entrar</Label>
          <Input id="acc-correo" name="correo" type="email" required placeholder="vendedor@correo.com" />
        </div>
        {state.error ? (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" disabled={dando} className="gap-2">
          {dando ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Dar acceso
        </Button>
      </form>
    </section>
  )
}
