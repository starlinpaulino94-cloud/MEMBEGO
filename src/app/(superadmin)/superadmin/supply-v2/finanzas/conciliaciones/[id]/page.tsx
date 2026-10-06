import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { formatDate, formatDateTime } from '@/lib/format'
import { leerPaginacion } from '@/lib/paginacion'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipConciliacion } from '@/components/supply-v2/finanzas/chips'
import { RegistrarCifrasProveedor, RegistrarMontoProveedor, ResolverConciliacion } from '@/components/supply-v2/finanzas/form-conciliacion'
import { fichaConciliacion } from '@/modules/supply-v2/finance/queries'
import { puedeSupplyV2 } from '@/modules/supply-v2/permisos'
import { SIN_INFORMACION_DEL_PROVEEDOR } from '@/modules/supply-v2/finance/domain'
import { dineroSupplyV2, RECONCILIATION_KIND_LABELS, RESOLUTION_TYPE_LABELS, RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'

const TIPO: Record<string, string> = { INVOICE: 'Factura', PAYMENT: 'Pago', DEPOSIT: 'Depósito', DEPOSIT_APPLICATION: 'Depósito aplicado', OBLIGATION: 'Obligación', REDEMPTION: 'Obligación por entrega', SETTLEMENT: 'Liquidación' }

/** MEMBEGO SUPPLY 2.0 · ficha de una conciliación (§43–§46) con sus líneas paginadas (§47). */
export default async function ConciliacionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const sp = await searchParams
  const paginacion = leerPaginacion(sp, 50)
  const [r, puedoSupply, puedoComision] = await Promise.all([fichaConciliacion(id, paginacion), puedeSupplyV2('SUPPLY_V2_RECONCILE'), puedeSupplyV2('SUPPLY_V2_COMMISSION_RECONCILE')])
  if (!r) notFound()
  const m = r.currency
  const comision = r.kind === 'COMMISSION'
  const puedo = comision ? puedoComision : puedoSupply
  return (
    <div className="space-y-6">
      <PageHeader title={r.number} description={`${RECONCILIATION_KIND_LABELS[r.kind]} · ${r.supplier.commercialName} · ${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}`} eyebrow={<Link href={`${RUTA_FINANZAS}/conciliaciones`} className="hover:underline">Conciliaciones</Link>} nav={<NavSupplyV2 activa="finanzas" />} action={<ChipConciliacion estado={r.status} />} />
      {comision && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="conciliacion-comision">
          <StatCard label="Bruto vendido (Membego)" value={<span data-testid="conc-bruto">{dineroSupplyV2(r.grossSalesInternal ?? '0', m)}</span>} sub={r.grossClaimed ? `proveedor: ${dineroSupplyV2(r.grossClaimed, m)}` : SIN_INFORMACION_DEL_PROVEEDOR} />
          <StatCard label="Comisión (Membego)" value={<span data-testid="conc-comision">{dineroSupplyV2(r.commissionInternal ?? '0', m)}</span>} sub={r.commissionClaimed ? `proveedor: ${dineroSupplyV2(r.commissionClaimed, m)}` : SIN_INFORMACION_DEL_PROVEEDOR} />
          <StatCard label="Neto devengado (Membego)" value={<span data-testid="conc-neto">{dineroSupplyV2(r.netInternal ?? '0', m)}</span>} sub={r.netClaimed ? `proveedor: ${dineroSupplyV2(r.netClaimed, m)}` : SIN_INFORMACION_DEL_PROVEEDOR} accent="brand" />
          <StatCard label="Pagos aplicados (Membego)" value={<span data-testid="conc-pagos">{dineroSupplyV2(r.paymentsInternal ?? '0', m)}</span>} />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={comision ? 'Neto según Membego' : 'Saldo según Membego'} value={<span data-testid="conciliacion-interno">{dineroSupplyV2(r.internalAmount, m)}</span>} sub={comision ? 'neto de las entregas a comisión del periodo' : 'deuda reconocida − pagos − depósito aplicado, en el periodo'} />
        <StatCard label="Saldo según el proveedor" value={<span data-testid="conciliacion-proveedor">{r.supplierAmount ? dineroSupplyV2(r.supplierAmount, m) : SIN_INFORMACION_DEL_PROVEEDOR}</span>} />
        <StatCard label="Diferencia" value={<span data-testid="conciliacion-diferencia">{r.differenceAmount ? dineroSupplyV2(r.differenceAmount, m) : '—'}</span>} accent={r.status === 'DISCREPANCY' ? 'warning' : r.status === 'MATCHED' ? 'success' : undefined} />
      </div>
      <Card data-testid="siguiente-paso">
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm font-medium">
            {r.status === 'OPEN' && (r.supplierAmount ? 'Abierta.' : `${SIN_INFORMACION_DEL_PROVEEDOR}: registra el saldo de su estado de cuenta para comparar. No se marca como cuadrada sola.`)}
            {r.status === 'MATCHED' && 'Cuadra con el proveedor. Puedes marcarla como resuelta.'}
            {r.status === 'DISCREPANCY' && `Hay una diferencia de ${dineroSupplyV2(r.differenceAmount ?? '0', m)} entre Membego y el proveedor. Revisa las líneas y resuélvela explicando cómo.`}
            {r.status === 'RESOLVED' && `Resuelta el ${formatDateTime(r.resolvedAt!)}${r.resueltoPor ? ` por ${r.resueltoPor}` : ''}${r.resolutionType ? ` · ${RESOLUTION_TYPE_LABELS[r.resolutionType]}` : ''}: ${r.resolutionNotes}`}
          </p>
          {puedo && r.status !== 'RESOLVED' && (comision ? <RegistrarCifrasProveedor reconciliationId={r.id} /> : <RegistrarMontoProveedor reconciliationId={r.id} />)}
          {puedo && r.status !== 'RESOLVED' && r.supplierAmount != null && <ResolverConciliacion reconciliationId={r.id} comision={comision} />}
          {r.notes && <p className="text-caption text-muted-foreground">Notas: {r.notes}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Lo que Membego registró en el periodo</CardTitle></CardHeader>
        <CardContent>
          {r.totalLineas === 0 ? <p className="text-sm text-muted-foreground">Ningún movimiento con este proveedor en el periodo.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="conciliacion-lineas">
                <thead className="text-left text-caption text-muted-foreground"><tr><th className="py-1 pr-3">Fecha</th><th className="py-1 pr-3">Tipo</th><th className="py-1 pr-3">Detalle</th><th className="py-1 pr-3 text-right">Membego</th><th className="py-1 text-right">Proveedor</th></tr></thead>
                <tbody>
                  {r.lineas.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="py-2 pr-3">{formatDate(l.occurredAt)}</td>
                      <td className="py-2 pr-3">{TIPO[l.type] ?? l.type}</td>
                      <td className="py-2 pr-3">{l.description}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(l.internalAmount, m)}</td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">{l.supplierAmount ? dineroSupplyV2(l.supplierAmount, m) : SIN_INFORMACION_DEL_PROVEEDOR}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <TablaPaginacion paginacion={paginacion} total={r.totalLineas} params={sp} etiqueta="líneas" />
        </CardContent>
      </Card>
    </div>
  )
}
