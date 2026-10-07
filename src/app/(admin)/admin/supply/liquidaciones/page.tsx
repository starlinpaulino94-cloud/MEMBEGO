import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { ChipLiquidacion } from '@/components/supply-v2/finanzas/chips'
import { proveedorDeLaSesion } from '@/modules/supply-v2/permisos'
import { liquidacionesDelProveedor } from '@/modules/supply-v2/redemption/queries'
import { dineroSupplyV2, RUTA_PORTAL_LIQUIDACIONES, RUTA_PORTAL_VENTAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Liquidaciones Membego' }

/** MEMBEGO SUPPLY · SLICE 5 · portal del proveedor: sus liquidaciones y pagos (§61). */
export default async function LiquidacionesProveedorPage() {
  const proveedor = await proveedorDeLaSesion()
  if (!proveedor) redirect('/admin/dashboard')
  const liquidaciones = await liquidacionesDelProveedor(proveedor.supplierId)
  return (
    <div className="space-y-6">
      <PageHeader title="Liquidaciones y pagos" description="Cada liquidación resume un periodo de ventas Membego entregadas: lo vendido, la comisión de Membego y el neto que te corresponde." eyebrow={<Link href={RUTA_PORTAL_VENTAS} className="hover:underline">Ventas Membego</Link>} />
      <Card>
        <CardContent className="pt-6">
          {liquidaciones.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="liquidaciones-vacias">Todavía no hay liquidaciones.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="liquidaciones-proveedor">
              {liquidaciones.map((l) => (
                <li key={l.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between" data-testid="liquidacion-proveedor">
                  <span>
                    <Link href={`${RUTA_PORTAL_LIQUIDACIONES}/${l.id}`} className="font-medium underline-offset-4 hover:underline" data-testid="link-liquidacion-proveedor">{l.number}</Link>
                    <span className="block text-caption text-muted-foreground">{formatDate(l.periodStart)} – {formatDate(l.periodEnd)} · {l.entregas} entrega(s)</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-right tabular-nums"><span className="block font-medium" data-testid="liquidacion-neto">{dineroSupplyV2(l.supplierNet, l.currency)}</span><span className="block text-caption text-muted-foreground">pagado {dineroSupplyV2(l.paidAmount, l.currency)}</span></span>
                    <ChipLiquidacion estado={l.status as never} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
