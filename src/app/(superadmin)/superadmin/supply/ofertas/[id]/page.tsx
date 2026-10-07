import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatDate, formatDateTime } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipCompra, ChipOferta } from '@/components/supply-v2/chips'
import { ChipModelo } from '@/components/supply-v2/finanzas/chips'
import { AccionesOferta } from '@/components/supply-v2/acciones-oferta'
import { fichaOferta } from '@/modules/supply-v2/offers/queries'
import { calcularPrecioOferta } from '@/modules/supply-v2/core/precios'
import { AVAILABILITY_MODE_LABELS, RUTA_LIQUIDACIONES, RUTA_OFERTAS_PUBLICAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'

/** MEMBEGO SUPPLY · detalle de una oferta (§44, §67). */
export default async function OfertaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const o = await fichaOferta(id)
  if (!o) notFound()
  const dinero = (n: { toString(): string } | number | string) => `${o.currency === 'DOP' ? 'RD$' : `${o.currency} `}${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const precio = calcularPrecioOferta(o.publicPrice.toString(), o.salePrice.toString())
  const a = o.allocation

  return (
    <div className="space-y-6">
      <PageHeader
        title={o.title}
        description={`${o.code} · ${o.catalogItem.name} · ${o.supplier.commercialName}`}
        eyebrow={<Link href="/superadmin/supply/ofertas" className="hover:underline">Ofertas</Link>}
        nav={<NavSupplyV2 activa="ofertas" />}
        action={<span className="flex items-center gap-2"><ChipModelo fuente={o.sourceType} /><ChipOferta estado={o.status} /></span>}
      />

      {o.comision && (
        <Card data-testid="oferta-comision">
          <CardHeader><CardTitle>Venta a comisión · sin lote</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Comisión de Membego" value={<span data-testid="comision-pct">{o.comision.commissionPercentage} %</span>} sub={o.comision.agreementCode ? `${o.comision.agreementCode} · regla ${o.comision.agreementScope === 'ITEM' ? 'por producto' : o.comision.agreementScope === 'CATEGORY' ? 'por categoría' : 'de todo el catálogo'}` : 'sin acuerdo'} accent="brand" />
              <StatCard label="Disponibilidad" value={<span data-testid="comision-libres">{o.comision.libres === null ? 'Sin tope' : o.comision.libres.toLocaleString('es-DO')}</span>} sub={o.comision.availabilityMode ? `${AVAILABILITY_MODE_LABELS[o.comision.availabilityMode]}${o.comision.availabilityQuantity ? ` · ${o.comision.availabilityQuantity.toLocaleString('es-DO')} declaradas` : ''} · ${o.comision.reservadas} reservadas` : ''} />
              <StatCard label="Vendidas · entregadas" value={<><span data-testid="comision-vendidas">{o.comision.vendidas.toLocaleString('es-DO')}</span> · <span data-testid="comision-entregadas">{o.comision.entregadas.toLocaleString('es-DO')}</span></>} sub={`${o.comision.pendientesDeEntrega} pendientes de entrega · ${o.comision.vencidas} vencidas`} accent="success" />
              <StatCard label="GMV · comisión · neto" value={<span data-testid="comision-gmv">{dinero(o.comision.gmv)}</span>} sub={`${dinero(o.comision.comision)} comisión · ${dinero(o.comision.netoProveedor)} neto del proveedor`} />
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <Dato label="Comisión acumulada"><span data-testid="comision-monto">{dinero(o.comision.comision)}</span></Dato>
              <Dato label="Neto del proveedor acumulado"><span data-testid="comision-neto">{dinero(o.comision.netoProveedor)}</span></Dato>
              <Dato label="Neto devengado (entregas)"><span data-testid="comision-devengado">{dinero(o.comision.netoDevengado)}</span></Dato>
              <Dato label="Neto pagado al proveedor"><span data-testid="comision-pagado">{dinero(o.comision.netoPagado)}</span></Dato>
              <Dato label="Neto pendiente de pago"><span data-testid="comision-pendiente">{dinero(o.comision.netoPendiente)}</span></Dato>
            </dl>
            <p className="text-caption text-muted-foreground">
              Membego no compró estas unidades: no hay PO, recepción, lote ni asignación. El ingreso de Membego es la comisión; el neto se le debe al proveedor cuando entrega y se paga por <Link href={RUTA_LIQUIDACIONES} className="underline-offset-4 hover:underline">liquidación</Link>. El cliente nunca ve el reparto.
            </p>
          </CardContent>
        </Card>
      )}

      <Card data-testid="oferta-siguiente-paso">
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm font-medium">
            {o.status === 'DRAFT' && (o.sourceType === 'COMMISSION' ? 'Borrador: publícala para ponerla a la venta (no aparta ningún lote).' : 'Borrador: publícala para apartar el supply y ponerla a la venta.')}
            {o.status === 'SCHEDULED' && `Programada: se activa sola el ${formatDate(o.startsAt)}.`}
            {o.status === 'ACTIVE' && 'Oferta publicada. Está a la venta en el marketplace.'}
            {o.status === 'PAUSED' && 'Pausada: no acepta compras nuevas. Las unidades siguen apartadas.'}
            {o.status === 'SOLD_OUT' && 'Agotada: se vendieron todas las unidades.'}
            {o.status === 'ENDED' && 'Finalizada: las unidades no vendidas volvieron al supply disponible.'}
            {o.status === 'CANCELLED' && 'Cancelada.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <AccionesOferta offerId={o.id} estado={o.status} />
            {(o.status === 'ACTIVE' || o.status === 'SCHEDULED' || o.status === 'PAUSED') && (
              <Button asChild variant="outline">
                <Link href={`${RUTA_OFERTAS_PUBLICAS}/${o.slug}`} data-testid="link-ver-marketplace">Ver en marketplace</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {o.sourceType === 'PREPURCHASED_SUPPLY' && (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Asignadas" value={<span data-testid="oferta-asignadas">{(a?.allocatedQuantity ?? 0).toLocaleString('es-DO')}</span>} sub={`de ${o.quantityLimit.toLocaleString('es-DO')} destinadas`} />
        <StatCard label="Disponibles en la oferta" value={<span data-testid="oferta-disponibles">{o.disponibles.toLocaleString('es-DO')}</span>} accent="brand" />
        <StatCard label="Reservadas" value={<span data-testid="oferta-reservadas">{(a?.reservedQuantity ?? 0).toLocaleString('es-DO')}</span>} sub="checkouts en curso" />
        <StatCard label="Vendidas" value={<span data-testid="oferta-vendidas">{(a?.issuedQuantity ?? 0).toLocaleString('es-DO')}</span>} sub={`${o._count.entitlements} derechos emitidos`} accent="success" />
      </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Precio</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Dato label="Precio público">{dinero(precio.publicPrice)}</Dato>
            <Dato label="Precio Membego"><span className="text-h4">{dinero(precio.salePrice)}</span></Dato>
            <Dato label="Ahorro del cliente">{dinero(precio.discount)} ({precio.discountPercentage} %)</Dato>
            {o.comision ? (
              <>
                <Dato label="Comisión / unidad">{dinero(Math.round(Number(precio.salePrice) * Number(o.comision.commissionPercentage)) / 100)}</Dato>
                <Dato label="Neto del proveedor / unidad">{dinero(Number(precio.salePrice) - Math.round(Number(precio.salePrice) * Number(o.comision.commissionPercentage)) / 100)}</Dato>
              </>
            ) : (
              <>
                <Dato label="Costo estimado / unidad">{o.costoEstimado != null ? dinero(o.costoEstimado) : '—'}</Dato>
                <Dato label="Margen estimado / unidad">{o.costoEstimado != null ? dinero(Number(precio.salePrice) - o.costoEstimado) : '—'}</Dato>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Reglas y vigencia</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Dato label="Vigencia">{formatDate(o.startsAt)}{o.endsAt ? ` → ${formatDate(o.endsAt)}` : ' → sin fin'}</Dato>
            <Dato label="Máximo por persona">{o.perCustomerLimit}</Dato>
            <Dato label="Creada por">{o.createdBy.name ?? o.createdBy.email} · {formatDateTime(o.createdAt)}</Dato>
            {o.publishedAt && <Dato label="Publicada">{o.publishedBy?.name ?? o.publishedBy?.email ?? '—'} · {formatDateTime(o.publishedAt)}</Dato>}
            {o.description && <Dato label="Descripción">{o.description}</Dato>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Lotes que la financian</CardTitle></CardHeader>
          <CardContent>
            {o.sourceType === 'COMMISSION' ? (
              <p className="text-sm text-muted-foreground" data-testid="oferta-sin-lotes">Ninguno: a comisión el inventario es del proveedor.</p>
            ) : !a || a.lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía sin supply apartado.</p>
            ) : (
              <ul className="space-y-1 text-sm" data-testid="oferta-lotes">
                {a.lines.map((l) => (
                  <li key={l.id} className="flex items-baseline justify-between gap-3">
                    <Link href={`/superadmin/supply/supply/lotes/${l.lot.id}`} className="font-medium underline-offset-4 hover:underline">{l.lot.code}</Link>
                    <span className="text-right text-caption text-muted-foreground tabular-nums">
                      {l.quantity} asignadas · {l.issuedQuantity} vendidas · {l.reservedQuantity} reservadas · costo {dinero(l.lot.unitCost)}
                      {l.lot.expiresAt ? ` · vence ${formatDate(l.lot.expiresAt)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Ventas recientes</CardTitle></CardHeader>
        <CardContent>
          {o.orderLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nadie ha comprado todavía.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="oferta-ventas">
              {o.orderLines.map((l) => (
                <li key={l.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    <span className="font-medium">{l.order.number}</span> · {l.order.customer.name ?? l.order.customer.email} · {l.quantity} × {dinero(l.saleUnitPrice)}
                    <span className="block text-caption text-muted-foreground">{formatDateTime(l.order.createdAt)}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums">{dinero(l.order.total)}</span>
                    <ChipCompra estado={l.order.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Ledger relacionado</CardTitle></CardHeader>
        <CardContent>
          {o.ledger.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="oferta-sin-ledger">{o.sourceType === 'COMMISSION' ? 'Sin movimientos: una venta a comisión nunca escribe en el ledger de lotes.' : 'Sin movimientos.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="oferta-ledger">
                <thead className="text-left text-caption text-muted-foreground">
                  <tr><th className="py-1 pr-3">Tipo</th><th className="py-1 pr-3">Lote</th><th className="py-1 pr-3">Movimiento</th><th className="py-1 pr-3 text-right">Cantidad</th><th className="py-1 pr-3">Usuario</th><th className="py-1">Fecha</th></tr>
                </thead>
                <tbody>
                  {o.ledger.map((e) => (
                    <tr key={e.id} className="border-t border-border">
                      <td className="py-2 pr-3 font-medium">{e.type}</td>
                      <td className="py-2 pr-3">{e.lot.code}</td>
                      <td className="py-2 pr-3 text-caption text-muted-foreground">{e.sourceBucket ?? 'fuera'} → {e.destinationBucket ?? 'fuera'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{e.quantity.toLocaleString('es-DO')}</td>
                      <td className="py-2 pr-3">{e.actor?.name ?? e.actor?.email ?? 'sistema'}</td>
                      <td className="py-2">{formatDateTime(e.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
