import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate, formatDateTime } from '@/lib/format'
import { ChipLiquidacion } from '@/components/supply-v2/finanzas/chips'
import { proveedorDeLaSesion } from '@/modules/supply-v2/permisos'
import { liquidacionDelProveedor } from '@/modules/supply-v2/redemption/queries'
import { dineroSupplyV2, RUTA_PORTAL_LIQUIDACIONES, SUPPLIER_PAYMENT_METHOD_LABELS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'

/** Una liquidación vista por el PROVEEDOR: solo la suya, con sus líneas y pagos confirmados. */
export default async function LiquidacionProveedorPage({ params }: { params: Promise<{ id: string }> }) {
  const proveedor = await proveedorDeLaSesion()
  if (!proveedor) redirect('/admin/dashboard')
  const { id } = await params
  const l = await liquidacionDelProveedor(proveedor.supplierId, id)
  if (!l) notFound()
  const m = l.currency
  return (
    <div className="space-y-6">
      <PageHeader title={l.number} description={`${formatDate(l.periodStart)} – ${formatDate(l.periodEnd)}`} eyebrow={<Link href={RUTA_PORTAL_LIQUIDACIONES} className="hover:underline">Liquidaciones</Link>} action={<ChipLiquidacion estado={l.status as never} />} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Vendido (valor contractual + tu descuento)" value={dineroSupplyV2(l.grossSales, m)} sub={Number(l.supplierDiscountTotal) > 0 ? `incluye ${dineroSupplyV2(l.supplierDiscountTotal, m)} de descuento tuyo` : undefined} />
        <StatCard label="Comisión de Membego" value={dineroSupplyV2(l.commissionAmount, m)} />
        <StatCard label="Neto para ti" value={<span data-testid="liq-prov-neto">{dineroSupplyV2(l.supplierNet, m)}</span>} accent="brand" />
        <StatCard label="Pagado" value={<span data-testid="liq-prov-pagado">{dineroSupplyV2(l.paidAmount, m)}</span>} sub={`${dineroSupplyV2(l.pendiente, m)} pendiente`} accent={l.status === 'PAID' ? 'success' : undefined} />
      </div>
      {Number(l.membegoSubsidyTotal) > 0 && (
        <p className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-sm" data-testid="liq-prov-subsidio">
          En este periodo Membego financió {dineroSupplyV2(l.membegoSubsidyTotal, m)} en bonos a los clientes. Ese dinero lo pone Membego: no se descuenta de tu neto. Los clientes pagaron {dineroSupplyV2(l.customerPaidTotal, m)}.
        </p>
      )}
      <Card>
        <CardHeader><CardTitle>Entregas incluidas</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y divide-border text-sm" data-testid="liq-prov-lineas">
            {l.lineas.map((x) => (
              <li key={x.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between"><span>{x.descripcion}</span><span className="text-right tabular-nums"><span className="block font-medium">{dineroSupplyV2(x.net, m)}</span><span className="block text-caption text-muted-foreground">vendido {dineroSupplyV2(x.gross, m)} · valor contractual {dineroSupplyV2(x.contractual, m)} · comisión {dineroSupplyV2(x.commission, m)}{Number(x.bonoMembego) > 0 ? ` · bono de Membego ${dineroSupplyV2(x.bonoMembego, m)}` : ''}</span></span></li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Pagos recibidos</CardTitle></CardHeader>
        <CardContent>
          {l.pagos.length === 0 ? <p className="text-sm text-muted-foreground">Todavía sin pagos confirmados.</p> : (
            <ul className="divide-y divide-border text-sm" data-testid="liq-prov-pagos">
              {l.pagos.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2"><span>{p.number} · {SUPPLIER_PAYMENT_METHOD_LABELS[p.method]}{p.reference ? ` · ref. ${p.reference}` : ''}<span className="block text-caption text-muted-foreground">{p.paidAt ? formatDateTime(p.paidAt) : ''}</span></span><span className="font-medium tabular-nums">{dineroSupplyV2(p.amount, m)}</span></li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
