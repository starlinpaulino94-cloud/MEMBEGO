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

/** MEMBEGO SUPPLY · timeline ECONÓMICO de una compra del cliente (§30, §62): venta → derecho → costo → margen → redención/vencimiento. */
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
        eyebrow={<Link href="/superadmin/supply/ofertas/ventas" className="hover:underline">Ventas y cobros</Link>}
        nav={<NavSupplyV2 activa="ofertas" />}
        action={<ChipCompra estado={t.order.status as SupplyV2CustomerOrderStatus} />}
      />
      {(Number(t.order.membegoSubsidyTotal) > 0 || Number(t.order.supplierDiscountTotal) > 0) && (
        <Card data-testid="venta-financiacion">
          <CardHeader><CardTitle>Financiación de esta venta</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-sm sm:grid-cols-4">
              <Fila label="Valor contractual"><span data-testid="venta-contractual">{dineroSupplyV2(t.order.contractualValue, m)}</span></Fila>
              <Fila label="Descuento del proveedor">{dineroSupplyV2(t.order.supplierDiscountTotal, m)}</Fila>
              <Fila label="Bono de Membego"><span data-testid="venta-subsidio">{dineroSupplyV2(t.order.membegoSubsidyTotal, m)}</span></Fila>
              <Fila label="Pagó el cliente">{dineroSupplyV2(t.order.total, m)}</Fila>
            </dl>
            {t.order.beneficio && (
              <p className="mt-2 text-caption text-muted-foreground">
                Beneficio {t.order.beneficio.code} · {t.order.beneficio.name}. El bono de Membego es costo promocional: el proveedor cobra su importe contractual completo.
              </p>
            )}
          </CardContent>
        </Card>
      )}
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
                    <Fila label="Valor contractual de la unidad">{dineroSupplyV2(d.venta.contractual, m)}</Fila>
                    {Number(d.venta.descuentoProveedor) > 0 && <Fila label="Descuento del proveedor">{dineroSupplyV2(d.venta.descuentoProveedor, m)}</Fila>}
                    {Number(d.venta.subsidio) > 0 && <Fila label="Bono de Membego (subsidio)"><span data-testid="eco-subsidio-unidad">{dineroSupplyV2(d.venta.subsidio, m)}</span></Fila>}
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
