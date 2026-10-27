import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { leerPaginacion } from '@/lib/paginacion'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { TablaConciliaciones } from '@/components/supply-v2/finanzas/tablas'
import { listarConciliaciones } from '@/modules/supply-v2/finance/queries'
import { RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Conciliaciones · Supply' }

/** MEMBEGO SUPPLY · conciliaciones (§43–§46). Sin estado del proveedor no hay «cuadra». */
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
        <TablaConciliaciones filas={filas} pie={<TablaPaginacion paginacion={paginacion} total={total} params={sp} etiqueta="conciliaciones" />} />
      )}
    </div>
  )
}
