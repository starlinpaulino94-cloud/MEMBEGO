import Link from 'next/link'
import { redirect } from 'next/navigation'
import Image from 'next/image'
import { ArrowLeft, CalendarDays, Clock, MapPin, Users, CreditCard, Check, X, Shield, Compass } from 'lucide-react'
import { getUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { reservaCliente } from '@/modules/excursiones/reservas/queries'
import { formatMoney, formatDate } from '@/lib/format'
import { ESTADO_RESERVA_LABEL, TONO_RESERVA } from '@/modules/excursiones/reservas/nucleo'
import { ReservaCheckinQrDisplay } from '@/components/excursiones/ReservaCheckinQrDisplay'

export const dynamic = 'force-dynamic'

interface ReservaDetallePageProps {
  params: Promise<{ reservaId: string }>
}

const TONO_CLASE: Record<string, string> = {
  success: 'bg-success/15 text-success dark:bg-success/20',
  warning: 'bg-warning/15 text-warning dark:bg-warning/20',
  info: 'bg-info/15 text-info dark:bg-info/20',
  neutral: 'bg-muted text-muted-foreground',
  danger: 'bg-destructive/15 text-destructive dark:bg-destructive/20',
}

export default async function ReservaDetallePage({ params }: ReservaDetallePageProps) {
  const { reservaId } = await params

  const user = await getUser()
  if (!user) redirect('/login')

  // Obtener todas las empresas donde el usuario es cliente
  const clientes = await prisma.cliente.findMany({
    where: { supabaseId: user.supabaseId },
    select: { id: true, companyId: true },
  })
  if (clientes.length === 0) redirect('/cliente/excursiones')

  // Buscar la reserva en cada empresa del usuario
  let data: Awaited<ReturnType<typeof reservaCliente>> = null
  for (const c of clientes) {
    const found = await reservaCliente(c.companyId, c.id, reservaId)
    if (found) {
      data = found
      break
    }
  }

  if (!data) redirect('/cliente/mis-excursiones')

  const { reserva, excursion, saldo, checkinToken, checkinAt, checkinPorId } = data
  const moneda = excursion?.moneda ?? 'DOP'
  const tono = TONO_RESERVA[reserva.estado as keyof typeof TONO_RESERVA] ?? 'neutral'

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation */}
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 sm:px-6 py-3.5">
          <Link
            href="/cliente/mis-excursiones"
            className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Mis excursiones
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* QR de embarque */}
        <ReservaCheckinQrDisplay
          checkinToken={checkinToken}
          checkinAt={checkinAt}
          checkinPorId={checkinPorId}
          numero={reserva.numero}
        />

        {/* Card principal */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          {/* Header de la reserva */}
          <div className="border-b border-border bg-muted/20 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Número de Reserva</p>
                <h1 className="mt-0.5 text-lg sm:text-2xl font-mono font-bold tracking-tight text-foreground">
                  {reserva.numero}
                </h1>
              </div>
              <span
                className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-bold ${TONO_CLASE[tono] ?? TONO_CLASE.neutral}`}
              >
                {ESTADO_RESERVA_LABEL[reserva.estado as keyof typeof ESTADO_RESERVA_LABEL] ?? reserva.estado}
              </span>
            </div>
          </div>

          {/* Excursión - Detalle completo */}
          {excursion && (
            <div className="p-4 sm:p-6 border-b border-border space-y-4">
              <div className="flex items-start gap-3.5">
                <div className="flex-shrink-0 h-14 w-14 sm:h-16 sm:w-16 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  <Compass className="h-7 w-7 sm:h-8 sm:w-8" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base sm:text-xl font-bold text-foreground line-clamp-2">{excursion.nombre}</h2>
                  {excursion.categoria && (
                    <span className="mt-1 inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                      {excursion.categoria}
                    </span>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs sm:text-sm text-muted-foreground">
                    {excursion.duracionMin && (
                      <span className="flex items-center gap-1 font-medium">
                        <Clock className="h-3.5 w-3.5 text-primary" />
                        {excursion.duracionMin} min
                      </span>
                    )}
                    {excursion.ubicacion && (
                      <span className="flex items-center gap-1 font-medium">
                        <MapPin className="h-3.5 w-3.5 text-primary" />
                        <span className="truncate max-w-[200px]">{excursion.ubicacion}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Portada */}
              {excursion.portadaUrl && (
                <div className="relative aspect-[16/9] sm:aspect-video w-full overflow-hidden rounded-xl bg-muted">
                  <Image
                    src={excursion.portadaUrl}
                    alt={excursion.nombre}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, 720px"
                  />
                </div>
              )}

              {/* Descripción */}
              {excursion.descripcion && (
                <div className="pt-2">
                  <h3 className="font-bold text-xs sm:text-sm uppercase tracking-wider text-muted-foreground mb-1">Descripción</h3>
                  <p className="text-xs sm:text-sm text-foreground/80 whitespace-pre-line leading-relaxed">
                    {excursion.descripcion}
                  </p>
                </div>
              )}

              {/* Punto de salida y horarios */}
              <div className="grid gap-2.5 sm:grid-cols-2 pt-2">
                {excursion.puntoSalida && (
                  <div className="flex items-center gap-2.5 rounded-xl bg-muted/50 p-3">
                    <MapPin className="h-5 w-5 text-primary flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase font-bold text-muted-foreground">Punto de salida</p>
                      <p className="font-semibold text-xs sm:text-sm text-foreground truncate">{excursion.puntoSalida}</p>
                    </div>
                  </div>
                )}
                {excursion.horaSalida && (
                  <div className="flex items-center gap-2.5 rounded-xl bg-muted/50 p-3">
                    <Clock className="h-5 w-5 text-primary flex-shrink-0" />
                    <div>
                      <p className="text-[11px] uppercase font-bold text-muted-foreground">Hora de salida</p>
                      <p className="font-semibold text-xs sm:text-sm text-foreground">{excursion.horaSalida}</p>
                    </div>
                  </div>
                )}
                {excursion.horaRegreso && (
                  <div className="flex items-center gap-2.5 rounded-xl bg-muted/50 p-3">
                    <Clock className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <div>
                      <p className="text-[11px] uppercase font-bold text-muted-foreground">Regreso estimado</p>
                      <p className="font-semibold text-xs sm:text-sm text-foreground">{excursion.horaRegreso}</p>
                    </div>
                  </div>
                )}
                {excursion.duracionMin && (
                  <div className="flex items-center gap-2.5 rounded-xl bg-muted/50 p-3">
                    <CalendarDays className="h-5 w-5 text-primary flex-shrink-0" />
                    <div>
                      <p className="text-[11px] uppercase font-bold text-muted-foreground">Duración</p>
                      <p className="font-semibold text-xs sm:text-sm text-foreground">{excursion.duracionMin} min</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Incluye / No incluye */}
              {(excursion.incluye || excursion.noIncluye) && (
                <div className="grid gap-2.5 sm:grid-cols-2 pt-2">
                  {excursion.incluye && (
                    <div className="rounded-xl bg-success/10 p-3.5 border border-success/20">
                      <h4 className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-success">
                        <Check className="h-4 w-4" />
                        Incluye
                      </h4>
                      <p className="mt-1.5 text-xs sm:text-sm text-foreground/80 whitespace-pre-line">
                        {excursion.incluye}
                      </p>
                    </div>
                  )}
                  {excursion.noIncluye && (
                    <div className="rounded-xl bg-destructive/10 p-3.5 border border-destructive/20">
                      <h4 className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-destructive">
                        <X className="h-4 w-4" />
                        No incluye
                      </h4>
                      <p className="mt-1.5 text-xs sm:text-sm text-foreground/80 whitespace-pre-line">
                        {excursion.noIncluye}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Políticas */}
              {excursion.politicas && (
                <div className="rounded-xl bg-info/10 p-3.5 border border-info/20">
                  <h4 className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-info">
                    <Shield className="h-4 w-4" />
                    Políticas y recomendaciones
                  </h4>
                  <p className="mt-1.5 text-xs sm:text-sm text-foreground/80 whitespace-pre-line">
                    {excursion.politicas}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Detalles de la reserva */}
          <div className="space-y-4 p-4 sm:p-6">
            <h3 className="font-bold text-xs sm:text-sm uppercase tracking-wider text-muted-foreground">Detalles del Pasaje</h3>

            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40">
                <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-background text-primary">
                  <CalendarDays className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
                <div>
                  <p className="text-[11px] uppercase font-bold text-muted-foreground">Fecha</p>
                  <p className="font-semibold text-xs sm:text-sm">
                    {formatDate(reserva.fecha, { moneda })}
                  </p>
                </div>
              </div>

              {reserva.hora ? (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40">
                  <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-background text-primary">
                    <Clock className="h-4 w-4 sm:h-5 sm:w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] uppercase font-bold text-muted-foreground">Hora</p>
                    <p className="font-semibold text-xs sm:text-sm">{reserva.hora}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40">
                  <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-background text-primary">
                    <Users className="h-4 w-4 sm:h-5 sm:w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] uppercase font-bold text-muted-foreground">Pasajeros</p>
                    <p className="font-semibold text-xs sm:text-sm">{reserva.adultos + reserva.ninos} total</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40">
              <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-background text-primary">
                <Users className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
              <div>
                <p className="text-[11px] uppercase font-bold text-muted-foreground">Desglose de pasajeros</p>
                <p className="font-semibold text-xs sm:text-sm">
                  {reserva.adultos} adulto{reserva.adultos !== 1 ? 's' : ''}
                  {reserva.ninos > 0 && `, ${reserva.ninos} niño${reserva.ninos !== 1 ? 's' : ''}`}
                </p>
              </div>
            </div>

            {/* Pasajeros detalle */}
            {reserva.pasajeros.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Check-in de pasajeros:</p>
                <div className="flex flex-wrap gap-2">
                  {reserva.pasajeros.map((p, i) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold"
                    >
                      {p.tipo === 'ADULTO' ? 'Adulto' : 'Niño'} #{i + 1}
                      {p.presente && <span className="text-success font-bold">✓ Embarcado</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Resumen de pago */}
          <div className="border-t border-border bg-muted/20 p-4 sm:p-6 space-y-3">
            <h3 className="font-bold text-xs sm:text-sm uppercase tracking-wider text-muted-foreground mb-3">Resumen de Pago</h3>
            <div className="space-y-2 text-xs sm:text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-semibold">{formatMoney(Number(reserva.subtotal), { moneda })}</span>
              </div>
              {Number(reserva.descuento) > 0 && (
                <div className="flex justify-between text-success">
                  <span>Descuento aplicado</span>
                  <span className="font-semibold">-{formatMoney(Number(reserva.descuento), { moneda })}</span>
                </div>
              )}
              {Number(reserva.impuestos) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Impuestos incluidos</span>
                  <span className="font-semibold">{formatMoney(Number(reserva.impuestos), { moneda })}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border/60 pt-2 text-sm sm:text-base font-bold text-foreground">
                <span>Total</span>
                <span className="tabular-nums">{formatMoney(Number(reserva.total), { moneda })}</span>
              </div>
            </div>

            {/* Saldo pendiente */}
            {!saldo.liquidada && (
              <div className="mt-4 rounded-xl bg-warning/15 p-3.5 border border-warning/25 text-xs sm:text-sm">
                <div className="flex items-center gap-2 font-bold text-warning">
                  <CreditCard className="h-4 w-4" />
                  Saldo pendiente: {formatMoney(saldo.saldo, { moneda })}
                </div>
                <p className="mt-1 text-xs text-warning/90">
                  Puedes liquidar el saldo pendiente antes de abordar.
                </p>
              </div>
            )}

            {/* Pagos realizados */}
            {reserva.pagos && reserva.pagos.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border/40">
                <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground mb-2">Comprobantes de pago</h4>
                <div className="space-y-1.5">
                  {reserva.pagos.map((pago, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs sm:text-sm p-2.5 rounded-xl bg-background border border-border">
                      <span className="text-muted-foreground">
                        {formatDate(pago.createdAt, { moneda })}
                      </span>
                      <span className="font-bold text-success tabular-nums">
                        +{formatMoney(Number(pago.monto), { moneda })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* CTA Mobile-First */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Link
            href="/cliente/mis-excursiones"
            className="flex-1 rounded-xl border border-border bg-card py-3.5 text-center text-xs sm:text-sm font-bold transition hover:bg-muted active:scale-[0.99]"
          >
            Volver a mis excursiones
          </Link>
          <Link
            href="/cliente/excursiones"
            className="flex-1 rounded-xl bg-primary py-3.5 text-center text-xs sm:text-sm font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90 active:scale-[0.99]"
          >
            Explorar más excursiones
          </Link>
        </div>
      </div>
    </div>
  )
}
