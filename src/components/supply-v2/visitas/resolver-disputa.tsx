'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import { marcarDisputaEnRevisionAction, resolverDisputaAction, verificarPagoDeVentaAction } from '@/modules/visitas-membego/actions'
import { DISPUTE_STATUS_LABELS } from '@/modules/visitas-membego/domain'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · el superadmin resuelve una disputa (§35).
 * A favor del cliente: se indica cuánto reconoce y la comisión se corrige
 * con un reverso o un ajuste (asientos nuevos, nunca ediciones). A favor del
 * negocio o desestimada: la venta vuelve a su vida normal. Siempre con notas.
 */
export function ResolverDisputa({ disputeId, visitId, estado, reportedTotal, claimedTotal }: { disputeId: string; visitId: string; estado: 'OPEN' | 'UNDER_REVIEW'; reportedTotal: string; claimedTotal: string | null }) {
  const [revision, tomar, tomando] = useActionState<EstadoAccion, FormData>(marcarDisputaEnRevisionAction, {})
  const [resolucion, resolver, resolviendo] = useActionState<EstadoAccion<{ resultado: string; delta: string }>, FormData>(resolverDisputaAction, {})
  const [eleccion, setEleccion] = useState<'RESOLVED_CUSTOMER' | 'RESOLVED_MERCHANT' | 'DISMISSED'>('RESOLVED_CUSTOMER')
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    const s = revision.success ?? resolucion.success
    if (s && visto.current !== s) {
      visto.current = s
      toast.success(s)
      router.refresh()
    }
  }, [revision.success, resolucion.success, router])

  if (resolucion.success) return <p className="text-sm text-success" data-testid="disputa-resuelta">{resolucion.success}</p>

  return (
    <div className="space-y-3 rounded-lg border border-border p-3" data-testid="resolver-disputa">
      {estado === 'OPEN' && (
        <form action={tomar} className="flex items-center gap-2">
          <input type="hidden" name="disputeId" value={disputeId} />
          <input type="hidden" name="visitId" value={visitId} />
          <Button type="submit" size="sm" variant="outline" disabled={tomando} loading={tomando} data-testid="btn-disputa-revision">Marcar en revisión</Button>
          {revision.error && <p className="text-sm text-destructive" role="alert">{revision.error}</p>}
        </form>
      )}
      <form action={resolver} className="space-y-2">
        <input type="hidden" name="disputeId" value={disputeId} />
        <input type="hidden" name="visitId" value={visitId} />
        <div>
          <Label htmlFor={`res-${disputeId}`}>Resolución</Label>
          <select id={`res-${disputeId}`} name="resolucion" value={eleccion} onChange={(e) => setEleccion(e.target.value as typeof eleccion)} className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm" data-testid="select-resolucion">
            <option value="RESOLVED_CUSTOMER">{DISPUTE_STATUS_LABELS.RESOLVED_CUSTOMER}</option>
            <option value="RESOLVED_MERCHANT">{DISPUTE_STATUS_LABELS.RESOLVED_MERCHANT}</option>
            <option value="DISMISSED">{DISPUTE_STATUS_LABELS.DISMISSED}</option>
          </select>
        </div>
        {eleccion === 'RESOLVED_CUSTOMER' && (
          <div>
            <Label htmlFor={`base-${disputeId}`}>Monto que se reconoce como comprado (RD$)</Label>
            <Input id={`base-${disputeId}`} name="baseReconocida" inputMode="decimal" defaultValue={claimedTotal ?? '0'} data-testid="base-reconocida" />
            <p className="text-caption text-muted-foreground">Reportado: RD${reportedTotal}. Con 0 se reversa toda la comisión; con un monto menor al reportado se ajusta la diferencia.</p>
          </div>
        )}
        <div>
          <Label htmlFor={`notas-${disputeId}`}>Notas de la resolución (obligatorias)</Label>
          <Textarea id={`notas-${disputeId}`} name="notas" rows={2} maxLength={2000} required minLength={3} data-testid="notas-resolucion" />
        </div>
        {resolucion.error && <p className="text-sm text-destructive" role="alert" data-testid="resolver-error">{resolucion.error}</p>}
        <Button type="submit" size="sm" disabled={resolviendo} loading={resolviendo} data-testid="btn-resolver-disputa">Resolver</Button>
      </form>
    </div>
  )
}

/** Evidencia externa de una venta (§32): referencia obligatoria; nunca la escribe el negocio. */
export function VerificarPagoVenta({ saleId, visitId }: { saleId: string; visitId: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(verificarPagoDeVentaAction, {})
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
  }, [estado, router])
  if (!abierto) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(true)} data-testid="btn-verificar-pago">Registrar evidencia externa</Button>
    )
  }
  return (
    <form action={enviar} className="space-y-2 rounded-lg border border-border p-3" data-testid="form-verificar-pago">
      <input type="hidden" name="saleId" value={saleId} />
      <input type="hidden" name="visitId" value={visitId} />
      <div>
        <Label htmlFor={`nivel-${saleId}`}>Nivel</Label>
        <select id={`nivel-${saleId}`} name="nivel" className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm" defaultValue="PAYMENT_VERIFIED">
          <option value="PAYMENT_VERIFIED">Pago verificado</option>
          <option value="FISCALLY_RECONCILED">Conciliado fiscalmente</option>
        </select>
      </div>
      <div>
        <Label htmlFor={`ref-${saleId}`}>Referencia (comprobante, conciliación)</Label>
        <Input id={`ref-${saleId}`} name="referencia" required maxLength={120} data-testid="referencia-pago" />
      </div>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pendiente} loading={pendiente} data-testid="btn-verificar-pago-guardar">Guardar</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
    </form>
  )
}
