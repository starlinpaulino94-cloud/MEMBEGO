'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { crearPagoProveedorAction } from '@/modules/supply-v2/actions-finanzas'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { PagoCreado } from '@/modules/supply-v2/finance/payments'
import { SUPPLIER_PAYMENT_METHOD_LABELS } from '@/modules/supply-v2/core/catalogo'

export interface ProveedorParaPago {
  id: string
  commercialName: string
  currency: string
}

/**
 * MEMBEGO SUPPLY · registrar un PAGO a proveedor (§13, §37). Nace
 * pendiente: otra persona lo confirma. Se declara a qué se aplicará al
 * confirmarse: una factura, una obligación, un depósito (anticipo) o nada.
 */
export function FormPago({
  proveedores,
  supplierId,
  invoiceId,
  invoiceNumber,
  obligationId,
  settlementId,
  settlementNumber,
  destinoInicial,
  montoSugerido,
  idempotencyKey,
  onCreado,
  compacto = false,
}: {
  proveedores: ProveedorParaPago[]
  supplierId?: string
  invoiceId?: string
  invoiceNumber?: string
  obligationId?: string
  /** Slice 5: una liquidación aprobada; el pago se reparte entre sus entregas, la más antigua primero. */
  settlementId?: string
  settlementNumber?: string
  destinoInicial?: 'FACTURA' | 'OBLIGACION' | 'LIQUIDACION' | 'DEPOSITO' | 'NINGUNO'
  montoSugerido?: string
  /** Clave generada en el servidor al pintar la página: el doble clic no registra dos pagos. */
  idempotencyKey: string
  onCreado?: (p: PagoCreado) => void
  compacto?: boolean
}) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion<PagoCreado>, FormData>(crearPagoProveedorAction, {})
  const [destino, setDestino] = useState<'FACTURA' | 'OBLIGACION' | 'LIQUIDACION' | 'DEPOSITO' | 'NINGUNO'>(destinoInicial ?? (invoiceId ? 'FACTURA' : obligationId ? 'OBLIGACION' : settlementId ? 'LIQUIDACION' : 'NINGUNO'))
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (estado.success && estado.id && visto.current !== estado.id) {
      visto.current = estado.id
      toast.success(estado.success)
      if (onCreado && estado.data) onCreado(estado.data)
      else router.refresh()
    }
  }, [estado, onCreado, router])
  const select = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'
  const hoy = new Date().toISOString().slice(0, 10)

  return (
    <form action={enviar} className="space-y-3" data-testid="form-pago">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {invoiceId && <input type="hidden" name="invoiceId" value={invoiceId} />}
      {obligationId && <input type="hidden" name="obligationId" value={obligationId} />}
      {settlementId && <input type="hidden" name="settlementId" value={settlementId} />}
      <div className={`grid gap-3 ${compacto ? '' : 'sm:grid-cols-2'}`}>
        <div>
          <Label htmlFor="pagoProveedor">Proveedor</Label>
          {supplierId ? (
            <>
              <input type="hidden" name="supplierId" value={supplierId} />
              <p className="h-9 rounded-lg border border-border bg-muted/40 px-3 text-sm leading-9">{proveedores.find((p) => p.id === supplierId)?.commercialName ?? 'Proveedor'}</p>
            </>
          ) : (
            <select id="pagoProveedor" name="supplierId" required className={select} defaultValue={proveedores[0]?.id ?? ''} data-testid="pago-proveedor">
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>{p.commercialName}</option>
              ))}
            </select>
          )}
        </div>
        <div>
          <Label htmlFor="pagoMetodo">Forma de pago</Label>
          <select id="pagoMetodo" name="method" className={select} defaultValue="BANK_TRANSFER" data-testid="pago-metodo">
            {(['BANK_TRANSFER', 'CASH', 'OTHER'] as const).map((m) => (
              <option key={m} value={m}>{SUPPLIER_PAYMENT_METHOD_LABELS[m]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="pagoMonto">Monto</Label>
          <Input id="pagoMonto" name="amount" type="number" min="0.01" step="0.01" required defaultValue={montoSugerido} data-testid="pago-monto" />
        </div>
        <div>
          <Label htmlFor="pagoFecha">Fecha del pago</Label>
          <Input id="pagoFecha" name="paidAt" type="date" defaultValue={hoy} required />
        </div>
        <div>
          <Label htmlFor="pagoReferencia">Referencia (número de transferencia)</Label>
          <Input id="pagoReferencia" name="reference" maxLength={120} data-testid="pago-referencia" />
        </div>
        <div>
          <Label htmlFor="pagoDestino">Al confirmarse se aplica a</Label>
          <select id="pagoDestino" name="destino" className={select} value={destino} onChange={(e) => setDestino(e.target.value as typeof destino)} data-testid="pago-destino">
            {invoiceId && <option value="FACTURA">La factura {invoiceNumber ?? ''}</option>}
            {obligationId && <option value="OBLIGACION">Esta obligación</option>}
            {settlementId && <option value="LIQUIDACION">La liquidación {settlementNumber ?? ''}</option>}
            <option value="DEPOSITO">Un depósito nuevo (anticipo al proveedor)</option>
            <option value="NINGUNO">Nada todavía (queda sin aplicar)</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="pagoNotas">Notas</Label>
          <Textarea id="pagoNotas" name="notes" rows={2} maxLength={1000} />
        </div>
      </div>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <Button type="submit" disabled={pendiente} loading={pendiente} data-testid="btn-registrar-pago">Registrar pago</Button>
      <p className="text-caption text-muted-foreground">El pago nace pendiente: se aplica a lo declarado cuando se confirma.</p>
    </form>
  )
}
