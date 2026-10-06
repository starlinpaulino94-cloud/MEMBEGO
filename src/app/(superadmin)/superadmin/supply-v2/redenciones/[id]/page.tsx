import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime, formatMoneyRD } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipDerecho, ChipRedencion } from '@/components/supply-v2/chips'
import { ReversarRedencion } from '@/components/supply-v2/reversar-redencion'
import { fichaRedencion } from '@/modules/supply-v2/redemption/queries'
import { puedeSupplyV2 } from '@/modules/supply-v2/permisos'
import { BASE_SUPPLY_V2, RUTA_REDENCIONES, VOUCHER_STATUS_LABELS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'

/** MEMBEGO SUPPLY 2.0 · ficha INTERNA de una redención (§34, §56–§57, §65). */
export default async function RedencionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const [r, puedeReversar] = await Promise.all([fichaRedencion(id), puedeSupplyV2('SUPPLY_V2_REDEMPTION_REVERSE')])
  if (!r) notFound()
  const dinero = (n: { toString(): string }, moneda: string) => (moneda === 'DOP' ? formatMoneyRD(Number(n)) : `${moneda} ${Number(n).toLocaleString('es-DO')}`)

  return (
    <div className="space-y-6">
      <PageHeader
        title={r.number}
        description={`${r.catalogItem.name} · ${r.supplier.commercialName} · ${formatDateTime(r.redeemedAt)}`}
        eyebrow={
          <Link href={RUTA_REDENCIONES} className="hover:underline">
            Redenciones
          </Link>
        }
        nav={<NavSupplyV2 activa="redenciones" />}
        action={<ChipRedencion reversada={r.reversedAt !== null} />}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Entrega</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-1 text-sm">
              <Dato label="Cliente">{r.clienteNombre} <span className="text-caption text-muted-foreground">{r.customer.email}</span></Dato>
              <Dato label="Producto">{r.catalogItem.name}</Dato>
              <Dato label="Cantidad">{r.quantity}</Dato>
              <Dato label="Proveedor">{r.supplier.commercialName}</Dato>
              <Dato label="Sucursal">{r.branch?.nombre ?? '—'}</Dato>
              <Dato label="Empleado">{r.empleadoNombre}</Dato>
              <Dato label="Fecha">{formatDateTime(r.redeemedAt)}</Dato>
              <Dato label="Canal">{r.channel === 'QR_SCAN' ? 'QR escaneado' : 'Código escrito a mano'}</Dato>
              <Dato label="Dispositivo"><span className="break-all text-caption">{r.deviceInfo ?? '—'}</span></Dato>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Economía congelada</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-1 text-sm">
              <Dato label="Costo del lote (real)"><span data-testid="redencion-costo">{dinero(r.unitCostSnapshot, r.currency)}</span></Dato>
              <Dato label="Precio que pagó el cliente">{dinero(r.customerUnitPriceSnapshot, r.currency)}</Dato>
              <Dato label="Cliente pagó al comercio">{dinero(r.customerPaysMerchant, r.currency)}</Dato>
              <Dato label="Lote">{r.lot ? <Link href={`${BASE_SUPPLY_V2}/supply/lotes/${r.lot.id}`} className="underline-offset-4 hover:underline">{r.lot.code}</Link> : <span data-testid="redencion-sin-lote">Sin lote · venta a comisión</span>}</Dato>
              {r.sourceType === 'COMMISSION' ? (
                <>
                  <Dato label="Comisión de Membego"><span data-testid="redencion-comision">{dinero(r.commissionAmountSnapshot ?? 0, r.currency)}</span> ({r.commissionPercentageSnapshot?.toString() ?? '—'} %)</Dato>
                  <Dato label="Neto del proveedor"><span data-testid="redencion-neto">{dinero(r.supplierNetSnapshot ?? 0, r.currency)}</span></Dato>
                </>
              ) : null}
              <Dato label="Oferta"><Link href={`${BASE_SUPPLY_V2}/ofertas/${r.entitlement.offer.id}`} className="underline-offset-4 hover:underline">{r.entitlement.offer.code}</Link></Dato>
              <Dato label="Orden del cliente">{r.entitlement.order.number}</Dato>
              <Dato label="Derecho"><span className="font-mono text-caption">{r.entitlement.id}</span> <ChipDerecho estado={r.entitlement.status} /></Dato>
              <Dato label="Voucher"><span className="font-mono text-caption">{r.voucher.id}</span> · {VOUCHER_STATUS_LABELS[r.voucher.status]}</Dato>
              <Dato label="Sesión QR"><span className="font-mono text-caption">{r.qrSession.id}</span></Dato>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Reversa</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {r.reversedAt ? (
            <div data-testid="redencion-reversada">
              <p className="font-medium">Reversada el {formatDateTime(r.reversedAt)}{r.reversadaPor ? ` por ${r.reversadaPor}` : ''}.</p>
              <p className="text-muted-foreground">Motivo: {r.reversalReason}</p>
              <p className="text-muted-foreground">La unidad volvió a ISSUED y el beneficio del cliente quedó disponible otra vez; el QR usado no revive.</p>
            </div>
          ) : puedeReversar ? (
            <ReversarRedencion redemptionId={r.id} />
          ) : (
            <p className="text-muted-foreground">No tienes permiso para reversar.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Trazabilidad</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-2 text-sm" data-testid="redencion-timeline">
            {r.timeline.map((h, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-36 shrink-0 font-mono text-caption text-muted-foreground">{formatDateTime(h.cuando)}</span>
                <span>
                  <span className="font-medium">{h.titulo}</span>
                  {h.detalle && <span className="block text-caption text-muted-foreground">{h.detalle}</span>}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  )
}
