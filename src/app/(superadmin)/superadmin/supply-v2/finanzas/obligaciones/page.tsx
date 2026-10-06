import Link from 'next/link'
import type { SupplyV2ObligationStatus } from '@prisma/client'
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
import { ChipObligacion } from '@/components/supply-v2/finanzas/chips'
import { listarObligaciones, proveedoresParaFinanzas } from '@/modules/supply-v2/finance/queries'
import { dineroSupplyV2, OBLIGATION_STATUS_LABELS, RECOGNITION_BASIS_LABELS, RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Obligaciones · Supply 2.0' }

const ESTADOS: SupplyV2ObligationStatus[] = ['OPEN', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']

/** MEMBEGO SUPPLY 2.0 · obligaciones con proveedores (§38): qué se debe, por qué nació y cuánto falta. */
export default async function ObligacionesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const proveedor = typeof sp.proveedor === 'string' ? sp.proveedor : ''
  const estadoCrudo = typeof sp.estado === 'string' ? sp.estado : 'VIVAS'
  const estado = estadoCrudo === 'VIVAS' ? 'VIVAS' : (ESTADOS as string[]).includes(estadoCrudo) ? (estadoCrudo as SupplyV2ObligationStatus) : null
  const paginacion = leerPaginacion(sp)
  const [{ filas, total }, proveedores] = await Promise.all([listarObligaciones({ supplierId: proveedor || null, status: estado }, paginacion), proveedoresParaFinanzas()])
  const select = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'
  return (
    <div className="space-y-6">
      <PageHeader
        title="Obligaciones con proveedores"
        description="Cada deuda dice por qué nació: al aprobar la factura, al recibir o al entregar, según la versión del acuerdo. Una compra prepagada no genera deuda al recibir ni al redimir."
        eyebrow={<Link href={RUTA_FINANZAS} className="hover:underline">Finanzas</Link>}
        nav={<NavSupplyV2 activa="finanzas" />}
      />
      <Card>
        <CardContent className="pt-6">
          <form method="get" className="grid gap-3 sm:grid-cols-4">
            <div><Label htmlFor="proveedor">Proveedor</Label><select id="proveedor" name="proveedor" defaultValue={proveedor} className={select}><option value="">Todos</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.commercialName}</option>)}</select></div>
            <div><Label htmlFor="estado">Estado</Label><select id="estado" name="estado" defaultValue={estadoCrudo} className={select}><option value="VIVAS">Pendientes y parciales</option><option value="">Todas</option>{ESTADOS.map((e) => <option key={e} value={e}>{OBLIGATION_STATUS_LABELS[e]}</option>)}</select></div>
            <div className="flex items-end gap-2"><Button type="submit" variant="outline">Filtrar</Button><Button asChild variant="ghost"><Link href={`${RUTA_FINANZAS}/obligaciones`}>Limpiar</Link></Button></div>
          </form>
        </CardContent>
      </Card>
      {filas.length === 0 ? (
        <EmptyState variant="card" title="Sin obligaciones" description={estado === 'VIVAS' ? 'No se debe nada a proveedores con este filtro.' : 'Ninguna obligación cumple el filtro.'} />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="tabla-obligaciones">
                <thead className="text-left text-caption text-muted-foreground"><tr><th className="py-1 pr-3">Proveedor</th><th className="py-1 pr-3">Origen</th><th className="py-1 pr-3 text-right">Monto</th><th className="py-1 pr-3 text-right">Pagado</th><th className="py-1 pr-3 text-right">Pendiente</th><th className="py-1 pr-3">Vence</th><th className="py-1">Estado</th></tr></thead>
                <tbody>
                  {filas.map((o) => (
                    <tr key={o.id} className="border-t border-border" data-testid="obligacion">
                      <td className="py-2 pr-3 font-medium"><Link href={`/superadmin/supply-v2/proveedores/${o.proveedorId}`} className="underline-offset-4 hover:underline">{o.proveedor}</Link><span className="block text-caption text-muted-foreground">{o.number}</span></td>
                      <td className="py-2 pr-3">{o.invoice ? <Link href={`${RUTA_FINANZAS}/facturas/${o.invoice.id}`} className="underline-offset-4 hover:underline">{o.origen}</Link> : o.origen}<span className="block text-caption text-muted-foreground">{RECOGNITION_BASIS_LABELS[o.recognitionBasis as keyof typeof RECOGNITION_BASIS_LABELS]}{o.purchaseOrder ? ` · ${o.purchaseOrder.number}` : ''}</span></td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(o.grossAmount, o.currency)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(o.paidAmount, o.currency)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums" data-testid="obligacion-pendiente">{dineroSupplyV2(o.outstandingAmount, o.currency)}</td>
                      <td className="py-2 pr-3">{o.dueAt ? formatDate(o.dueAt) : '—'}</td>
                      <td className="py-2"><ChipObligacion estado={o.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablaPaginacion paginacion={paginacion} total={total} params={sp} etiqueta="obligaciones" />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
