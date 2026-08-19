import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, CalendarDays, Clock, MapPin, Users, CreditCard } from 'lucide-react'
import { getUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { reservaCliente } from '@/modules/excursiones/reservas/queries'
import { formatMoney, formatDate } from '@/lib/format'
import { ESTADO_RESERVA_LABEL, TONO_RESERVA } from '@/modules/excursiones/reservas/nucleo'

interface ReservaDetallePageProps {
  params: Promise<{ reservaId: string }>
}

const TONO_CLASE: Record<string, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-info/10 text-info',
  neutral: 'bg-muted text-muted-foreground',
  danger: 'bg-destructive/10 text-destructive',
}

export default async function ReservaDetallePage({ params }: ReservaDetallePageProps) {
  const { reservaId } = await params

  const user = await getUser()
  if (!user) redirect('/login')

  // Resolver companyId del usuario
  const cliente = await prisma.cliente.findFirst({
    where: { supabaseId: user.supabaseId },
    select: { id: true, companyId: true },
  })
  if (!cliente) redirect('/cliente/explorar')

  const data = await reservaCliente(cliente.companyId, cliente.id, reservaId)
  if (!data) redirect('/cliente/explorar')

  const { reserva, excursion, saldo } = data
  const moneda = excursion?.moneda ?? 'DOP'
  const tono = TONO_RESERVA[reserva.estado as keyof typeof TONO_RESERVA] ?? 'neutral'

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-4 px-4 py-4">
          <Link
            href="/cliente/explorar"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Explorar
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* Card principal */}
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {/* Header de la reserva */}
          <div className="border-b bg-muted/30 p-6 text-center">
            <p className="text-sm text-muted-foreground">Reserva</p>
            <h1 className="mt-1 text-h2 font-bold tracking-tight">
              {reserva.numero}
            </h1>
            <span
              className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-semibold ${TONO_CLASE[tono] ?? TONO_CLASE.neutral}`}
            >
              {ESTADO_RESERVA_LABEL[reserva.estado as keyof typeof ESTADO_RESERVA_LABEL] ?? reserva.estado}
            </span>
          </div>

          {/* Detalles */}
          <div className="space-y-4 p-6">
            {excursion && (
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <MapPin className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold">{excursion.nombre}</p>
                  {excursion.puntoSalida && (
                    <p className="text-sm text-muted-foreground">
                      Punto de salida: {excursion.puntoSalida}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <CalendarDays className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Fecha</p>
                  <p className="font-medium">
                    {formatDate(reserva.fecha, { moneda })}
                  </p>
                </div>
              </div>

              {reserva.hora && (
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <Clock className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Hora</p>
                    <p className="font-medium">{reserva.hora}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Pasajeros</p>
                <p className="font-medium">
                  {reserva.adultos} adulto{reserva.adultos !== 1 ? 's' : ''}
                  {reserva.ninos > 0 &&
                    `, ${reserva.ninos} niño${reserva.ninos !== 1 ? 's' : ''}`}
                </p>
              </div>
            </div>

            {/* Pasajeros detalle */}
            {reserva.pasajeros.length > 0 && (
              <div className="ml-13">
                <p className="mb-1 text-xs text-muted-foreground">Detalle:</p>
                <div className="flex flex-wrap gap-1.5">
                  {reserva.pasajeros.map((p, i) => (
                    <span
                      key={p.id}
                      className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs"
                    >
                      {p.tipo === 'ADULTO' ? 'A' : 'N'}{i + 1}
                      {p.presente && ' ✓'}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Totales */}
          <div className="border-t bg-muted/30 p-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Subtotal</span>
                <span>{formatMoney(Number(reserva.subtotal), { moneda })}</span>
              </div>
              {Number(reserva.descuento) > 0 && (
                <div className="flex justify-between text-sm text-success">
                  <span>Descuento</span>
                  <span>-{formatMoney(Number(reserva.descuento), { moneda })}</span>
                </div>
              )}
              {Number(reserva.impuestos) > 0 && (
                <div className="flex justify-between text-sm">
                  <span>Impuestos</span>
                  <span>{formatMoney(Number(reserva.impuestos), { moneda })}</span>
                </div>
              )}
              <div className="flex justify-between border-t pt-2 text-lg font-bold">
                <span>Total</span>
                <span>{formatMoney(Number(reserva.total), { moneda })}</span>
              </div>
            </div>

            {/* Saldo */}
            {!saldo.liquidada && (
              <div className="mt-4 rounded-lg bg-warning/10 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-warning">
                  <CreditCard className="h-4 w-4" />
                  Saldo pendiente: {formatMoney(saldo.saldo, { moneda })}
                </div>
                <p className="mt-1 text-xs text-warning/80">
                  Puedes gestionar tu pago desde tu perfil.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* CTA */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/cliente/explorar"
            className="flex-1 rounded-lg border bg-card py-3 text-center text-sm font-semibold transition hover:bg-muted"
          >
            Seguir explorando
          </Link>
          {saldo.liquidada && (
            <Link
              href={`/empresas/${excursion?.slug ?? ''}/excursiones`}
              className="flex-1 rounded-lg bg-primary py-3 text-center text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              Reservar otra excursión
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
