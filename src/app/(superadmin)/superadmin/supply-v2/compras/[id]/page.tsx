import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { getUser } from '@/lib/auth'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatDate, formatDateTime } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipOrden } from '@/components/supply-v2/chips'
import { AccionesOrden } from '@/components/supply-v2/acciones-orden'
import { FormRecepcion } from '@/components/supply-v2/form-recepcion'
import { TimelineOrden } from '@/components/supply-v2/timeline-orden'
import { fichaOrden, sucursalesDeProveedor } from '@/modules/supply-v2/procurement/queries'
import { timelineFinancieroOrden } from '@/modules/supply-v2/finance/queries'
import { TimelineFinanciero } from '@/components/supply-v2/finanzas/timeline-financiero'
import { RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'
import { puedeSupplyV2 } from '@/modules/supply-v2/permisos'
import { AGREEMENT_TYPE_LABELS, PAYMENT_MODE_LABELS } from '@/modules/supply-v2/core/catalogo'
import { ORDEN_RECIBIBLE } from '@/modules/supply-v2/core/estados'

export const dynamic = 'force-dynamic'

function dinero(n: { toString(): string } | number | string, moneda: string): string {
  return `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * MEMBEGO SUPPLY 2.0 · ficha de una ORDEN DE COMPRA (§33–§36).
 */
export default async function CompraDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const [orden, user, puedoAprobar, puedoCrear, puedoRecibir] = await Promise.all([
    fichaOrden(id),
    getUser(),
    puedeSupplyV2('SUPPLY_V2_PURCHASE_APPROVE'),
    puedeSupplyV2('SUPPLY_V2_PURCHASE_CREATE'),
    puedeSupplyV2('SUPPLY_V2_RECEIVE'),
  ])
  if (!orden) notFound()
  const [sucursales, hitosFinancieros] = await Promise.all([sucursalesDeProveedor(orden.supplierId), timelineFinancieroOrden(orden.id)])

  const soyElCreador = Boolean(user?.metadata.dbUserId && orden.createdById === user.metadata.dbUserId)
  const compradas = orden.lines.reduce((t, l) => t + l.quantity, 0)
  const recibidas = orden.lines.reduce((t, l) => t + l.receivedQuantity, 0)
  const recibible = ORDEN_RECIBIBLE.includes(orden.status) && puedoRecibir
  const nombre = (u: { name: string | null; email: string } | null) => (u ? u.name ?? u.email : '—')

  return (
    <div className="space-y-6">
      <PageHeader
        title={orden.number}
        description={`${orden.supplier.commercialName} · ${dinero(orden.total, orden.currency)} · ${compradas.toLocaleString('es-DO')} unidades`}
        eyebrow={
          <Link href="/superadmin/supply-v2/compras" className="hover:underline">
            Compras
          </Link>
        }
        nav={<NavSupplyV2 activa="compras" />}
        action={<ChipOrden estado={orden.status} />}
      />

      {/* Siguiente paso (§54): la acción que toca ahora, a la vista. */}
      <Card data-testid="siguiente-paso">
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm font-medium">
            {orden.status === 'DRAFT' && 'Orden creada correctamente. Siguiente paso: enviarla para aprobación.'}
            {orden.status === 'PENDING_APPROVAL' && (soyElCreador ? 'Esperando a que otra persona la apruebe.' : 'Esta orden espera tu aprobación.')}
            {orden.status === 'APPROVED' && 'Orden aprobada. Siguiente paso: registrar la primera recepción.'}
            {orden.status === 'PARTIALLY_RECEIVED' && `${recibidas.toLocaleString('es-DO')} / ${compradas.toLocaleString('es-DO')} recibidas. Siguiente paso: registrar otra recepción.`}
            {orden.status === 'RECEIVED' && `Orden completa: ${recibidas.toLocaleString('es-DO')} unidades recibidas y disponibles en Supply.`}
            {orden.status === 'CANCELLED' && 'Orden cancelada.'}
            {orden.status === 'CLOSED' && 'Orden cerrada.'}
          </p>
          <AccionesOrden ordenId={orden.id} estado={orden.status} soyElCreador={soyElCreador} puedoAprobar={puedoAprobar} puedoCrear={puedoCrear} />
          {orden.status === 'RECEIVED' && (
            <Button asChild variant="outline">
              <Link href="/superadmin/supply-v2/supply">Ver Supply</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Qué compra esta orden</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-caption text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Producto</th>
                    <th className="py-1 pr-3 text-right">Cantidad</th>
                    <th className="py-1 pr-3 text-right">Recibidas</th>
                    <th className="py-1 pr-3 text-right">Costo unitario</th>
                    <th className="py-1 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {orden.lines.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="py-2 pr-3 font-medium">{l.descriptionSnapshot}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{l.quantity.toLocaleString('es-DO')}</td>
                      <td className="py-2 pr-3 text-right tabular-nums" data-testid="recibidas-linea">
                        {l.receivedQuantity.toLocaleString('es-DO')} / {l.quantity.toLocaleString('es-DO')}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dinero(l.unitCost, orden.currency)}</td>
                      <td className="py-2 text-right tabular-nums">{dinero(l.subtotal, orden.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border font-medium">
                  <tr>
                    <td className="py-1 pr-3 text-muted-foreground" colSpan={4}>Subtotal</td>
                    <td className="py-1 text-right tabular-nums">{dinero(orden.subtotal, orden.currency)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-3 text-muted-foreground" colSpan={4}>Impuestos ({orden.taxRate.toString()} %)</td>
                    <td className="py-1 text-right tabular-nums">{dinero(orden.taxes, orden.currency)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-3" colSpan={4}>Total</td>
                    <td className="py-1 text-right text-h4 tabular-nums" data-testid="orden-total">{dinero(orden.total, orden.currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recorrido</CardTitle>
            </CardHeader>
            <CardContent>
              <TimelineOrden estado={orden.status} eventos={orden.events} compradas={compradas} recibidas={recibidas} />
            </CardContent>
          </Card>
          <Card data-testid="timeline-financiero-orden">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Dinero</CardTitle>
              {!['DRAFT', 'PENDING_APPROVAL', 'CANCELLED'].includes(orden.status) && (
                <Button asChild variant="outline" size="sm"><Link href={`${RUTA_FINANZAS}/facturas/nueva?proveedor=${orden.supplierId}&orden=${orden.id}`} data-testid="btn-factura-orden">+ Factura</Link></Button>
              )}
            </CardHeader>
            <CardContent>
              <TimelineFinanciero hitos={hitosFinancieros} moneda={orden.currency} vacio="Sin factura ni pagos todavía." testId="timeline-dinero" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Datos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Dato label="Proveedor">
                <Link href={`/superadmin/supply-v2/proveedores/${orden.supplier.id}`} className="underline-offset-4 hover:underline">
                  {orden.supplier.commercialName}
                </Link>
              </Dato>
              <Dato label="Acuerdo">
                {orden.agreement.code} · {AGREEMENT_TYPE_LABELS[orden.agreement.type]} · v{orden.agreementVersion.version}
              </Dato>
              <Dato label="Forma de pago">{PAYMENT_MODE_LABELS[orden.paymentMode]}</Dato>
              <Dato label="Creada por">{nombre(orden.createdBy)}</Dato>
              <Dato label="Aprobada por">{nombre(orden.approvedBy)}</Dato>
              <Dato label="Creada">{formatDateTime(orden.createdAt)}</Dato>
              {orden.notes && <Dato label="Notas">{orden.notes}</Dato>}
            </CardContent>
          </Card>
        </div>
      </div>

      {puedoRecibir && (recibible || orden.status === 'RECEIVED') && (
        <FormRecepcion
          ordenId={orden.id}
          lineas={orden.lines.map((l) => ({ id: l.id, producto: l.descriptionSnapshot, comprado: l.quantity, recibido: l.receivedQuantity }))}
          sucursales={sucursales}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recepciones</CardTitle>
        </CardHeader>
        <CardContent>
          {orden.receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {ORDEN_RECIBIBLE.includes(orden.status) ? 'Todavía no se ha recibido nada. Registra la primera recepción arriba.' : 'Todavía no hay recepciones.'}
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="lista-recepciones">
              {orden.receipts.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-baseline sm:justify-between">
                  <div>
                    <p className="font-medium">
                      {r.number} · {r.lines.reduce((t, l) => t + l.quantity, 0).toLocaleString('es-DO')} unidades
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {formatDate(r.receivedAt)} · {r.receivedBy.name ?? r.receivedBy.email}
                      {r.branch ? ` · ${r.branch.nombre}` : ''}
                      {r.reference ? ` · ${r.reference}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-caption">
                    {r.lines.map((l) =>
                      l.lot ? (
                        <Link key={l.id} href={`/superadmin/supply-v2/supply/lotes/${l.lot.id}`} className="rounded-full border border-border px-2 py-0.5 hover:bg-muted">
                          {l.lot.code}
                        </Link>
                      ) : null
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  )
}
