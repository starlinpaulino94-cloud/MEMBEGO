'use client'

import { useActionState, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { confirmarPago, renovarMembresia } from '@/modules/admin/actions'
import { cancelarMembresia, desactivarMembresia } from '@/modules/admin/planActions'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ConfirmarPagoButton, RechazarPagoButton } from '@/components/admin/ValidarPagoActions'
import type { MembershipEstado } from '@/types'

/**
 * LO QUE ESTE COMPONENTE NECESITA, Y NADA MÁS.
 *
 * Recibía además `clienteId`, `planLavados` y `planEsIlimitado`, que ni
 * siquiera se desestructuraban: la página los calculaba y los mandaba para
 * nada. `planPrecio` viajaba a un campo oculto que la acción ya no lee — el
 * monto de una renovación lo calcula el servidor a partir del plan, porque un
 * precio pintado al renderizar se queda viejo en cuanto alguien lo cambia.
 *
 * Props que no se usan no son inofensivas: engañan al leer, y sobre todo hacen
 * pensar que el dato importa. `clienteId` sí importaba — pero para ENLAZAR a la
 * ficha del cliente, cosa que ahora hace la propia tabla.
 */
interface Props {
  membershipId: string
  estado: MembershipEstado
}

export function MembershipAdminActions({ membershipId, estado }: Props) {
  const [activarState, activarAction, activarPending] = useActionState(confirmarPago, {})
  const [cancelarState, cancelarAction, cancelarPending] = useActionState(cancelarMembresia, {})
  const [desactivarState, desactivarAction, desactivarPending] = useActionState(desactivarMembresia, {})
  const [renovarState, renovarAction, renovarPending] = useActionState(renovarMembresia, {})
  const router = useRouter()

  const desactivarFormRef = useRef<HTMLFormElement>(null)
  const cancelarFormRef = useRef<HTMLFormElement>(null)
  const [confirmDesactivar, setConfirmDesactivar] = useState(false)
  const [confirmCancelar, setConfirmCancelar] = useState(false)

  useEffect(() => {
    if (activarState.success || cancelarState.success || desactivarState.success || renovarState.success) {
      router.refresh()
    }
  }, [activarState.success, cancelarState.success, desactivarState.success, renovarState.success, router])

  const error = activarState.error ?? cancelarState.error ?? desactivarState.error ?? renovarState.error

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* `role="alert"` porque este error aparece DESPUÉS de pulsar y dentro de
          una celda: sin él, un lector de pantalla no anuncia que la acción
          falló y quien no ve la tabla se queda esperando. */}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}

      {/* Activar pago — for PENDIENTE */}
      {estado === 'PENDIENTE' && (
        <form action={activarAction}>
          <input type="hidden" name="membershipId" value={membershipId} />
          <Button
            size="sm"
            type="submit"
            variant="success"
            disabled={activarPending}
          >
            {activarPending ? '…' : 'Activar'}
          </Button>
        </form>
      )}

      {/* Validar comprobante — for PENDIENTE_PAGO */}
      {estado === 'PENDIENTE_PAGO' && (
        <>
          <ConfirmarPagoButton membershipId={membershipId} />
          <RechazarPagoButton membershipId={membershipId} />
        </>
      )}

      {/* Renovar — for ACTIVA or VENCIDA */}
      {(estado === 'ACTIVA' || estado === 'VENCIDA') && (
        <form action={renovarAction}>
          <input type="hidden" name="membershipId" value={membershipId} />
          <Button
            size="sm"
            variant="outline"
            type="submit"
            disabled={renovarPending}
          >
            {renovarPending ? '…' : 'Renovar'}
          </Button>
        </form>
      )}

      {/* Desactivar — for ACTIVA */}
      {estado === 'ACTIVA' && (
        <>
          <form ref={desactivarFormRef} action={desactivarAction}>
            <input type="hidden" name="membershipId" value={membershipId} />
            <Button
              size="sm"
              variant="outline"
              type="button"
              disabled={desactivarPending}
              className="border-warning/30 text-warning hover:bg-warning/15 hover:text-warning"
              onClick={() => setConfirmDesactivar(true)}
            >
              {desactivarPending ? '…' : 'Desactivar'}
            </Button>
          </form>
          <ConfirmDialog
            open={confirmDesactivar}
            title="¿Desactivar esta membresía?"
            confirmText="Desactivar"
            isLoading={desactivarPending}
            onConfirm={() => {
              setConfirmDesactivar(false)
              desactivarFormRef.current?.requestSubmit()
            }}
            onCancel={() => setConfirmDesactivar(false)}
          />
        </>
      )}

      {/* Cancelar — for anything except CANCELADA */}
      {estado !== 'CANCELADA' && (
        <>
          <form ref={cancelarFormRef} action={cancelarAction}>
            <input type="hidden" name="membershipId" value={membershipId} />
            <Button
              size="sm"
              variant="outline"
              type="button"
              disabled={cancelarPending}
              className="border-destructive/25 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setConfirmCancelar(true)}
            >
              {cancelarPending ? '…' : 'Cancelar'}
            </Button>
          </form>
          <ConfirmDialog
            open={confirmCancelar}
            title="¿Cancelar esta membresía?"
            description="No se puede deshacer."
            confirmText="Sí, cancelar"
            isDangerous
            isLoading={cancelarPending}
            onConfirm={() => {
              setConfirmCancelar(false)
              cancelarFormRef.current?.requestSubmit()
            }}
            onCancel={() => setConfirmCancelar(false)}
          />
        </>
      )}
    </div>
  )
}
