import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Label } from '@/components/ui/label'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { leerPaginacion } from '@/lib/paginacion'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { TablaLiquidaciones } from '@/components/supply-v2/finanzas/tablas'
import { listarLiquidaciones, proveedoresParaFinanzas } from '@/modules/supply-v2/finance/queries'
import { RUTA_FINANZAS, RUTA_LIQUIDACIONES, SETTLEMENT_STATUS_LABELS } from '@/modules/supply-v2/core/catalogo'

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
          <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div><Label htmlFor="proveedor">Proveedor</Label><select id="proveedor" name="proveedor" defaultValue={proveedor} className={select}><option value="">Todos</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.commercialName}</option>)}</select></div>
            <div><Label htmlFor="estado">Estado</Label><select id="estado" name="estado" defaultValue={estado} className={select}><option value="VIVAS">Vivas (sin pagar del todo)</option><option value="">Todas</option>{ESTADOS.map((e) => <option key={e} value={e}>{SETTLEMENT_STATUS_LABELS[e]}</option>)}</select></div>
            <div className="flex items-end gap-2"><Button type="submit" variant="outline">Filtrar</Button><Button asChild variant="ghost"><Link href={RUTA_LIQUIDACIONES}>Limpiar</Link></Button></div>
          </form>
        </CardContent>
      </Card>
      {filas.length === 0 ? (
        <EmptyState variant="card" title="Sin liquidaciones" description="Cuando haya entregas a comisión pendientes de pago, genera la liquidación del periodo." action={<Button asChild><Link href={`${RUTA_LIQUIDACIONES}/nueva`}>Generar liquidación</Link></Button>} />
      ) : (
        <TablaLiquidaciones filas={filas} pie={<TablaPaginacion paginacion={paginacion} total={total} params={sp} etiqueta="liquidaciones" />} />
      )}
    </div>
  )
}
