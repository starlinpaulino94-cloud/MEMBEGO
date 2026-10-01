'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  aprobarOrdenAction,
  cancelarOrdenAction,
  enviarAprobacionAction,
  rechazarOrdenAction,
  type EstadoAccion,
} from '@/modules/supply-v2/actions'

type Accion = (prev: EstadoAccion, fd: FormData) => Promise<EstadoAccion>

function BotonAccion({
  accion,
  ordenId,
  etiqueta,
  variant = 'default',
  motivo,
  testId,
}: {
  accion: Accion
  ordenId: string
  etiqueta: string
  variant?: React.ComponentProps<typeof Button>['variant']
  /** Pide un motivo obligatorio antes de enviar. */
  motivo?: string
  testId: string
}) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(accion, {})
  const [abierto, setAbierto] = useState(false)
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (estado.success && visto.current !== estado.success) {
      visto.current = estado.success
      toast.success(estado.success)
      setAbierto(false)
      router.refresh()
    }
    if (estado.error) toast.error(estado.error)
  }, [estado, router])

  if (motivo && !abierto) {
    return (
      <Button type="button" variant={variant} onClick={() => setAbierto(true)} data-testid={testId}>
        {etiqueta}
      </Button>
    )
  }
  return (
    <form action={enviar} className={motivo ? 'w-full space-y-2 rounded-lg border border-border p-3' : 'inline'}>
      <input type="hidden" name="purchaseOrderId" value={ordenId} />
      {motivo && (
        <div>
          <Label htmlFor={`motivo-${testId}`}>{motivo}</Label>
          <Textarea id={`motivo-${testId}`} name="reason" required rows={2} maxLength={1000} autoFocus />
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant={variant} disabled={pendiente} loading={pendiente} data-testid={motivo ? `${testId}-confirmar` : testId}>
          {etiqueta}
        </Button>
        {motivo && (
          <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>
            Cancelar
          </Button>
        )}
      </div>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}

/**
 * MEMBEGO SUPPLY 2.0 · acciones de una orden (§35). Aprobar se esconde a quien
 * la creó MIENTRAS HAYA otra persona autorizada: el servidor lo rechaza igual,
 * y enseñar un botón que siempre va a decir «no» es una trampa. Cuando no hay
 * segunda persona el servidor sí deja aprobar, así que esconderlo sería la
 * trampa contraria: dejar el trabajo atascado sin salida visible.
 */
export function AccionesOrden({
  ordenId,
  estado,
  soyElCreador,
  soyElUnicoAutorizado,
  puedoAprobar,
  puedoCrear,
}: {
  ordenId: string
  estado: string
  soyElCreador: boolean
  soyElUnicoAutorizado: boolean
  puedoAprobar: boolean
  puedoCrear: boolean
}) {
  const acciones: React.ReactNode[] = []
  if (estado === 'DRAFT' && puedoCrear) {
    acciones.push(<BotonAccion key="enviar" accion={enviarAprobacionAction} ordenId={ordenId} etiqueta="Enviar para aprobación" testId="btn-enviar-aprobacion" />)
  }
  if (estado === 'PENDING_APPROVAL' && puedoAprobar && (!soyElCreador || soyElUnicoAutorizado)) {
    acciones.push(<BotonAccion key="aprobar" accion={aprobarOrdenAction} ordenId={ordenId} etiqueta="Aprobar" testId="btn-aprobar" />)
    acciones.push(<BotonAccion key="rechazar" accion={rechazarOrdenAction} ordenId={ordenId} etiqueta="Rechazar" variant="outline" motivo="Motivo del rechazo" testId="btn-rechazar" />)
  }
  if (['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(estado) && puedoCrear) {
    acciones.push(<BotonAccion key="cancelar" accion={cancelarOrdenAction} ordenId={ordenId} etiqueta="Cancelar orden" variant="ghost" motivo="Motivo de la cancelación" testId="btn-cancelar" />)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-2">{acciones}</div>
      {estado === 'PENDING_APPROVAL' && soyElCreador && !soyElUnicoAutorizado && (
        <p className="text-caption text-muted-foreground" data-testid="aviso-autoaprobacion">
          Creaste esta orden, así que no puedes aprobarla. Otra persona autorizada tiene que hacerlo.
        </p>
      )}
      {estado === 'PENDING_APPROVAL' && soyElCreador && soyElUnicoAutorizado && (
        <p className="text-caption text-muted-foreground" data-testid="aviso-unico-autorizado">
          Eres la única persona autorizada; esta aprobación queda registrada a tu nombre.
        </p>
      )}
    </div>
  )
}
