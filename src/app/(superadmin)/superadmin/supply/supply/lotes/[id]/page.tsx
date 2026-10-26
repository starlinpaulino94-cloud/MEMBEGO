import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { TablaLedgerLote } from '@/components/supply-v2/tablas-detalle'
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
            <TablaLedgerLote movimientos={lote.ledgerEntries} />
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
