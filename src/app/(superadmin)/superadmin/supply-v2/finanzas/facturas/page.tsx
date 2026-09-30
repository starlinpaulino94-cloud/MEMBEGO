import Link from 'next/link'
import type { SupplyV2InvoiceStatus } from '@prisma/client'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Label } from '@/components/ui/label'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { formatDate } from '@/lib/format'
import { leerPaginacion } from '@/lib/paginacion'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipFactura } from '@/components/supply-v2/finanzas/chips'
import { listarFacturas, proveedoresParaFinanzas } from '@/modules/supply-v2/finance/queries'
import { dineroSupplyV2, INVOICE_STATUS_LABELS, RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Facturas de proveedor · Supply 2.0' }

const ESTADOS: SupplyV2InvoiceStatus[] = ['PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']

/** MEMBEGO SUPPLY 2.0 · facturas (§35) con paginación real (§47). */
export default async function FacturasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const proveedor = typeof sp.proveedor === 'string' ? sp.proveedor : ''
  const estadoCrudo = typeof sp.estado === 'string' ? sp.estado : ''
  const estado = estadoCrudo === 'PENDIENTES' ? 'PENDIENTES' : (ESTADOS as string[]).includes(estadoCrudo) ? (estadoCrudo as SupplyV2InvoiceStatus) : null
  const paginacion = leerPaginacion(sp)
  const [{ filas, total }, proveedores] = await Promise.all([listarFacturas({ supplierId: proveedor || null, status: estado }, paginacion), proveedoresParaFinanzas()])
  const select = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Facturas de proveedor"
        description="El documento del proveedor. Se registra, otra persona lo aprueba y entonces nace la deuda; se cubre con depósito, transferencia o ambos."
        eyebrow={<Link href={RUTA_FINANZAS} className="hover:underline">Finanzas</Link>}
        nav={<NavSupplyV2 activa="finanzas" />}
        action={<Button asChild><Link href={`${RUTA_FINANZAS}/facturas/nueva`} data-testid="btn-nueva-factura">+ Nueva factura</Link></Button>}
      />
      <Card>
        <CardContent className="pt-6">
          <form method="get" className="grid gap-3 sm:grid-cols-4" data-testid="filtros-facturas">
            <div>
              <Label htmlFor="proveedor">Proveedor</Label>
              <select id="proveedor" name="proveedor" defaultValue={proveedor} className={select}>
                <option value="">Todos</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.commercialName}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="estado">Estado</Label>
              <select id="estado" name="estado" defaultValue={estadoCrudo} className={select}>
                <option value="">Todas</option>
                <option value="PENDIENTES">Pendientes (por aprobar o por pagar)</option>
                {ESTADOS.map((e) => <option key={e} value={e}>{INVOICE_STATUS_LABELS[e]}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit" variant="outline">Filtrar</Button>
              <Button asChild variant="ghost"><Link href={`${RUTA_FINANZAS}/facturas`}>Limpiar</Link></Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {filas.length === 0 ? (
        <EmptyState variant="card" title="Sin facturas" description={proveedor || estado ? 'Ninguna factura cumple el filtro.' : 'Registra la primera factura de un proveedor contra su orden de compra.'} />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="tabla-facturas">
                <thead className="text-left text-caption text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Factura</th>
                    <th className="py-1 pr-3">Proveedor</th>
                    <th className="py-1 pr-3">Fecha</th>
                    <th className="py-1 pr-3">Vencimiento</th>
                    <th className="py-1 pr-3 text-right">Total</th>
                    <th className="py-1 pr-3 text-right">Aplicado</th>
                    <th className="py-1 pr-3 text-right">Pagado</th>
                    <th className="py-1 pr-3 text-right">Pendiente</th>
                    <th className="py-1">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.id} className="border-t border-border" data-testid="factura">
                      <td className="py-2 pr-3 font-medium">
                        <Link href={`${RUTA_FINANZAS}/facturas/${f.id}`} className="underline-offset-4 hover:underline" data-testid="link-factura">{f.number}</Link>
                        {f.supplierInvoiceNumber && <span className="block text-caption text-muted-foreground">{f.supplierInvoiceNumber}</span>}
                        {f.purchaseOrder && <span className="block text-caption text-muted-foreground">{f.purchaseOrder.number}</span>}
                      </td>
                      <td className="py-2 pr-3">{f.proveedor}</td>
                      <td className="py-2 pr-3">{formatDate(f.documentDate)}</td>
                      <td className="py-2 pr-3">{f.dueDate ? formatDate(f.dueDate) : '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(f.total, f.currency)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(f.amountApplied, f.currency)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(f.amountPaid, f.currency)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums" data-testid="factura-pendiente">{dineroSupplyV2(f.amountDue, f.currency)}</td>
                      <td className="py-2"><ChipFactura estado={f.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablaPaginacion paginacion={paginacion} total={total} params={sp} etiqueta="facturas" />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
