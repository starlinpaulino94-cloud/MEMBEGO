import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { formatDate } from '@/lib/format'
import { leerPaginacion } from '@/lib/paginacion'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipConciliacion } from '@/components/supply-v2/finanzas/chips'
import { listarConciliaciones } from '@/modules/supply-v2/finance/queries'
import { SIN_INFORMACION_DEL_PROVEEDOR } from '@/modules/supply-v2/finance/domain'
import { dineroSupplyV2, RECONCILIATION_KIND_LABELS, RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Conciliaciones · Supply 2.0' }

/** MEMBEGO SUPPLY 2.0 · conciliaciones (§43–§46). Sin estado del proveedor no hay «cuadra». */
export default async function ConciliacionesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const paginacion = leerPaginacion(sp)
  const { filas, total } = await listarConciliaciones({ supplierId: typeof sp.proveedor === 'string' ? sp.proveedor : null }, paginacion)
  return (
    <div className="space-y-6">
      <PageHeader
        title="Conciliaciones"
        description="Lo que Membego registró con un proveedor en un periodo, frente a lo que dice su estado de cuenta. Nada se marca como cuadrado sin la cifra del proveedor."
        eyebrow={<Link href={RUTA_FINANZAS} className="hover:underline">Finanzas</Link>}
        nav={<NavSupplyV2 activa="finanzas" />}
        action={<Button asChild><Link href={`${RUTA_FINANZAS}/conciliaciones/nueva`} data-testid="btn-nueva-conciliacion">+ Nueva conciliación</Link></Button>}
      />
      {filas.length === 0 ? (
        <EmptyState variant="card" title="Sin conciliaciones" description="Abre la primera: elige proveedor y periodo; Membego arma su lado con facturas, pagos, depósitos y obligaciones." />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="tabla-conciliaciones">
                <thead className="text-left text-caption text-muted-foreground"><tr><th className="py-1 pr-3">Conciliación</th><th className="py-1 pr-3">Proveedor</th><th className="py-1 pr-3">Periodo</th><th className="py-1 pr-3 text-right">Membego</th><th className="py-1 pr-3 text-right">Proveedor</th><th className="py-1 pr-3 text-right">Diferencia</th><th className="py-1">Estado</th></tr></thead>
                <tbody>
                  {filas.map((r) => (
                    <tr key={r.id} className="border-t border-border" data-testid="conciliacion">
                      <td className="py-2 pr-3 font-medium"><Link href={`${RUTA_FINANZAS}/conciliaciones/${r.id}`} className="underline-offset-4 hover:underline">{r.number}</Link><span className="block text-caption text-muted-foreground">{RECONCILIATION_KIND_LABELS[r.kind]} · {r.lineas} líneas</span></td>
                      <td className="py-2 pr-3">{r.proveedor}</td>
                      <td className="py-2 pr-3">{formatDate(r.periodStart)} – {formatDate(r.periodEnd)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(r.internalAmount, r.currency)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.supplierAmount ? dineroSupplyV2(r.supplierAmount, r.currency) : <span className="text-caption text-muted-foreground">{SIN_INFORMACION_DEL_PROVEEDOR}</span>}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.differenceAmount ? dineroSupplyV2(r.differenceAmount, r.currency) : '—'}</td>
                      <td className="py-2"><ChipConciliacion estado={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablaPaginacion paginacion={paginacion} total={total} params={sp} etiqueta="conciliaciones" />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
