import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, CalendarDays, Clock, MapPin, Users, CreditCard, Check, X, Info, Shield, Image as ImageIcon } from 'lucide-react'
import { getUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { reservaCliente } from '@/modules/excursiones/reservas/queries'
import { formatMoney, formatDate } from '@/lib/format'
import { ESTADO_RESERVA_LABEL, TONO_RESERVA } from '@/modules/excursiones/reservas/nucleo'
import { ReservaCheckinQrDisplay } from '@/components/excursiones/ReservaCheckinQrDisplay'

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

  // Obtener todas las empresas donde el usuario es cliente
  const clientes = await prisma.cliente.findMany({
    where: { supabaseId: user.supabaseId },
    select: { id: true, companyId: true },
  })
  if (clientes.length === 0) redirect('/cliente/explorar')

  // Buscar la reserva en cada empresa del usuario
  let data: Awaited<ReturnType<typeof reservaCliente>> = null
  for (const c of clientes) {
    const found = await reservaCliente(c.companyId, c.id, reservaId)
    if (found) {
      data = found
      break
    }
  }

  if (!data) redirect('/cliente/explorar')

  const { reserva, excursion, saldo, checkinToken, checkinAt, checkinPorId } = data
  const moneda = excursion?.moneda ?? 'DOP'
  const tono = TONO_RESERVA[reserva.estado as keyof typeof TONO_RESERVA] ?? 'neutral'

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-4">
          <Link
            href="/cliente/excursiones"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Mis excursiones
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        {/* QR de embarque */}
        <ReservaCheckinQrDisplay
          checkinToken={checkinToken}
          checkinAt={checkinAt}
          checkinPorId={checkinPorId}
          numero={reserva.numero}
        />
        {/* Card principal */}
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {/* Header de la reserva */}
          <div className="border-b bg-muted/30 p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Reserva</p>
                <h1 className="mt-1 text-h2 font-bold tracking-tight">
                  {reserva.numero}
                </h1>
              </div>
              <span
                className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${TONO_CLASE[tono] ?? TONO_CLASE.neutral}`}
              >
                {ESTADO_RESERVA_LABEL[reserva.estado as keyof typeof ESTADO_RESERVA_LABEL] ?? reserva.estado}
              </span>
            </div>
          </div>

          {/* Excursión - detalle completo */}
          {excursion && (
            <div className="p-6 border-b bg-muted/30">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center">
                  <MapPin className="h-8 w-8 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-h3 font-bold">{excursion.nombre}</h2>
                  {excursion.categoria && (
                    <span className="mt-1 inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {excursion.categoria}
                    </span>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    {excursion.duracionMin && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {excursion.duracionMin} min
                      </span>
                    )}
                    {excursion.ubicacion && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        {excursion.ubicacion}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Portada de la excursión */}
              {excursion.portadaUrl && (
                <div className="mt-4 relative aspect-video overflow-hidden rounded-xl">
                  <img
                    src={excursion.portadaUrl}
                    alt={excursion.nombre}
                    className="h-full w-full object-cover"
                  />
                </div>
              )}

              {/* Descripción */}
              {excursion.descripcion && (
                <div className="mt-4">
                  <h3 className="font-semibold text-sm">Descripción</h3>
                  <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line">
                    {excursion.descripcion}
                  </p>
                </div>
              )}

              {/* Punto de salida y horarios */}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {excursion.puntoSalida && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted p-3">
                    <MapPin className="h-5 w-5 text-primary flex-shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Punto de salida</p>
                      <p className="font-medium text-sm">{excursion.puntoSalida}</p>
                    </div>
                  </div>
                )}
                {excursion.horaSalida && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted p-3">
                    <Clock className="h-5 w-5 text-primary flex-shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Hora de salida</p>
                      <p className="font-medium text-sm">{excursion.horaSalida}</p>
                    </div>
                  </div>
                )}
                {excursion.horaRegreso && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted p-3">
                    <Clock className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Hora estimada de regreso</p>
                      <p className="font-medium text-sm">{excursion.horaRegreso}</p>
                    </div>
                  </div>
                )}
                {excursion.duracionMin && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted p-3">
                    <CalendarDays className="h-5 w-5 text-primary flex-shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Duración</p>
                      <p className="font-medium text-sm">{excursion.duracionMin} min</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Incluye / No incluye */}
              {(excursion.incluye || excursion.noIncluye) && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {excursion.incluye && (
                    <div className="rounded-lg bg-success/5 p-3">
                      <h4 className="flex items-center gap-1.5 text-sm font-semibold text-success">
                        <Check className="h-4 w-4" />
                        Incluye
                      </h4>
                      <p className="mt-2 text-sm text-muted-foreground whitespace-pre-line">
                        {excursion.incluye}
                      </p>
                    </div>
                  )}
                  {excursion.noIncluye && (
                    <div className="rounded-lg bg-destructive/5 p-3">
                      <h4 className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                        <X className="h-4 w-4" />
                        No incluye
                      </h4>
                      <p className="mt-2 text-sm text-muted-foreground whitespace-pre-line">
                        {excursion.noIncluye}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Políticas */}
              {excursion.politicas && (
                <div className="mt-4 rounded-lg bg-info/5 p-3">
                  <h4 className="flex items-center gap-1.5 text-sm font-semibold text-info">
                    <Shield className="h-4 w-4" />
                    Políticas y recomendaciones
                  </h4>
                  <p className="mt-2 text-sm text-muted-foreground whitespace-pre-line">
                    {excursion.politicas}
                  </p>
                </div>
              )}

              {/* Galería */}
              {excursion.galeria && Array.isArray(excursion.galeria) && excursion.galeria.length > 0 && (
                <div className="mt-4">
                  <h3 className="font-semibold text-sm">Galería</h3>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {excursion.galeria.slice(0, 6).map((img: unknown, idx: number) => (
                      typeof img === 'string' && img.length > 0 ? (
                        <div key={idx} className="aspect-square overflow-hidden rounded-lg bg-muted">
                          <img
                            src={img}
                            alt={`${excursion.nombre} ${idx + 1}`}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      ) : null
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Detalles de la reserva */}
          <div className="space-y-4 p-6">
            <h3 className="font-semibold">Detalles de tu reserva</h3>

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
            <h3 className="font-semibold mb-4">Resumen de pago</h3>
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

            {/* Pagos realizados */}
            {reserva.pagos && reserva.pagos.length > 0 && (
              <div className="mt-4">
                <h4 className="font-semibold text-sm mb-2">Pagos registrados</h4>
                <div className="space-y-2">
                  {reserva.pagos.map((pago, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm p-2 rounded-lg bg-muted">
                      <span className="text-muted-foreground">
                        {formatDate(pago.createdAt, { moneda })}
                      </span>
                      <span className="font-medium text-success">
                        +{formatMoney(Number(pago.monto), { moneda })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* CTA */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/cliente/excursiones"
            className="flex-1 rounded-lg border bg-card py-3 text-center text-sm font-semibold transition hover:bg-muted"
          >
            Ver mis excursiones
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