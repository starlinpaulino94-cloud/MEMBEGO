import { redirect } from 'next/navigation'
import { Ticket } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { vendedorDeUsuario, misReservas } from '@/modules/excursiones/panel/queries'
import {
  ESTADO_RESERVA_LABEL,
  TONO_RESERVA,
  type EstadoReserva,
} from '@/modules/excursiones/reservas/nucleo'
import { StatusChip } from '@/components/ui/status-chip'
import { EmptyState } from '@/components/system/EmptyState'
import { formatDate, formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mis reservas' }

export default async function MisReservasPage() {
  const user = await requireRole(['VENDEDOR'])
  const vendedor = user.metadata.dbUserId
    ? await vendedorDeUsuario(user.metadata.dbUserId)
    : null
  if (!vendedor) redirect('/login')

  const reservas = await misReservas(vendedor.companyId, vendedor.id)

  if (reservas.length === 0) {
    return (
      <EmptyState
        icon={Ticket}
        title="Todavía no tienes reservas"
        description="Cuando un cliente que entró por tu QR reserve una excursión, la verás aquí con su fecha y lo que falta por cobrar."
      />
    )
  }

  return (
    <div className="space-y-3">
      {reservas.map((r) => (
        <article key={r.id} className="rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-foreground">{r.cliente}</p>
              <p className="text-sm text-muted-foreground">{r.excursion}</p>
              <p className="text-caption text-muted-foreground">
                <span className="font-mono">{r.numero}</span> · {formatDate(r.fecha)} ·{' '}
                {r.pasajeros} pax
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-foreground">
                {formatMoney(r.total, { moneda: r.moneda }, 2)}
              </p>
              {r.saldo > 0 ? (
                <p className="text-caption text-muted-foreground">
                  Falta {formatMoney(r.saldo, { moneda: r.moneda }, 2)}
                </p>
              ) : null}
              <StatusChip tone={TONO_RESERVA[r.estado as EstadoReserva] ?? 'neutral'}>
                {ESTADO_RESERVA_LABEL[r.estado as EstadoReserva] ?? r.estado}
              </StatusChip>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}
