import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipCompra, ChipDerecho } from '@/components/supply-v2/chips'
import { TimelineFinanciero } from '@/components/supply-v2/finanzas/timeline-financiero'
import { timelineEconomicoDeCompra } from '@/modules/supply-v2/economics/queries'
import { dineroSupplyV2 } from '@/modules/supply-v2/core/catalogo'
import type { SupplyV2CustomerOrderStatus, SupplyV2EntitlementStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** MEMBEGO SUPPLY 2.0 · timeline ECONÓMICO de una compra del cliente (§30, §62): venta → derecho → costo → margen → redención/vencimiento. */
export default async function VentaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const t = await timelineEconomicoDeCompra(id)
  if (!t) notFound()
  const m = t.order.currency
  return (
    <div className="space-y-6">
      <PageHeader
        title={t.order.number}
        description={`${t.order.customer} · ${dineroSupplyV2(t.order.total, m)}${t.order.paidAt ? ` · pagada ${formatDateTime(t.order.paidAt)}` : ''}`}
        eyebrow={<Link href="/superadmin/supply-v2/ofertas/ventas" className="hover:underline">Ventas y cobros</Link>}
        nav={<NavSupplyV2 activa="ofertas" />}
        action={<ChipCompra estado={t.order.status as SupplyV2CustomerOrderStatus} />}
      />
      {t.derechos.length === 0 ? (
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Sin derechos emitidos: la economía nace cuando se confirma el pago.</p></CardContent></Card>
      ) : (
        t.derechos.map((d, i) => (
          <Card key={d.id} data-testid="derecho-economia">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Derecho {i + 1} · {d.producto} · {d.proveedor}</CardTitle>
              <ChipDerecho estado={d.status as SupplyV2EntitlementStatus} />
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-caption font-medium uppercase text-muted-foreground">Foto económica (congelada)</p>
                {d.venta ? (
                  <dl className="space-y-1 text-sm">
                    <Fila label="Cliente pagó"><span data-testid="eco-cliente-pago">{dineroSupplyV2(d.venta.customerPaid, m)}</span></Fila>
                    <Fila label="Precio público">{dineroSupplyV2(d.venta.publicPrice, m)}</Fila>
                    <Fila label="Descuento">{dineroSupplyV2(d.venta.discount, m)}</Fila>
                    <Fila label="Costo real de la unidad"><span data-testid="eco-costo">{dineroSupplyV2(d.venta.actualUnitCost, m)}</span></Fila>
                    <Fila label="Margen bruto"><span data-testid="eco-margen">{dineroSupplyV2(d.venta.grossMargin, m)}</span></Fila>
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">Sin evento económico todavía.</p>
                )}
              </div>
              <div>
                <p className="mb-2 text-caption font-medium uppercase text-muted-foreground">Recorrido</p>
                <TimelineFinanciero hitos={d.hitos} moneda={m} testId="timeline-economico" />
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

function Fila({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  )
}
