import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { leerPaginacion } from '@/lib/paginacion'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { TablaDepositos } from '@/components/supply-v2/finanzas/tablas'
import { listarDepositos } from '@/modules/supply-v2/finance/queries'
import { RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Depósitos · Supply' }

/** MEMBEGO SUPPLY · depósitos a proveedores (§36). Un depósito nace de un pago confirmado marcado como anticipo. */
export default async function DepositosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const proveedor = typeof sp.proveedor === 'string' ? sp.proveedor : ''
  const paginacion = leerPaginacion(sp)
  const { filas, total } = await listarDepositos({ supplierId: proveedor || null }, paginacion)
  return (
    <div className="space-y-6">
      <PageHeader
        title="Depósitos"
        description="Dinero adelantado a un proveedor a cuenta de compras futuras. Cada aplicación deja un movimiento; la suma de movimientos reconstruye el saldo."
        eyebrow={<Link href={RUTA_FINANZAS} className="hover:underline">Finanzas</Link>}
        nav={<NavSupplyV2 activa="finanzas" />}
        action={<Button asChild><Link href={`${RUTA_FINANZAS}/pagos/nuevo?destino=DEPOSITO`} data-testid="btn-nuevo-deposito">+ Registrar anticipo</Link></Button>}
      />
      {filas.length === 0 ? (
        <EmptyState variant="card" title="Sin depósitos" description="Registra un pago marcado como anticipo; al confirmarse nace el depósito." action={<Button asChild><Link href={`${RUTA_FINANZAS}/pagos/nuevo?destino=DEPOSITO`}>Registrar anticipo</Link></Button>} />
      ) : (
        <TablaDepositos filas={filas} pie={<TablaPaginacion paginacion={paginacion} total={total} params={sp} etiqueta="depósitos" />} />
      )}
    </div>
  )
}
