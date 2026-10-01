import Link from 'next/link'
import { notFound } from 'next/navigation'
import { randomUUID } from 'crypto'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { formatDate, formatDateTime } from '@/lib/format'
import { leerPaginacion } from '@/lib/paginacion'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipLiquidacion, ChipObligacion, ChipPagoProveedor } from '@/components/supply-v2/finanzas/chips'
import { AprobarLiquidacion, CancelarLiquidacion } from '@/components/supply-v2/finanzas/form-liquidacion'
import { FormPago } from '@/components/supply-v2/finanzas/form-pago'
import { ConfirmarPago } from '@/components/supply-v2/finanzas/acciones-pago'
import { fichaLiquidacion, proveedoresParaFinanzas } from '@/modules/supply-v2/finance/queries'
import { exigirPermisoSupplyV2, puedeSupplyV2 } from '@/modules/supply-v2/permisos'
import { dineroSupplyV2, RUTA_FINANZAS, RUTA_LIQUIDACIONES, SETTLEMENT_FREQUENCY_LABELS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'

/** MEMBEGO SUPPLY 2.0 · SLICE 5 · ficha de una liquidación (§46): líneas (foto), aprobación, pagos. */
export default async function LiquidacionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const sp = await searchParams
  const paginacion = leerPaginacion(sp, 50)
  const [l, actor, puedeAprobar, puedePagar, puedeConfirmar, puedeCancelar, proveedores] = await Promise.all([
    fichaLiquidacion(id, paginacion),
    exigirPermisoSupplyV2('SUPPLY_V2_SETTLEMENT_VIEW'),
    puedeSupplyV2('SUPPLY_V2_SETTLEMENT_APPROVE'),
    puedeSupplyV2('SUPPLY_V2_SETTLEMENT_PAY'),
    puedeSupplyV2('SUPPLY_V2_PAYMENT_APPROVE'),
    puedeSupplyV2('SUPPLY_V2_SETTLEMENT_CREATE'),
    proveedoresParaFinanzas(),
  ])
  if (!l) notFound()
  const m = l.currency
  const pagable = l.status === 'APPROVED' || l.status === 'PARTIALLY_PAID'
  return (
    <div className="space-y-6">
      <PageHeader
        title={l.number}
        description={`${l.supplier.commercialName} · ${formatDate(l.periodStart)} – ${formatDate(l.periodEnd)} · ${SETTLEMENT_FREQUENCY_LABELS[l.frequency]}`}
        eyebrow={<Link href={RUTA_LIQUIDACIONES} className="hover:underline">Liquidaciones</Link>}
        nav={<NavSupplyV2 activa="finanzas" />}
        action={<ChipLiquidacion estado={l.status} />}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Bruto vendido (GMV)" value={<span data-testid="liq-bruto">{dineroSupplyV2(l.grossSales, m)}</span>} sub={`${l.totalLineas} entrega(s)`} />
        <StatCard label="Comisión de Membego" value={<span data-testid="liq-comision">{dineroSupplyV2(l.commissionAmount, m)}</span>} accent="brand" />
        <StatCard label="Neto al proveedor" value={<span data-testid="liq-neto">{dineroSupplyV2(l.supplierNet, m)}</span>} accent="warning" />
        <StatCard label="Pagado · pendiente" value={<span data-testid="liq-pagado">{dineroSupplyV2(l.paidAmount, m)}</span>} sub={`${dineroSupplyV2(l.pendiente, m)} pendiente`} accent={l.status === 'PAID' ? 'success' : undefined} />
      </div>

      {/* Slice 6 (§26): el GMV, el valor contractual y lo que de verdad pagó el cliente son tres cifras distintas. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="liq-financiacion">
        <StatCard label="Valor contractual" value={<span data-testid="liq-contractual">{dineroSupplyV2(l.contractualValue, m)}</span>} sub="base de la comisión y del neto" />
        <StatCard label="Descuento del proveedor" value={<span data-testid="liq-descuento-proveedor">{dineroSupplyV2(l.supplierDiscountTotal, m)}</span>} sub="lo rebajó el proveedor; no es dinero de Membego" />
        <StatCard label="Bono de Membego" value={<span data-testid="liq-subsidio">{dineroSupplyV2(l.membegoSubsidyTotal, m)}</span>} sub="costo promocional; no rebaja el neto del proveedor" accent="warning" />
        <StatCard label="Cobrado a los clientes" value={<span data-testid="liq-cobrado">{dineroSupplyV2(l.customerPaidTotal, m)}</span>} sub="lo que entró al banco por estas ventas" />
      </div>

      <Card data-testid="liq-siguiente-paso">
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm font-medium">
            {l.status === 'PENDING_APPROVAL' && `Generada por ${l.creadoPor ?? '—'} el ${formatDateTime(l.createdAt)}. Pendiente de que OTRA persona la apruebe.`}
            {l.status === 'APPROVED' && `Aprobada por ${l.aprobadoPor ?? '—'} el ${formatDateTime(l.approvedAt!)}. Registra el pago al proveedor.`}
            {l.status === 'PARTIALLY_PAID' && `Parcialmente pagada: faltan ${dineroSupplyV2(l.pendiente, m)}.`}
            {l.status === 'PAID' && `Pagada por completo${l.paidAt ? ` el ${formatDateTime(l.paidAt)}` : ''}.`}
            {l.status === 'CANCELLED' && `Cancelada${l.cancelledAt ? ` el ${formatDateTime(l.cancelledAt)}` : ''}: ${l.cancelledReason ?? ''}`}
            {l.status === 'DRAFT' && 'Borrador.'}
          </p>
          <div className="flex flex-wrap items-start gap-3">
            {puedeAprobar && l.status === 'PENDING_APPROVAL' && <AprobarLiquidacion settlementId={l.id} soyElCreador={l.createdById === actor.id} />}
            {puedeCancelar && (l.status === 'PENDING_APPROVAL' || l.status === 'APPROVED') && Number(l.paidAmount) === 0 && <CancelarLiquidacion settlementId={l.id} />}
          </div>
          {l.notes && <p className="text-caption text-muted-foreground">Notas: {l.notes}</p>}
        </CardContent>
      </Card>

      {puedePagar && pagable && (
        <Card>
          <CardHeader><CardTitle>Registrar pago de esta liquidación</CardTitle></CardHeader>
          <CardContent>
            <FormPago proveedores={proveedores} supplierId={l.supplierId} settlementId={l.id} settlementNumber={l.number} destinoInicial="LIQUIDACION" montoSugerido={l.pendiente} idempotencyKey={`ui-pago-liq-${randomUUID()}`} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Pagos de esta liquidación</CardTitle></CardHeader>
        <CardContent>
          {l.pagos.length === 0 ? <p className="text-sm text-muted-foreground">Sin pagos todavía.</p> : (
            <ul className="divide-y divide-border text-sm" data-testid="liq-pagos">
              {l.pagos.map((p) => (
                <li key={p.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span><Link href={`${RUTA_FINANZAS}/pagos/${p.id}`} className="font-medium underline-offset-4 hover:underline">{p.number}</Link> · {dineroSupplyV2(p.amount, m)}{p.reference ? ` · ref. ${p.reference}` : ''}<span className="block text-caption text-muted-foreground">{p.paidAt ? formatDate(p.paidAt) : ''} · registrado por {p.registradoPor ?? '—'}{p.confirmadoPor ? ` · confirmado por ${p.confirmadoPor}` : ''} · aplicado {dineroSupplyV2(p.appliedAmount, m)}</span></span>
                  <span className="flex items-center gap-2"><ChipPagoProveedor estado={p.status} />{puedeConfirmar && p.status === 'PENDING' && <ConfirmarPago paymentId={p.id} soyElCreador={false} compacto />}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Entregas liquidadas (foto)</CardTitle></CardHeader>
        <CardContent>
          {l.totalLineas === 0 ? <p className="text-sm text-muted-foreground">Sin líneas: las entregas salieron de esta liquidación antes de pagarse.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="liq-lineas">
                <thead className="text-left text-caption text-muted-foreground"><tr><th className="py-1 pr-3">Entrega</th><th className="py-1 pr-3">Obligación</th><th className="py-1 pr-3 text-right">Bruto</th><th className="py-1 pr-3 text-right">Contractual</th><th className="py-1 pr-3 text-right">Bono Membego</th><th className="py-1 pr-3 text-right">Pagó el cliente</th><th className="py-1 pr-3 text-right">Comisión</th><th className="py-1 pr-3 text-right">Neto</th><th className="py-1 pr-3 text-right">Pagado</th><th className="py-1">Estado</th></tr></thead>
                <tbody>
                  {l.lineas.map((x) => (
                    <tr key={x.id} className="border-t border-border" data-testid="liq-linea">
                      <td className="py-2 pr-3">{x.redemptionId ? <Link href={`/superadmin/supply-v2/redenciones/${x.redemptionId}`} className="underline-offset-4 hover:underline">{x.descripcion}</Link> : x.descripcion}</td>
                      <td className="py-2 pr-3 font-mono text-caption">{x.obligationNumber}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(x.grossAmount, m)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(x.contractualAmount, m)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(x.membegoSubsidyAmount, m)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(x.customerPaidAmount, m)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(x.commissionAmount, m)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-medium">{dineroSupplyV2(x.supplierNet, m)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(x.paidAmount, m)}</td>
                      <td className="py-2"><ChipObligacion estado={x.obligationStatus} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <TablaPaginacion paginacion={paginacion} total={l.totalLineas} params={sp} etiqueta="entregas" />
          <p className="mt-2 text-caption text-muted-foreground">Las líneas son una foto al generar la liquidación: cambios posteriores en el acuerdo o el catálogo no la alteran.</p>
        </CardContent>
      </Card>
    </div>
  )
}
