import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipLote } from '@/components/supply-v2/chips'
import { fichaProductoSupply } from '@/modules/supply-v2/pool/queries'
import { UNIT_LABELS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'

/** MEMBEGO SUPPLY 2.0 · detalle de un producto en el pool (§38). */
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
          <Link href="/superadmin/supply-v2/supply" className="hover:underline">
            Supply
          </Link>
        }
        nav={<NavSupplyV2 activa="supply" />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Comprado total" value={item.resumen.compradoTotal.toLocaleString('es-DO')} sub="en órdenes aprobadas" />
        <StatCard label="Recibido" value={item.resumen.recibido.toLocaleString('es-DO')} />
        <StatCard label="Disponible" value={<span data-testid="producto-disponible">{item.resumen.disponible.toLocaleString('es-DO')}</span>} accent="brand" />
        <StatCard label="Valor adquirido" value={dinero(item.resumen.valorAdquirido, item.currency)} sub={`${dinero(item.resumen.valorDisponible, item.currency)} disponible`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lotes</CardTitle>
        </CardHeader>
        <CardContent>
          {item.lots.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no se ha recibido nada de este producto.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="tabla-lotes">
                <thead className="text-left text-caption text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Lote</th>
                    <th className="py-1 pr-3 text-right">Recibidas</th>
                    <th className="py-1 pr-3 text-right">Disponibles</th>
                    <th className="py-1 pr-3 text-right">Costo</th>
                    <th className="py-1 pr-3">Vence</th>
                    <th className="py-1 pr-3">Orden</th>
                    <th className="py-1">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {item.lots.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="py-2 pr-3 font-medium">
                        <Link href={`/superadmin/supply-v2/supply/lotes/${l.id}`} className="underline-offset-4 hover:underline">
                          {l.code}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{l.quantityReceived.toLocaleString('es-DO')}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{l.quantityAvailable.toLocaleString('es-DO')}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dinero(l.unitCost, l.currency)}</td>
                      <td className="py-2 pr-3">{l.expiresAt ? formatDate(l.expiresAt) : '—'}</td>
                      <td className="py-2 pr-3">
                        <Link href={`/superadmin/supply-v2/compras/${l.purchaseOrder.id}`} className="underline-offset-4 hover:underline">
                          {l.purchaseOrder.number}
                        </Link>
                        <span className="block text-caption text-muted-foreground">{l.receipt.number}</span>
                      </td>
                      <td className="py-2">
                        <ChipLote estado={l.status} />
                      </td>
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
