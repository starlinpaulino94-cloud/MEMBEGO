import Link from 'next/link'
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
import { ChipLiquidacion } from '@/components/supply-v2/finanzas/chips'
import { listarLiquidaciones, proveedoresParaFinanzas } from '@/modules/supply-v2/finance/queries'
import { dineroSupplyV2, RUTA_FINANZAS, RUTA_LIQUIDACIONES, SETTLEMENT_FREQUENCY_LABELS, SETTLEMENT_STATUS_LABELS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Liquidaciones · Supply' }

const ESTADOS = ['PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as const

/** MEMBEGO SUPPLY · SLICE 5 · liquidaciones a proveedores (§45): la cuenta de cada periodo de ventas a comisión. */
export default async function LiquidacionesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const proveedor = typeof sp.proveedor === 'string' ? sp.proveedor : ''
  const estado = typeof sp.estado === 'string' ? sp.estado : 'VIVAS'
  const paginacion = leerPaginacion(sp)
  const [{ filas, total }, proveedores] = await Promise.all([listarLiquidaciones({ supplierId: proveedor || null, status: estado || null }, paginacion), proveedoresParaFinanzas()])
  const select = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'
  return (
    <div className="space-y-6">
      <PageHeader
        title="Liquidaciones a proveedores"
        description="Por cada periodo de ventas a comisión: bruto vendido, comisión retenida por Membego y neto a pagar al proveedor por lo entregado. Se aprueba por otra persona y se paga con un pago normal."
        eyebrow={<Link href={RUTA_FINANZAS} className="hover:underline">Finanzas</Link>}
        nav={<NavSupplyV2 activa="finanzas" />}
        action={<Button asChild><Link href={`${RUTA_LIQUIDACIONES}/nueva`} data-testid="btn-nueva-liquidacion">+ Generar liquidación</Link></Button>}
      />
      <Card>
        <CardContent className="pt-6">
          <form method="get" className="grid gap-3 sm:grid-cols-4">
            <div><Label htmlFor="proveedor">Proveedor</Label><select id="proveedor" name="proveedor" defaultValue={proveedor} className={select}><option value="">Todos</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.commercialName}</option>)}</select></div>
            <div><Label htmlFor="estado">Estado</Label><select id="estado" name="estado" defaultValue={estado} className={select}><option value="VIVAS">Vivas (sin pagar del todo)</option><option value="">Todas</option>{ESTADOS.map((e) => <option key={e} value={e}>{SETTLEMENT_STATUS_LABELS[e]}</option>)}</select></div>
            <div className="flex items-end gap-2"><Button type="submit" variant="outline">Filtrar</Button><Button asChild variant="ghost"><Link href={RUTA_LIQUIDACIONES}>Limpiar</Link></Button></div>
          </form>
        </CardContent>
      </Card>
      {filas.length === 0 ? (
        <EmptyState variant="card" title="Sin liquidaciones" description="Cuando haya entregas a comisión pendientes de pago, genera la liquidación del periodo." action={<Button asChild><Link href={`${RUTA_LIQUIDACIONES}/nueva`}>Generar liquidación</Link></Button>} />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="tabla-liquidaciones">
                <thead className="text-left text-caption text-muted-foreground"><tr><th className="py-1 pr-3">Liquidación</th><th className="py-1 pr-3">Proveedor</th><th className="py-1 pr-3">Periodo</th><th className="py-1 pr-3 text-right">Bruto</th><th className="py-1 pr-3 text-right">Comisión</th><th className="py-1 pr-3 text-right">Neto</th><th className="py-1 pr-3 text-right">Pagado</th><th className="py-1 pr-3 text-right">Pendiente</th><th className="py-1">Estado</th></tr></thead>
                <tbody>
                  {filas.map((l) => (
                    <tr key={l.id} className="border-t border-border" data-testid="liquidacion">
                      <td className="py-2 pr-3 font-medium"><Link href={`${RUTA_LIQUIDACIONES}/${l.id}`} className="underline-offset-4 hover:underline" data-testid="link-liquidacion">{l.number}</Link><span className="block text-caption text-muted-foreground">{l.lineas} entrega(s) · {SETTLEMENT_FREQUENCY_LABELS[l.frequency as keyof typeof SETTLEMENT_FREQUENCY_LABELS]}</span></td>
                      <td className="py-2 pr-3"><Link href={`/superadmin/supply/proveedores/${l.proveedorId}`} className="underline-offset-4 hover:underline">{l.proveedor}</Link></td>
                      <td className="py-2 pr-3 text-caption">{formatDate(l.periodStart)} – {formatDate(l.periodEnd)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(l.grossSales, l.currency)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(l.commissionAmount, l.currency)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-medium">{dineroSupplyV2(l.supplierNet, l.currency)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(l.paidAmount, l.currency)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums" data-testid="liquidacion-pendiente">{dineroSupplyV2(l.pendiente, l.currency)}</td>
                      <td className="py-2"><ChipLiquidacion estado={l.status as never} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablaPaginacion paginacion={paginacion} total={total} params={sp} etiqueta="liquidaciones" />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
