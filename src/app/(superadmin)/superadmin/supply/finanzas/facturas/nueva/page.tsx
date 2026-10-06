import Link from 'next/link'
import { randomUUID } from 'crypto'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { FormFactura } from '@/components/supply-v2/finanzas/form-factura'
import { ordenesFacturables, proveedoresParaFinanzas } from '@/modules/supply-v2/finance/queries'
import { RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nueva factura · Supply' }

export default async function NuevaFacturaPage({ searchParams }: { searchParams: Promise<{ proveedor?: string; orden?: string }> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const [proveedores, ordenes] = await Promise.all([proveedoresParaFinanzas(), ordenesFacturables()])
  return (
    <div className="space-y-6">
      <PageHeader
        title="Nueva factura de proveedor"
        description="Prioridad: factura contra una orden de compra aprobada. Las cantidades se precargan con lo que queda por facturar; el servidor recalcula los totales."
        eyebrow={<Link href={`${RUTA_FINANZAS}/facturas`} className="hover:underline">Facturas</Link>}
        nav={<NavSupplyV2 activa="finanzas" />}
      />
      {proveedores.length === 0 ? (
        <EmptyState variant="card" title="Sin proveedores activos" description="Primero registra un proveedor." action={<Button asChild><Link href="/superadmin/supply/proveedores">Proveedores</Link></Button>} />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <FormFactura proveedores={proveedores} ordenes={ordenes} supplierId={sp.proveedor} purchaseOrderId={sp.orden} idempotencyKey={`ui-factura-${randomUUID()}`} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
