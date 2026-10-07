import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate, formatDateTime, formatMoneyRD } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipLote } from '@/components/supply-v2/chips'
import { fichaLote } from '@/modules/supply-v2/pool/queries'

export const dynamic = 'force-dynamic'

/** MEMBEGO SUPPLY · detalle de un lote y su ledger (§39). */
export default async function LoteDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const lote = await fichaLote(id)
  if (!lote) notFound()
  const dinero = (n: { toString(): string }) => (lote.currency === 'DOP' ? formatMoneyRD(Number(n)) : `${lote.currency} ${Number(n).toLocaleString('es-DO')}`)

  return (
    <div className="space-y-6">
      <PageHeader
        title={lote.code}
        description={`${lote.catalogItem.name} · ${lote.supplier.commercialName}`}
        eyebrow={
          <Link href={`/superadmin/supply/supply/${lote.catalogItem.id}`} className="hover:underline">
            {lote.catalogItem.name}
          </Link>
        }
        nav={<NavSupplyV2 activa="supply" />}
        action={<ChipLote estado={lote.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Datos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Dato label="Producto">
              <Link href={`/superadmin/supply/supply/${lote.catalogItem.id}`} className="underline-offset-4 hover:underline">
                {lote.catalogItem.name}
              </Link>
            </Dato>
            <Dato label="Proveedor">
              <Link href={`/superadmin/supply/proveedores/${lote.supplier.id}`} className="underline-offset-4 hover:underline">
                {lote.supplier.commercialName}
              </Link>
            </Dato>
            <Dato label="Orden">
              <Link href={`/superadmin/supply/compras/${lote.purchaseOrder.id}`} className="underline-offset-4 hover:underline">
                {lote.purchaseOrder.number}
              </Link>
            </Dato>
            <Dato label="Recepción">
              {lote.receipt.number} · {formatDate(lote.receipt.receivedAt)}
            </Dato>
            <Dato label="Acuerdo">
              {lote.agreement.code} · v{lote.agreementVersion.version}
            </Dato>
            <Dato label="Cantidad recibida">
              <span data-testid="lote-recibido">{lote.quantityReceived.toLocaleString('es-DO')}</span>
            </Dato>
            <Dato label="Disponible">
              <span data-testid="lote-disponible">{lote.quantityAvailable.toLocaleString('es-DO')}</span>
            </Dato>
            <Dato label="Costo unitario">{dinero(lote.unitCost)}</Dato>
            <Dato label="Vencimiento">{lote.expiresAt ? formatDate(lote.expiresAt) : '—'}</Dato>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Ledger</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="tabla-ledger">
                <thead className="text-left text-caption text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Tipo</th>
                    <th className="py-1 pr-3">Movimiento</th>
                    <th className="py-1 pr-3 text-right">Cantidad</th>
                    <th className="py-1 pr-3 text-right">Disponible antes → después</th>
                    <th className="py-1 pr-3">Usuario</th>
                    <th className="py-1">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {lote.ledgerEntries.map((a) => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="py-2 pr-3 font-medium">{a.type}</td>
                      <td className="py-2 pr-3 text-caption text-muted-foreground">
                        {a.sourceBucket ?? 'fuera'} → {a.destinationBucket ?? 'fuera'}
                        {a.reason ? ` · ${a.reason}` : ''}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{a.destinationBucket === 'AVAILABLE' && !a.sourceBucket ? '+' : ''}{a.quantity.toLocaleString('es-DO')}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {a.balanceBefore.toLocaleString('es-DO')} → {a.balanceAfter.toLocaleString('es-DO')}
                      </td>
                      <td className="py-2 pr-3">{a.actor?.name ?? a.actor?.email ?? '—'}</td>
                      <td className="py-2">{formatDateTime(a.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
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
