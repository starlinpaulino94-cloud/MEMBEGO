import Link from 'next/link'
import type { SupplyV2SupplierPaymentStatus } from '@prisma/client'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Label } from '@/components/ui/label'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { leerPaginacion } from '@/lib/paginacion'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { TablaPagos } from '@/components/supply-v2/finanzas/tablas'
import { listarPagos, proveedoresParaFinanzas } from '@/modules/supply-v2/finance/queries'
import { puedeSupplyV2 } from '@/modules/supply-v2/permisos'
import { RUTA_FINANZAS, SUPPLIER_PAYMENT_STATUS_LABELS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Pagos a proveedores · Supply' }

const ESTADOS: SupplyV2SupplierPaymentStatus[] = ['PENDING', 'CONFIRMED', 'CANCELLED']

/** MEMBEGO SUPPLY · pagos a proveedores (§37): paginado; los pendientes se confirman aquí (por otra persona). */
export default async function PagosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const proveedor = typeof sp.proveedor === 'string' ? sp.proveedor : ''
  const estadoCrudo = typeof sp.estado === 'string' ? sp.estado : ''
  const estado = (ESTADOS as string[]).includes(estadoCrudo) ? (estadoCrudo as SupplyV2SupplierPaymentStatus) : null
  const paginacion = leerPaginacion(sp)
  const [{ filas, total }, proveedores, puedoConfirmar] = await Promise.all([listarPagos({ supplierId: proveedor || null, status: estado }, paginacion), proveedoresParaFinanzas(), puedeSupplyV2('SUPPLY_V2_PAYMENT_APPROVE')])
  const select = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'
  return (
    <div className="space-y-6">
      <PageHeader
        title="Pagos a proveedores"
        description="Dinero que sale. Una persona lo registra y otra lo confirma; al confirmarse se aplica a la factura, obligación o depósito declarado."
        eyebrow={<Link href={RUTA_FINANZAS} className="hover:underline">Finanzas</Link>}
        nav={<NavSupplyV2 activa="finanzas" />}
        action={<Button asChild><Link href={`${RUTA_FINANZAS}/pagos/nuevo`} data-testid="btn-nuevo-pago">+ Registrar pago</Link></Button>}
      />
      <Card>
        <CardContent className="pt-6">
          <form method="get" className="grid gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="proveedor">Proveedor</Label>
              <select id="proveedor" name="proveedor" defaultValue={proveedor} className={select}><option value="">Todos</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.commercialName}</option>)}</select>
            </div>
            <div>
              <Label htmlFor="estado">Estado</Label>
              <select id="estado" name="estado" defaultValue={estadoCrudo} className={select}><option value="">Todos</option>{ESTADOS.map((e) => <option key={e} value={e}>{SUPPLIER_PAYMENT_STATUS_LABELS[e]}</option>)}</select>
            </div>
            <div className="flex items-end gap-2"><Button type="submit" variant="outline">Filtrar</Button><Button asChild variant="ghost"><Link href={`${RUTA_FINANZAS}/pagos`}>Limpiar</Link></Button></div>
          </form>
        </CardContent>
      </Card>
      {filas.length === 0 ? (
        <EmptyState variant="card" title="Sin pagos" description="Registra el primer pago a un proveedor." />
      ) : (
        <TablaPagos filas={filas} puedoConfirmar={puedoConfirmar} pie={<TablaPaginacion paginacion={paginacion} total={total} params={sp} etiqueta="pagos" />} />
      )}
    </div>
  )
}
