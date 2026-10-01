'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { SupplyV2BenefitStatus } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  aprobarBeneficioAction,
  cancelarAsignacionAction,
  cancelarBeneficioAction,
  pausarBeneficioAction,
  reanudarBeneficioAction,
  reversarAplicacionAction,
} from '@/modules/supply-v2/actions-beneficios'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 6 · acciones del ciclo de vida de un beneficio
 * (§7, §27, §29). Cada botón es un formulario: lo que decide es el servidor.
 * Lo que exige un motivo lo pide aquí y no se envía vacío.
 */

function useAviso(estados: EstadoAccion[]): void {
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    const exito = estados.find((e) => e.success)?.success
    if (exito && visto.current !== exito) {
      visto.current = exito
      toast.success(exito)
      router.refresh()
    }
  }, [estados, router])
}

export function AccionesBeneficio({
  benefitId,
  estado,
  puedeAprobar,
  puedeEditar,
  puedeCancelar,
}: {
  benefitId: string
  estado: SupplyV2BenefitStatus
  puedeAprobar: boolean
  puedeEditar: boolean
  puedeCancelar: boolean
}) {
  const [aprobado, aprobar, aprobando] = useActionState<EstadoAccion, FormData>(aprobarBeneficioAction, {})
  const [pausado, pausar, pausando] = useActionState<EstadoAccion, FormData>(pausarBeneficioAction, {})
  const [reanudado, reanudar, reanudando] = useActionState<EstadoAccion, FormData>(reanudarBeneficioAction, {})
  const [cancelado, cancelar, cancelando] = useActionState<EstadoAccion, FormData>(cancelarBeneficioAction, {})
  const [motivo, setMotivo] = useState('')
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false)
  useAviso([aprobado, pausado, reanudado, cancelado])
  const error = aprobado.error ?? pausado.error ?? reanudado.error ?? cancelado.error
  const cerrado = estado === 'CANCELLED' || estado === 'EXPIRED'

  return (
    <div className="space-y-3" data-testid="acciones-beneficio">
      <div className="flex flex-wrap gap-2">
        {puedeAprobar && estado === 'DRAFT' && (
          <form action={aprobar}>
            <input type="hidden" name="benefitId" value={benefitId} />
            <Button type="submit" disabled={aprobando} loading={aprobando} data-testid="btn-aprobar-beneficio">Aprobar y activar</Button>
          </form>
        )}
        {puedeEditar && estado === 'ACTIVE' && (
          <form action={pausar}>
            <input type="hidden" name="benefitId" value={benefitId} />
            <Button type="submit" variant="outline" disabled={pausando} data-testid="btn-pausar-beneficio">Pausar</Button>
          </form>
        )}
        {puedeEditar && (estado === 'PAUSED' || estado === 'EXHAUSTED') && (
          <form action={reanudar}>
            <input type="hidden" name="benefitId" value={benefitId} />
            <Button type="submit" variant="outline" disabled={reanudando} data-testid="btn-reanudar-beneficio">Reactivar</Button>
          </form>
        )}
        {puedeCancelar && !cerrado && (
          <Button type="button" variant="ghost" onClick={() => setPidiendoMotivo((v) => !v)} data-testid="btn-cancelar-beneficio">Cancelar beneficio</Button>
        )}
      </div>

      {pidiendoMotivo && (
        <form action={cancelar} className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3" data-testid="form-cancelar-beneficio">
          <input type="hidden" name="benefitId" value={benefitId} />
          <Label htmlFor="motivoCancelarBeneficio">¿Por qué se cancela?</Label>
          <Input id="motivoCancelarBeneficio" name="motivo" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Campaña cerrada antes de tiempo" required />
          <p className="text-caption text-muted-foreground">Lo ya aplicado queda aplicado. Si hay checkouts en curso con este beneficio, pausa primero y espera a que se paguen o expiren.</p>
          <Button type="submit" variant="destructive" size="sm" disabled={cancelando || motivo.trim().length === 0} data-testid="btn-confirmar-cancelar-beneficio">Confirmar cancelación</Button>
        </form>
      )}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  )
}

export function CancelarAsignacion({ benefitId, customerBenefitId }: { benefitId: string; customerBenefitId: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(cancelarAsignacionAction, {})
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState('')
  useAviso([estado])
  if (!abierto) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto(true)} data-testid="btn-retirar-asignacion">Retirar</Button>
    )
  }
  return (
    <form action={accion} className="space-y-1" data-testid="form-retirar-asignacion">
      <input type="hidden" name="benefitId" value={benefitId} />
      <input type="hidden" name="customerBenefitId" value={customerBenefitId} />
      <Input name="motivo" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" aria-label="Motivo para retirar el beneficio" required />
      <Button type="submit" variant="destructive" size="sm" disabled={pendiente || motivo.trim().length === 0}>Retirar</Button>
      {estado.error && <p className="text-caption text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}

/** Reversar una aplicación (§27): solo si ningún derecho de la compra se entregó. */
export function ReversarAplicacion({ benefitId, reservationId }: { benefitId: string; reservationId: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(reversarAplicacionAction, {})
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState('')
  useAviso([estado])
  if (!abierto) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto(true)} data-testid="btn-reversar-aplicacion">Reversar</Button>
    )
  }
  return (
    <form action={accion} className="space-y-1" data-testid="form-reversar-aplicacion">
      <input type="hidden" name="benefitId" value={benefitId} />
      <input type="hidden" name="reservationId" value={reservationId} />
      <Input name="motivo" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo de la reversa" aria-label="Motivo de la reversa" required />
      <Button type="submit" variant="destructive" size="sm" disabled={pendiente || motivo.trim().length === 0}>Confirmar reversa</Button>
      {estado.error && <p className="text-caption text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}
