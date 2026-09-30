'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { crearFacturaAction } from '@/modules/supply-v2/actions-finanzas'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { FacturaCreada } from '@/modules/supply-v2/finance/invoices'
import { dineroSupplyV2 } from '@/modules/supply-v2/core/catalogo'

export interface OrdenFacturable {
  id: string
  number: string
  supplierId: string
  proveedor: string
  currency: string
  taxRate: string
  total: string
  lines: { id: string; descripcion: string; quantity: number; unitCost: string; porFacturar: number }[]
}

export interface ProveedorParaFactura {
  id: string
  commercialName: string
  currency: string
}

/**
 * MEMBEGO SUPPLY 2.0 · registrar una FACTURA del proveedor (§7–§9, §35).
 * Prioridad: factura contra una orden de compra (las líneas se precargan con
 * lo que queda por facturar). Los totales los calcula el servidor con Decimal.
 */
function precarga(o: OrdenFacturable | null): Record<string, string> {
  return o ? Object.fromEntries(o.lines.map((l) => [l.id, String(l.porFacturar)])) : {}
}

export function FormFactura({ proveedores, ordenes, supplierId, purchaseOrderId, idempotencyKey }: { proveedores: ProveedorParaFactura[]; ordenes: OrdenFacturable[]; supplierId?: string; purchaseOrderId?: string; idempotencyKey: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion<FacturaCreada>, FormData>(crearFacturaAction, {})
  const [proveedor, setProveedor] = useState(supplierId ?? ordenes.find((o) => o.id === purchaseOrderId)?.supplierId ?? proveedores[0]?.id ?? '')
  const ordenesDelProveedor = useMemo(() => ordenes.filter((o) => o.supplierId === proveedor), [ordenes, proveedor])
  const [ordenId, setOrdenId] = useState(purchaseOrderId ?? '')
  const orden = ordenesDelProveedor.find((o) => o.id === ordenId) ?? null
  const [cantidades, setCantidades] = useState<Record<string, string>>(() => precarga(orden))
  // Al cambiar de orden, las cantidades se precargan con lo que queda por facturar (estado derivado, sin efecto).
  const [ordenPrecargada, setOrdenPrecargada] = useState(ordenId)
  if (ordenPrecargada !== ordenId) {
    setOrdenPrecargada(ordenId)
    setCantidades(precarga(orden))
  }
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (estado.success && estado.id && visto.current !== estado.id) {
      visto.current = estado.id
      toast.success(estado.success)
      router.push(`/superadmin/supply-v2/finanzas/facturas/${estado.id}`)
    }
  }, [estado, router])
  const select = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'
  const hoy = new Date().toISOString().slice(0, 10)
  const moneda = orden?.currency ?? proveedores.find((p) => p.id === proveedor)?.currency ?? 'DOP'
  const subtotal = orden ? orden.lines.reduce((t, l) => t + Number(cantidades[l.id] ?? 0) * Number(l.unitCost), 0) : 0

  return (
    <form action={enviar} className="space-y-4" data-testid="form-factura">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="facturaProveedor">Proveedor</Label>
          <select id="facturaProveedor" name="supplierId" required className={select} value={proveedor} onChange={(e) => { setProveedor(e.target.value); setOrdenId('') }} data-testid="factura-proveedor">
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.commercialName}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="facturaOrden">Orden de compra</Label>
          <select id="facturaOrden" name="purchaseOrderId" className={select} value={ordenId} onChange={(e) => setOrdenId(e.target.value)} data-testid="factura-orden">
            <option value="">Sin orden (solo si el flujo lo justifica)</option>
            {ordenesDelProveedor.map((o) => (
              <option key={o.id} value={o.id}>{o.number} · {dineroSupplyV2(o.total, o.currency)}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="facturaNumero">Número de factura del proveedor</Label>
          <Input id="facturaNumero" name="supplierInvoiceNumber" maxLength={80} placeholder="B0100000123" data-testid="factura-numero" />
          <p className="text-caption text-muted-foreground">Con número, la misma factura no se puede registrar dos veces.</p>
        </div>
        <div>
          <Label htmlFor="facturaTax">Impuestos (%)</Label>
          <Input id="facturaTax" name="taxRate" type="number" min={0} max={100} step="0.01" defaultValue={orden?.taxRate ?? '0'} key={orden?.id ?? 'sin-orden'} />
        </div>
        <div>
          <Label htmlFor="facturaFecha">Fecha del documento</Label>
          <Input id="facturaFecha" name="documentDate" type="date" required defaultValue={hoy} />
        </div>
        <div>
          <Label htmlFor="facturaVence">Vencimiento</Label>
          <Input id="facturaVence" name="dueDate" type="date" />
        </div>
      </div>

      {orden ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm" data-testid="factura-lineas">
            <thead className="text-left text-caption text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Línea de la orden</th>
                <th className="px-3 py-2 text-right">Por facturar</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2 text-right">Costo unitario</th>
              </tr>
            </thead>
            <tbody>
              {orden.lines.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">
                    {l.descripcion}
                    <input type="hidden" name="lineId" value={l.id} />
                    <input type="hidden" name="lineDescription" value={l.descripcion} />
                    <input type="hidden" name="lineUnitCost" value={l.unitCost} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.porFacturar.toLocaleString('es-DO')} / {l.quantity.toLocaleString('es-DO')}</td>
                  <td className="px-3 py-2 text-right">
                    <Input name="lineQuantity" type="number" min={0} max={l.porFacturar} step={1} value={cantidades[l.id] ?? ''} onChange={(e) => setCantidades({ ...cantidades, [l.id]: e.target.value })} className="ml-auto w-28 text-right" aria-label={`Cantidad a facturar de ${l.descripcion}`} data-testid="factura-cantidad" />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{dineroSupplyV2(l.unitCost, orden.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border">
              <tr>
                <td className="px-3 py-2 text-muted-foreground" colSpan={3}>Subtotal estimado (el servidor recalcula)</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums" data-testid="factura-subtotal">{dineroSupplyV2(subtotal, orden.currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <Label htmlFor="facturaDescripcion">Concepto</Label>
            <Input id="facturaDescripcion" name="description" maxLength={200} required data-testid="factura-concepto" />
          </div>
          <div>
            <Label htmlFor="facturaCantidad">Cantidad</Label>
            <Input id="facturaCantidad" name="quantity" type="number" min={1} step={1} defaultValue={1} required />
          </div>
          <div>
            <Label htmlFor="facturaCosto">Costo unitario ({moneda})</Label>
            <Input id="facturaCosto" name="unitCost" type="number" min={0} step="0.01" required data-testid="factura-costo" />
          </div>
        </div>
      )}

      <div>
        <Label htmlFor="facturaNotas">Notas</Label>
        <Textarea id="facturaNotas" name="notes" rows={2} maxLength={2000} />
      </div>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <Button type="submit" disabled={pendiente} loading={pendiente} data-testid="btn-registrar-factura">Registrar factura</Button>
      <p className="text-caption text-muted-foreground">La factura queda pendiente de aprobación por otra persona; al aprobarse nace (o se enlaza) la obligación con el proveedor.</p>
    </form>
  )
}
