import { redirect } from 'next/navigation'
import { Ticket, Plus, Calendar as CalendarIcon, Users } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { vendedorDeUsuario, misReservas } from '@/modules/excursiones/panel/queries'
import {
  ESTADO_RESERVA_LABEL,
  TONO_RESERVA,
  type EstadoReserva,
} from '@/modules/excursiones/reservas/nucleo'
import { StatusChip } from '@/components/ui/status-chip'
import { EmptyState } from '@/components/system/EmptyState'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { formatDate, formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mis reservas · Panel Vendedor' }

export default async function MisReservasPage() {
  const user = await requireRole(['VENDEDOR'])
  const vendedor = user.metadata.dbUserId
    ? await vendedorDeUsuario(user.metadata.dbUserId)
    : null
  if (!vendedor) redirect('/login')

  const reservas = await misReservas(vendedor.companyId, vendedor.id)

  const header = (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border/60 pb-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          Mis Reservas
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          {reservas.length} reserva{reservas.length !== 1 ? 's' : ''} gestionada{reservas.length !== 1 ? 's' : ''} en tu cuenta de vendedor.
        </p>
      </div>
      <Button asChild className="w-full sm:w-auto h-10 font-bold shadow-sm">
        <Link href="/vendedor/reservas/nueva" className="flex items-center justify-center gap-1.5">
          <Plus className="h-4 w-4" />
          Nueva reserva
        </Link>
      </Button>
    </div>
  )

  if (reservas.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={Ticket}
          title="Todavía no tienes reservas registradas"
          description="Cuando un cliente que entró por tu enlace/QR reserve o cuando crees una reserva directa, aparecerá aquí con sus detalles y saldo."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {header}
      <div className="grid gap-3 sm:gap-4">
        {reservas.map((r) => (
          <article
            key={r.id}
            className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-sm transition-all hover:border-primary/40 hover:bg-muted/20"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-lg">
                    {r.numero}
                  </span>
                  <p className="font-bold text-base text-foreground truncate">{r.cliente}</p>
                </div>

                <p className="text-sm font-medium text-muted-foreground truncate">{r.excursion}</p>

                <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                  <span className="flex items-center gap-1">
                    <CalendarIcon className="h-3.5 w-3.5 text-primary" /> {formatDate(r.fecha)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" /> {r.pasajeros} pax
                  </span>
                </div>
              </div>

              <div className="flex sm:flex-col items-center sm:items-end justify-between border-t border-border/40 sm:border-t-0 pt-2.5 sm:pt-0">
                <div className="text-left sm:text-right">
                  <p className="font-mono text-lg font-bold text-foreground">
                    {formatMoney(r.total, { moneda: r.moneda }, 2)}
                  </p>
                  {r.saldo > 0 ? (
                    <p className="text-xs font-medium text-warning">
                      Saldo pendiente: {formatMoney(r.saldo, { moneda: r.moneda }, 2)}
                    </p>
                  ) : (
                    <p className="text-xs font-medium text-success">Totalmente saldada</p>
                  )}
                </div>
                <div className="mt-1.5">
                  <StatusChip tone={TONO_RESERVA[r.estado as EstadoReserva] ?? 'neutral'}>
                    {ESTADO_RESERVA_LABEL[r.estado as EstadoReserva] ?? r.estado}
                  </StatusChip>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
