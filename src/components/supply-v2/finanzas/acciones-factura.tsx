'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { aplicarDepositoAction, aplicarPagoAction, aprobarFacturaAction, cancelarFacturaAction } from '@/modules/supply-v2/actions-finanzas'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { AplicacionHecha } from '@/modules/supply-v2/finance/applications'
import { dineroSupplyV2 } from '@/modules/supply-v2/core/catalogo'
import { FormPago, type ProveedorParaPago } from './form-pago'

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

export function AprobarFactura({ invoiceId, soyElCreador, soyElUnicoAutorizado }: { invoiceId: string; soyElCreador: boolean; soyElUnicoAutorizado: boolean }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(aprobarFacturaAction, {})
  useRefrescoAlExito(estado)
  return (
    <form action={enviar} className="space-y-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      {soyElCreador && !soyElUnicoAutorizado && <p className="text-caption text-muted-foreground">Registraste esta factura: le toca aprobarla a otra persona autorizada.</p>}
      {soyElCreador && soyElUnicoAutorizado && <p className="text-caption text-muted-foreground" data-testid="aviso-unico-autorizado">Eres la única persona autorizada; esta aprobación queda registrada a tu nombre.</p>}
      <Button type="submit" disabled={pendiente} loading={pendiente} data-testid="btn-aprobar-factura">Aprobar factura</Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}

export function CancelarFactura({ invoiceId }: { invoiceId: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(cancelarFacturaAction, {})
  const [abierto, setAbierto] = useState(false)
  useRefrescoAlExito(estado)
  if (!abierto) return <Button type="button" variant="ghost" onClick={() => setAbierto(true)} data-testid="btn-cancelar-factura">Cancelar factura</Button>
  return (
    <form action={enviar} className="space-y-2 rounded-lg border border-border p-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Label htmlFor="motivoCancelFactura">Motivo (obligatorio)</Label>
      <Textarea id="motivoCancelFactura" name="motivo" rows={2} maxLength={500} required autoFocus />
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={pendiente} loading={pendiente}>Confirmar cancelación</Button>
        <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>Volver</Button>
      </div>
    </form>
  )
}

export interface DepositoAplicable {
  id: string
  number: string
  availableAmount: string
  currency: string
}

/** Aplicar un depósito del proveedor a la factura (§15): nunca más que lo pendiente ni que lo disponible. */
export function AplicarDeposito({ invoiceId, depositos, pendiente: due, moneda, idempotencyKey }: { invoiceId: string; depositos: DepositoAplicable[]; pendiente: string; moneda: string; idempotencyKey: string }) {
  const [estado, enviar, enviando] = useActionState<EstadoAccion<AplicacionHecha>, FormData>(aplicarDepositoAction, {})
  const [abierto, setAbierto] = useState(false)
  const [depositoId, setDepositoId] = useState(depositos[0]?.id ?? '')
  useRefrescoAlExito(estado)
  const dep = depositos.find((d) => d.id === depositoId)
  const maximo = dep ? Math.min(Number(dep.availableAmount), Number(due)) : Number(due)
  if (depositos.length === 0) return null
  if (!abierto) return <Button type="button" variant="outline" onClick={() => setAbierto(true)} data-testid="btn-aplicar-deposito">Aplicar depósito</Button>
  return (
    <form action={enviar} className="space-y-2 rounded-lg border border-border p-3" data-testid="form-aplicar-deposito">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="depositoAplicar">Depósito</Label>
          <select id="depositoAplicar" name="depositId" className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm" value={depositoId} onChange={(e) => setDepositoId(e.target.value)}>
            {depositos.map((d) => (
              <option key={d.id} value={d.id}>{d.number} · disponible {dineroSupplyV2(d.availableAmount, d.currency)}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="montoDeposito">Monto (máximo {dineroSupplyV2(maximo, moneda)})</Label>
          <Input id="montoDeposito" name="amount" type="number" min="0.01" max={maximo} step="0.01" required defaultValue={maximo.toFixed(2)} data-testid="monto-deposito" />
        </div>
      </div>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={enviando} loading={enviando} data-testid="btn-aplicar-deposito-confirmar">Aplicar</Button>
        <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
    </form>
  )
}

export interface PagoAplicable {
  id: string
  number: string
  sinAplicar: string
  currency: string
  reference: string | null
}

/** Aplicar un pago ya confirmado que quedó sin aplicar (o registrar uno nuevo). */
export function PagarFactura({ invoiceId, invoiceNumber, supplierId, proveedores, pagosConSaldo, pendiente: due, moneda, idempotencyKeys }: { invoiceId: string; invoiceNumber: string; supplierId: string; proveedores: ProveedorParaPago[]; pagosConSaldo: PagoAplicable[]; pendiente: string; moneda: string; idempotencyKeys: { pago: string; aplicacion: string } }) {
  const [modo, setModo] = useState<'cerrado' | 'nuevo' | 'existente'>('cerrado')
  const [estado, enviar, enviando] = useActionState<EstadoAccion<AplicacionHecha>, FormData>(aplicarPagoAction, {})
  const [pagoId, setPagoId] = useState(pagosConSaldo[0]?.id ?? '')
  useRefrescoAlExito(estado)
  const pago = pagosConSaldo.find((p) => p.id === pagoId)
  const maximo = pago ? Math.min(Number(pago.sinAplicar), Number(due)) : Number(due)
  if (modo === 'cerrado') {
    return (
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setModo('nuevo')} data-testid="btn-registrar-pago-factura">Registrar pago</Button>
        {pagosConSaldo.length > 0 && <Button type="button" variant="outline" onClick={() => setModo('existente')} data-testid="btn-aplicar-pago-existente">Aplicar pago confirmado</Button>}
      </div>
    )
  }
  if (modo === 'nuevo') {
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        <FormPago proveedores={proveedores} supplierId={supplierId} invoiceId={invoiceId} invoiceNumber={invoiceNumber} destinoInicial="FACTURA" montoSugerido={Number(due).toFixed(2)} idempotencyKey={idempotencyKeys.pago} compacto />
        <Button type="button" variant="ghost" onClick={() => setModo('cerrado')}>Cerrar</Button>
      </div>
    )
  }
  return (
    <form action={enviar} className="space-y-2 rounded-lg border border-border p-3" data-testid="form-aplicar-pago">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKeys.aplicacion} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="pagoAplicar">Pago confirmado</Label>
          <select id="pagoAplicar" name="paymentId" className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm" value={pagoId} onChange={(e) => setPagoId(e.target.value)}>
            {pagosConSaldo.map((p) => (
              <option key={p.id} value={p.id}>{p.number} · sin aplicar {dineroSupplyV2(p.sinAplicar, p.currency)}{p.reference ? ` · ${p.reference}` : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="montoPago">Monto (máximo {dineroSupplyV2(maximo, moneda)})</Label>
          <Input id="montoPago" name="amount" type="number" min="0.01" max={maximo} step="0.01" required defaultValue={maximo.toFixed(2)} />
        </div>
      </div>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={enviando} loading={enviando}>Aplicar</Button>
        <Button type="button" variant="ghost" onClick={() => setModo('cerrado')}>Cancelar</Button>
      </div>
    </form>
  )
}
