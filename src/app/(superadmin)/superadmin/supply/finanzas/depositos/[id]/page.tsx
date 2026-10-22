import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { formatDateTime } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { TablaMovimientosDeposito } from '@/components/supply-v2/tablas-detalle'
import { ChipDeposito } from '@/components/supply-v2/finanzas/chips'
import { fichaDeposito } from '@/modules/supply-v2/finance/queries'
import { saldoDeMovimientos } from '@/modules/supply-v2/finance/domain'
import { DEPOSIT_MOVEMENT_LABELS, dineroSupplyV2, RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'

/** MEMBEGO SUPPLY · ficha de un depósito (§12): el libro de movimientos que reconstruye el saldo. */
export default async function DepositoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const d = await fichaDeposito(id)
  if (!d) notFound()
  const m = d.currency
  const reconstruido = saldoDeMovimientos(d.movements)
  const cuadra = reconstruido.equals(d.availableAmount)
  return (
    <div className="space-y-6">
      <PageHeader
        title={d.number}
        description={`${d.supplier.commercialName} · ${d.payment ? `financiado por ${d.payment.number}` : ''} · ${formatDateTime(d.createdAt)}`}
        eyebrow={<Link href={`${RUTA_FINANZAS}/depositos`} className="hover:underline">Depósitos</Link>}
        nav={<NavSupplyV2 activa="finanzas" />}
        action={<ChipDeposito estado={d.status} />}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Original" value={dineroSupplyV2(d.originalAmount, m)} />
        <StatCard label="Disponible" value={<span data-testid="deposito-disponible">{dineroSupplyV2(d.availableAmount, m)}</span>} accent="brand" sub={cuadra ? 'los movimientos reconstruyen este saldo' : 'ATENCIÓN: los movimientos no reconstruyen el saldo'} />
        <StatCard label="Aplicado" value={dineroSupplyV2(d.appliedAmount, m)} sub={`${d.applications.filter((a) => !a.reversedAt).length} aplicación(es) viva(s)`} />
      </div>
      <Card>
        <CardHeader><CardTitle>Movimientos</CardTitle></CardHeader>
        <CardContent>
          <TablaMovimientosDeposito movimientos={d.movements} moneda={m} etiquetas={DEPOSIT_MOVEMENT_LABELS} suma={reconstruido} rutaFacturas={`${RUTA_FINANZAS}/facturas`} />
        </CardContent>
      </Card>
    </div>
  )
}
