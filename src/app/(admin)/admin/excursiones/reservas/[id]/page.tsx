import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Clock, MapPin } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { reservaDetalle } from '@/modules/excursiones/reservas/queries'
import { ventaDeReserva } from '@/modules/excursiones/comisiones/queries'
import {
  ESTADO_RESERVA_LABEL,
  TONO_RESERVA,
  type EstadoReserva,
  formatoMinutosAHora,
  minutosDesdeMedianoche,
} from '@/modules/excursiones/reservas/nucleo'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ReservaPagos } from '@/components/excursiones/ReservaPagos'
import { ReservaEstadoBotones } from '@/components/excursiones/ReservaEstadoBotones'
import { VentaAcciones } from '@/components/excursiones/VentaAcciones'
import { ReservaCheckinQr } from '@/components/excursiones/ReservaCheckinQr'
import { CheckinItemToggle } from '@/components/excursiones/CheckinItemToggle'
import { StatusChip } from '@/components/ui/status-chip'
import { formatDate, formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reserva' }

export default async function ReservaDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las reservas de excursiones" />

  const { id } = await params
  const detalle = await reservaDetalle(companyId, id)
  if (!detalle) notFound()
  const { reserva, saldo, cliente, excursion, vendedor } = detalle
  const venta = await ventaDeReserva(companyId, reserva.id)

  const moneda = reserva.moneda
  const estado = reserva.estado as EstadoReserva
  const dinero = (n: number | string) => formatMoney(n, { moneda }, 2)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/admin/excursiones/reservas"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Reservas
          </Link>
          <h2 className="mt-1 font-mono text-h2 text-foreground">{reserva.numero}</h2>
          <p className="text-sm text-muted-foreground">
            {cliente?.nombre ?? 'Cliente'}
            {cliente?.telefono ? ` · ${cliente.telefono}` : ''}
          </p>
        </div>
        <StatusChip tone={TONO_RESERVA[estado] ?? 'neutral'}>
          {ESTADO_RESERVA_LABEL[estado] ?? reserva.estado}
        </StatusChip>
      </div>

      <ReservaEstadoBotones reservaId={reserva.id} estado={estado} />

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-h3 text-foreground">La excursión</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-caption text-muted-foreground">Excursión</dt>
            <dd className="text-foreground">{excursion?.nombre ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Fecha de salida</dt>
            <dd className="text-foreground">
              {formatDate(reserva.fecha)}
              {reserva.hora ? ` · ${reserva.hora}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Pasajeros</dt>
            <dd className="text-foreground">
              {reserva.adultos} adulto{reserva.adultos === 1 ? '' : 's'}
              {reserva.ninos > 0 ? ` · ${reserva.ninos} niño${reserva.ninos === 1 ? '' : 's'}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Vendedor atribuido</dt>
            <dd className="text-foreground">
              {vendedor ? (
                <Link
                  href={`/admin/excursiones/vendedores/${vendedor.id}`}
                  className="hover:text-primary hover:underline"
                >
                  {vendedor.nombre} <span className="font-mono text-caption">{vendedor.codigo}</span>
                </Link>
              ) : (
                'Venta directa'
              )}
            </dd>
          </div>
        </dl>

        <dl className="mt-4 border-t border-border pt-3 text-sm">
          <div className="flex justify-between py-1">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-foreground">{dinero(String(reserva.subtotal))}</dd>
          </div>
          {Number(reserva.descuento) > 0 ? (
            <div className="flex justify-between py-1">
              <dt className="text-muted-foreground">Descuento</dt>
              <dd className="text-foreground">−{dinero(String(reserva.descuento))}</dd>
            </div>
          ) : null}
          {Number(reserva.impuestos) > 0 ? (
            <div className="flex justify-between py-1">
              <dt className="text-muted-foreground">Impuestos</dt>
              <dd className="text-foreground">{dinero(String(reserva.impuestos))}</dd>
            </div>
          ) : null}
          <div className="mt-1 flex justify-between border-t border-border pt-2">
            <dt className="font-semibold text-foreground">Total</dt>
            <dd className="text-h3 text-foreground">{dinero(String(reserva.total))}</dd>
          </div>
        </dl>

        {reserva.notas ? (
          <p className="mt-3 whitespace-pre-line rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
            {reserva.notas}
          </p>
        ) : null}
      </section>

      {/* Itinerario de actividades (para combos o paquetes multi-fecha/multi-turno) */}
      {reserva.items && reserva.items.length > 0 && (
        <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-bold text-foreground text-sm sm:text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Itinerario y Turnos Asignados
            </h3>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
              {reserva.items.length} Actividades
            </span>
          </div>

          <div className="space-y-2.5 pt-1">
            {reserva.items.map((item, idx) => {
              const act = item.actividad
              const esPd = act.tipoItem === 'PASE_DIA'
              const inicio = item.hora?.trim().slice(0, 5) || reserva.hora?.trim().slice(0, 5) || act.horaSalida?.trim().slice(0, 5) || '—'
              const durMin = act.duracionMin ?? 0
              const fin = (!esPd && inicio !== '—' && durMin > 0)
                ? formatoMinutosAHora(minutosDesdeMedianoche(inicio) + durMin)
                : (act.horaRegreso?.trim().slice(0, 5) || '—')
              const durTexto = durMin > 0
                ? (durMin >= 60 ? `${Math.floor(durMin / 60)}h ${durMin % 60 > 0 ? `${durMin % 60}m` : ''}`.trim() : `${durMin}m`)
                : null
              const fechaDistinta = formatDate(item.fecha) !== formatDate(reserva.fecha)

              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-card p-3.5 shadow-xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shrink-0 ${
                        esPd
                          ? 'bg-success/10 text-success'
                          : 'bg-primary text-primary-foreground'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs sm:text-sm font-bold text-foreground truncate">{act.nombre}</p>
                        {esPd && (
                          <span className="text-xs font-bold bg-success/10 text-success px-2 py-0.5 rounded-full border border-success/20 shrink-0">
                            Daypass
                          </span>
                        )}
                        {item.checkinAt && (
                          <span className="text-xs font-bold bg-success/15 text-success px-2 py-0.5 rounded-full shrink-0">
                            ✓ Embarcado
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        {fechaDistinta && (
                          <span className="font-bold text-primary">{formatDate(item.fecha)}</span>
                        )}
                        {act.ubicacion && (
                          <span className="truncate max-w-[200px] flex items-center gap-0.5">
                            <MapPin className="h-3 w-3 shrink-0" />
                            {act.ubicacion}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="font-mono text-xs font-semibold text-foreground text-right">
                      {esPd ? (
                        <span className="text-success font-medium">Acceso libre</span>
                      ) : inicio !== '—' ? (
                        <div className="space-y-0.5">
                          <div className="text-foreground">
                            {inicio} {fin !== '—' ? `→ ${fin}` : ''}
                          </div>
                          {durTexto && (
                            <div className="text-xs font-normal text-muted-foreground">
                              Duración: {durTexto}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Horario según turno</span>
                      )}
                    </div>

                    <CheckinItemToggle
                      reservaId={reserva.id}
                      itemId={item.id}
                      actividadNombre={act.nombre}
                      checkinAt={item.checkinAt}
                      estado={item.estado}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <ReservaPagos
        reservaId={reserva.id}
        moneda={moneda}
        total={Number(reserva.total)}
        pagado={saldo.pagado}
        saldo={saldo.saldo}
        admitePagos={estado !== 'CANCELADA'}
        pagos={reserva.pagos.map((p) => ({
          id: p.id,
          monto: String(p.monto),
          metodo: p.metodo,
          referencia: p.referencia,
          estado: p.estado,
          notas: p.notas,
          createdAt: p.createdAt,
        }))}
      />

      <ReservaCheckinQr
        reservaId={reserva.id}
        numero={reserva.numero}
        tokenInicial={reserva.checkinToken}
      />

      <VentaAcciones
        reservaId={reserva.id}
        saldo={saldo.saldo}
        venta={venta ? { id: venta.id, numero: venta.numero, estado: venta.estado } : null}
      />
    </div>
  )
}
