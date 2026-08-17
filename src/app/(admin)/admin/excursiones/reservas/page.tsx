import Link from 'next/link'
import { Plus, CalendarCheck } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { listadoReservas } from '@/modules/excursiones/reservas/queries'
import {
  ESTADO_RESERVA_LABEL,
  TONO_RESERVA,
  type EstadoReserva,
} from '@/modules/excursiones/reservas/nucleo'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { StatusChip } from '@/components/ui/status-chip'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/system/EmptyState'
import { formatDate, formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reservas' }

export default async function ReservasPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las reservas de excursiones" />

  const reservas = await listadoReservas(companyId)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Cada reserva congela su precio y su vendedor al crearse: lo que se cobre después no
          cambia lo que ya se pactó.
        </p>
        <Button asChild>
          <Link href="/admin/excursiones/reservas/nueva">
            <Plus className="mr-1.5 h-4 w-4" /> Nueva reserva
          </Link>
        </Button>
      </div>

      {reservas.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="Todavía no hay reservas"
          description="Crea la primera reserva: elige el cliente, la excursión y la fecha. MembeGo calcula el total con los precios del catálogo y le pone su número."
          action={
            <Button asChild size="lg">
              <Link href="/admin/excursiones/reservas/nueva">Crear reserva</Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-caption uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Número</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Excursión</th>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Pax</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Saldo</th>
                <th className="px-4 py-3">Vendedor</th>
                <th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {reservas.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/excursiones/reservas/${r.id}`}
                      className="font-mono font-semibold text-foreground hover:text-primary hover:underline"
                    >
                      {r.numero}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-foreground">{r.cliente}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.excursion}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(r.fecha)}
                    {r.hora ? ` · ${r.hora}` : ''}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{r.pasajeros}</td>
                  <td className="px-4 py-3 text-foreground">
                    {formatMoney(r.total, { moneda: r.moneda }, 2)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.saldo > 0 ? formatMoney(r.saldo, { moneda: r.moneda }, 2) : '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{r.vendedor ?? 'Directa'}</td>
                  <td className="px-4 py-3">
                    <StatusChip tone={TONO_RESERVA[r.estado as EstadoReserva] ?? 'neutral'}>
                      {ESTADO_RESERVA_LABEL[r.estado as EstadoReserva] ?? r.estado}
                    </StatusChip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
