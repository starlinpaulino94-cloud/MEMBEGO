import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { formatDateTime } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipDeposito } from '@/components/supply-v2/finanzas/chips'
import { fichaDeposito } from '@/modules/supply-v2/finance/queries'
import { saldoDeMovimientos } from '@/modules/supply-v2/finance/domain'
import { DEPOSIT_MOVEMENT_LABELS, dineroSupplyV2, RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'

/** MEMBEGO SUPPLY 2.0 · ficha de un depósito (§12): el libro de movimientos que reconstruye el saldo. */
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="deposito-movimientos">
              <thead className="text-left text-caption text-muted-foreground"><tr><th className="py-1 pr-3">Fecha</th><th className="py-1 pr-3">Movimiento</th><th className="py-1 pr-3">Detalle</th><th className="py-1 pr-3 text-right">Monto</th><th className="py-1 text-right">Saldo después</th></tr></thead>
              <tbody>
                {d.movements.map((mv) => (
                  <tr key={mv.id} className="border-t border-border">
                    <td className="py-2 pr-3">{formatDateTime(mv.createdAt)}</td>
                    <td className="py-2 pr-3 font-medium">{DEPOSIT_MOVEMENT_LABELS[mv.type]}</td>
                    <td className="py-2 pr-3 text-caption text-muted-foreground">
                      {mv.application?.invoice && <Link href={`${RUTA_FINANZAS}/facturas/${mv.application.invoice.id}`} className="underline-offset-4 hover:underline">{mv.application.invoice.number}</Link>}
                      {mv.application?.obligation && <span>{mv.application.obligation.number}</span>}
                      {mv.reason ? ` ${mv.reason}` : ''}{mv.actor ? ` · ${mv.actor.name ?? mv.actor.email}` : ''}
                    </td>
                    <td className={`py-2 pr-3 text-right tabular-nums ${mv.amount.isNegative() ? 'text-destructive' : 'text-success'}`}>{mv.amount.isNegative() ? '−' : '+'}{dineroSupplyV2(mv.amount.abs(), m)}</td>
                    <td className="py-2 text-right tabular-nums">{dineroSupplyV2(mv.balanceAfter, m)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border"><tr><td className="py-2 pr-3 text-muted-foreground" colSpan={3}>Suma de movimientos</td><td className="py-2 pr-3 text-right font-medium tabular-nums" colSpan={2} data-testid="deposito-suma">{dineroSupplyV2(reconstruido, m)}</td></tr></tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
