'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { aprobarLiquidacionAction, cancelarLiquidacionAction, generarLiquidacionAction, resolverIncidenciaFinancieraAction } from '@/modules/supply-v2/actions-finanzas'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { LiquidacionCreada } from '@/modules/supply-v2/finance/settlements'
import { SETTLEMENT_FREQUENCY_LABELS } from '@/modules/supply-v2/core/catalogo'

function useRefrescoAlExito(estado: EstadoAccion<unknown>) {
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (estado.success && visto.current !== estado.success) {
      visto.current = estado.success
      toast.success(estado.success)
      router.refresh()
    }
  }, [estado, router])
}

/** Generar una liquidación (§36–§39): proveedor + periodo. Lo que entra lo decide el servidor. */
export function FormLiquidacion({ proveedores, supplierId, periodStart, periodEnd, idempotencyKey }: { proveedores: { id: string; commercialName: string }[]; supplierId?: string; periodStart: string; periodEnd: string; idempotencyKey: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion<LiquidacionCreada>, FormData>(generarLiquidacionAction, {})
  const [frecuencia, setFrecuencia] = useState<'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'MANUAL'>('MANUAL')
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (estado.success && estado.id && visto.current !== estado.id) {
      visto.current = estado.id
      toast.success(estado.success)
      router.push(`/superadmin/supply-v2/finanzas/liquidaciones/${estado.id}`)
    }
  }, [estado, router])
  const select = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'
  return (
    <form action={enviar} className="space-y-3" data-testid="form-liquidacion">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="liqProveedor">Proveedor</Label>
          <select id="liqProveedor" name="supplierId" required className={select} defaultValue={supplierId ?? proveedores[0]?.id ?? ''} data-testid="liquidacion-proveedor">
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.commercialName}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="liqFrecuencia">Periodo</Label>
          <select id="liqFrecuencia" name="frequency" className={select} value={frecuencia} onChange={(e) => setFrecuencia(e.target.value as typeof frecuencia)} data-testid="liquidacion-frecuencia">
            {(['MANUAL', 'DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const).map((f) => (
              <option key={f} value={f}>{SETTLEMENT_FREQUENCY_LABELS[f]}</option>
            ))}
          </select>
        </div>
        {frecuencia === 'MANUAL' ? (
          <>
            <div>
              <Label htmlFor="liqDesde">Desde</Label>
              <Input id="liqDesde" name="periodStart" type="date" required defaultValue={periodStart} data-testid="liquidacion-desde" />
            </div>
            <div>
              <Label htmlFor="liqHasta">Hasta (exclusivo)</Label>
              <Input id="liqHasta" name="periodEnd" type="date" required defaultValue={periodEnd} data-testid="liquidacion-hasta" />
            </div>
          </>
        ) : (
          <div>
            <Label htmlFor="liqReferencia">Fecha de referencia</Label>
            <Input id="liqReferencia" name="referencia" type="date" defaultValue={periodEnd} />
            <p className="text-caption text-muted-foreground">El periodo se calcula a partir de esta fecha (día, semana, quincena o mes que la contiene).</p>
          </div>
        )}
        <div className="sm:col-span-2">
          <Label htmlFor="liqNotas">Notas</Label>
          <Textarea id="liqNotas" name="notes" rows={2} maxLength={2000} />
        </div>
      </div>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <Button type="submit" disabled={pendiente} loading={pendiente} data-testid="btn-generar-liquidacion">Generar liquidación</Button>
      <p className="text-caption text-muted-foreground">Entran solo las entregas a comisión pendientes de pago que no estén en otra liquidación viva. Las ventas de supply adquirido nunca se liquidan aquí. Otra persona la aprueba.</p>
    </form>
  )
}

export function AprobarLiquidacion({ settlementId, soyElCreador, soyElUnicoAutorizado }: { settlementId: string; soyElCreador: boolean; soyElUnicoAutorizado: boolean }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(aprobarLiquidacionAction, {})
  useRefrescoAlExito(estado)
  return (
    <form action={enviar} className="space-y-2">
      <input type="hidden" name="settlementId" value={settlementId} />
      <Button type="submit" disabled={pendiente} loading={pendiente} data-testid="btn-aprobar-liquidacion">Aprobar liquidación</Button>
      {soyElCreador && !soyElUnicoAutorizado && <p className="text-caption text-muted-foreground">Generaste esta liquidación: le toca aprobarla a otra persona autorizada.</p>}
      {soyElCreador && soyElUnicoAutorizado && <p className="text-caption text-muted-foreground" data-testid="aviso-unico-autorizado">Eres la única persona autorizada; esta aprobación queda registrada a tu nombre.</p>}
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}

export function CancelarLiquidacion({ settlementId }: { settlementId: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(cancelarLiquidacionAction, {})
  const [abierto, setAbierto] = useState(false)
  useRefrescoAlExito(estado)
  if (!abierto) return <Button type="button" variant="ghost" onClick={() => setAbierto(true)} data-testid="btn-cancelar-liquidacion">Cancelar liquidación</Button>
  return (
    <form action={enviar} className="space-y-2 rounded-lg border border-border p-3">
      <input type="hidden" name="settlementId" value={settlementId} />
      <Label htmlFor="motivoCancelLiq">Motivo (obligatorio)</Label>
      <Textarea id="motivoCancelLiq" name="motivo" rows={2} maxLength={500} required autoFocus />
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={pendiente} loading={pendiente}>Confirmar cancelación</Button>
        <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>Volver</Button>
      </div>
    </form>
  )
}

export function ResolverIncidencia({ incidentId }: { incidentId: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(resolverIncidenciaFinancieraAction, {})
  const [abierto, setAbierto] = useState(false)
  useRefrescoAlExito(estado)
  if (!abierto) return <Button type="button" size="sm" variant="outline" onClick={() => setAbierto(true)} data-testid="btn-resolver-incidencia">Resolver</Button>
  return (
    <form action={enviar} className="space-y-2 rounded-lg border border-border p-3">
      <input type="hidden" name="incidentId" value={incidentId} />
      <Label htmlFor={`res-${incidentId}`}>Cómo se resolvió (obligatorio)</Label>
      <Textarea id={`res-${incidentId}`} name="notas" rows={2} maxLength={2000} required autoFocus data-testid="incidencia-notas" />
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pendiente} loading={pendiente} data-testid="btn-resolver-incidencia-confirmar">Marcar resuelta</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
    </form>
  )
}
