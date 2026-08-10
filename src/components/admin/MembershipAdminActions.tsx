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

interface Props {
  membershipId: string
  estado: MembershipEstado
  clienteId: string
  planPrecio: number
  planLavados: number
  planEsIlimitado: boolean
}

export function MembershipAdminActions({
  membershipId,
  estado,
  planPrecio,
}: Props) {
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
      {error && <span className="text-xs text-destructive">{error}</span>}

      {/* Activar pago — for PENDIENTE */}
      {estado === 'PENDIENTE' && (
        <form action={activarAction}>
          <input type="hidden" name="membershipId" value={membershipId} />
          <input type="hidden" name="monto" value={planPrecio} />
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
          <input type="hidden" name="monto" value={planPrecio} />
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
