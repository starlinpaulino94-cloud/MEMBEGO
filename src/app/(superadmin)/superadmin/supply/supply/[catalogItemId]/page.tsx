import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoneyRD } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { TablaLotesDelProducto } from '@/components/supply-v2/tablas-detalle'
import { ChipLote, ChipOferta } from '@/components/supply-v2/chips'
import { Button } from '@/components/ui/button'
import { fichaProductoSupply } from '@/modules/supply-v2/pool/queries'
import { UNIT_LABELS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'

/** MEMBEGO SUPPLY · detalle de un producto en el pool (§38). */
export default async function SupplyProductoPage({ params }: { params: Promise<{ catalogItemId: string }> }) {
  await requireRole('SUPERADMIN')
  const { catalogItemId } = await params
  const item = await fichaProductoSupply(catalogItemId)
  if (!item) notFound()
  const dinero = (n: { toString(): string } | number, moneda: string) =>
    moneda === 'DOP' ? formatMoneyRD(Number(n)) : `${moneda} ${Number(n).toLocaleString('es-DO')}`

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.name}
        description={`${item.supplier.commercialName}${item.sku ? ` · ${item.sku}` : ''} · ${UNIT_LABELS[item.unit]}`}
        eyebrow={
          <Link href="/superadmin/supply/supply" className="hover:underline">
            Supply
          </Link>
        }
        nav={<NavSupplyV2 activa="supply" />}
        action={
          item.resumen.disponible > 0 ? (
            <Button asChild>
              <Link href={`/superadmin/supply/ofertas/nueva?producto=${item.id}`} data-testid="btn-crear-oferta-producto">Crear oferta</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Recibido" value={item.resumen.recibido.toLocaleString('es-DO')} sub={`${item.resumen.compradoTotal.toLocaleString('es-DO')} compradas en órdenes aprobadas`} />
        <StatCard label="Disponible" value={<span data-testid="producto-disponible">{item.resumen.disponible.toLocaleString('es-DO')}</span>} accent="brand" sub={`${dinero(item.resumen.valorDisponible, item.currency)} de valor`} />
        <StatCard label="Asignadas · Reservadas" value={<span><span data-testid="producto-asignadas">{item.resumen.asignadas.toLocaleString('es-DO')}</span> · <span data-testid="producto-reservadas">{item.resumen.reservadas.toLocaleString('es-DO')}</span></span>} sub="destinadas a ofertas · en checkout" />
        <StatCard label="Emitidas · Redimidas" value={<span><span data-testid="producto-emitidas">{item.resumen.emitidas.toLocaleString('es-DO')}</span> · <span data-testid="producto-redimidas">{item.resumen.redimidas.toLocaleString('es-DO')}</span></span>} sub={`vendidas sin entregar · entregadas · ${dinero(item.resumen.valorAdquirido, item.currency)} adquirido`} accent="success" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Ofertas</CardTitle></CardHeader>
          <CardContent>
            {item.offers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ninguna oferta con este producto todavía.</p>
            ) : (
              <ul className="divide-y divide-border text-sm" data-testid="producto-ofertas">
                {item.offers.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/superadmin/supply/ofertas/${o.id}`} className="font-medium underline-offset-4 hover:underline">
                      {o.title}
                      <span className="block font-mono text-caption text-muted-foreground">{o.code} · {dinero(o.salePrice, o.currency)}</span>
                    </Link>
                    <ChipOferta estado={o.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Asignaciones</CardTitle></CardHeader>
          <CardContent>
            {item.allocations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nada apartado todavía.</p>
            ) : (
              <ul className="divide-y divide-border text-sm" data-testid="producto-asignaciones">
                {item.allocations.map((a) => (
                  <li key={a.id} className="py-2">
                    <p className="font-medium">
                      {a.offer ? `Oferta ${a.offer.code}` : 'Manual'} · {a.allocatedQuantity.toLocaleString('es-DO')} unidades · {a.status}
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {a.reservedQuantity} reservadas · {a.issuedQuantity} emitidas · {a.releasedQuantity} liberadas · lotes: {a.lines.map((l) => `${l.lot.code} (${l.quantity})`).join(', ')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lotes</CardTitle>
        </CardHeader>
        <CardContent>
          {item.lots.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no se ha recibido nada de este producto.</p>
          ) : (
            <TablaLotesDelProducto formato={dinero} lotes={item.lots.map((l) => ({ ...l, status: <ChipLote estado={l.status} /> }))} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
