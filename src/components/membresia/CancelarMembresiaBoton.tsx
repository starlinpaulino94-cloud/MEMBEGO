'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cancelarMiMembresia, type CancelarMembresiaState } from '@/modules/membresia/actions'
import { Button } from '@/components/ui/button'

const initial: CancelarMembresiaState = {}

/**
 * EL CLIENTE CANCELA SU MEMBRESÍA, con efecto a fin de período.
 *
 * La confirmación deja claro lo que el dueño decidió como regla: no pierde
 * nada hoy — sus usos siguen disponibles hasta el vencimiento — y lo que
 * cambia es el futuro: no se renueva. Discreto a propósito (un enlace, no un
 * botón rojo gigante): cancelar debe ser posible sin ser la invitación.
 */
export function CancelarMembresiaBoton({
  membershipId,
  venceTexto,
}: {
  membershipId: string
  /** Fecha de vencimiento ya formateada («11 sept 2026»), para la confirmación. */
  venceTexto: string | null
}) {
  const router = useRouter()
  const [confirmando, setConfirmando] = useState(false)
  const [state, formAction, pending] = useActionState(cancelarMiMembresia, initial)

  useEffect(() => {
    if (state.success) {
      toast.success(
        venceTexto
          ? `Cancelación programada. Tu membresía sigue activa hasta el ${venceTexto}.`
          : 'Cancelación programada. Tu membresía sigue activa hasta su vencimiento.'
      )
      router.refresh()
    }
    if (state.error) toast.error(state.error)
  }, [state, router, venceTexto])

  if (!confirmando) {
    return (
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        className="mx-auto block text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-destructive hover:underline"
      >
        Cancelar membresía
      </button>
    )
  }

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-center"
    >
      <input type="hidden" name="membershipId" value={membershipId} />
      <p className="text-sm font-medium text-foreground">¿Cancelar tu membresía?</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {venceTexto
          ? `No pierdes nada hoy: sigue activa con tus usos hasta el ${venceTexto}. A partir de ahí no se renueva.`
          : 'No pierdes nada hoy: sigue activa con tus usos hasta su vencimiento. A partir de ahí no se renueva.'}
      </p>
      <div className="mt-3 flex items-center justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => setConfirmando(false)}
        >
          Volver
        </Button>
        <Button type="submit" variant="destructive" size="sm" disabled={pending} className="gap-1.5">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Sí, cancelar
        </Button>
      </div>
    </form>
  )
}
