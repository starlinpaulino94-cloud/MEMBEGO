'use client'

import Link from 'next/link'
import type { SupplyV2OfferStatus } from '@prisma/client'
import { OFERTA_EDITABLE } from '@/modules/supply-v2/core/estados'
import { BASE_SUPPLY_V2 } from '@/modules/supply-v2/core/catalogo'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  cancelarOfertaAction,
  finalizarOfertaAction,
  pausarOfertaAction,
  publicarOfertaAction,
  reanudarOfertaAction,
} from '@/modules/supply-v2/actions-ofertas'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'

type Accion = (prev: EstadoAccion, fd: FormData) => Promise<EstadoAccion>

function Boton({ accion, offerId, etiqueta, variant = 'default', motivo, testId }: { accion: Accion; offerId: string; etiqueta: string; variant?: React.ComponentProps<typeof Button>['variant']; motivo?: string; testId: string }) {
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
    return <Button type="button" variant={variant} onClick={() => setAbierto(true)} data-testid={testId}>{etiqueta}</Button>
  }
  return (
    <form action={enviar} className={motivo ? 'w-full space-y-2 rounded-lg border border-border p-3' : 'inline'}>
      <input type="hidden" name="offerId" value={offerId} />
      {motivo && (
        <div>
          <Label htmlFor={`motivo-${testId}`}>{motivo}</Label>
          <Textarea id={`motivo-${testId}`} name="reason" rows={2} maxLength={500} autoFocus />
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant={variant} disabled={pendiente} loading={pendiente} data-testid={motivo ? `${testId}-confirmar` : testId}>{etiqueta}</Button>
        {motivo && <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>}
      </div>
    </form>
  )
}

/** Acciones de una oferta según su estado (§43). */
export function AccionesOferta({ offerId, estado, compacto = false }: { offerId: string; estado: string; compacto?: boolean }) {
  const acciones: React.ReactNode[] = []
  if (estado === 'DRAFT') acciones.push(<Boton key="pub" accion={publicarOfertaAction} offerId={offerId} etiqueta="Publicar" testId="btn-publicar" />)
  if (OFERTA_EDITABLE.includes(estado as SupplyV2OfferStatus) && !compacto) {
    acciones.push(
      <Button key="editar" asChild variant="outline" data-testid="btn-editar-oferta">
        <Link href={`${BASE_SUPPLY_V2}/ofertas/${offerId}/editar`}>Editar</Link>
      </Button>
    )
  }
  if (estado === 'ACTIVE' || estado === 'SCHEDULED') acciones.push(<Boton key="pausar" accion={pausarOfertaAction} offerId={offerId} etiqueta="Pausar" variant="outline" testId="btn-pausar" />)
  if (estado === 'PAUSED') acciones.push(<Boton key="reanudar" accion={reanudarOfertaAction} offerId={offerId} etiqueta="Reactivar" testId="btn-reanudar" />)
  if (['ACTIVE', 'SCHEDULED', 'PAUSED', 'SOLD_OUT'].includes(estado) && !compacto) {
    acciones.push(<Boton key="fin" accion={finalizarOfertaAction} offerId={offerId} etiqueta="Finalizar" variant="outline" motivo="Motivo (opcional)" testId="btn-finalizar" />)
    acciones.push(<Boton key="cancelar" accion={cancelarOfertaAction} offerId={offerId} etiqueta="Cancelar oferta" variant="ghost" motivo="Motivo de la cancelación" testId="btn-cancelar-oferta" />)
  }
  if (acciones.length === 0) return null
  return <div className="flex flex-wrap items-start gap-2">{acciones}</div>
}
