import Link from 'next/link'
import { redirect } from 'next/navigation'
import Image from 'next/image'
import { CalendarDays, Clock, Users, Ticket, Compass, ChevronRight } from 'lucide-react'
import { getUser } from '@/lib/auth'
import { sinEmpresa } from '@/lib/tenant'
import { reservasCliente } from '@/modules/excursiones/reservas/queries'
import { formatMoney, formatDate } from '@/lib/format'
import { ESTADO_RESERVA_LABEL, TONO_RESERVA } from '@/modules/excursiones/reservas/nucleo'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

const TONO_CLASE: Record<string, string> = {
  success: 'bg-success/15 text-success dark:bg-success/20',
  warning: 'bg-warning/15 text-warning dark:bg-warning/20',
  info: 'bg-info/15 text-info dark:bg-info/20',
  neutral: 'bg-muted text-muted-foreground',
  danger: 'bg-destructive/15 text-destructive dark:bg-destructive/20',
}

export default async function MisExcursionesPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  // Obtener TODAS las fichas de cliente del usuario (en todas las empresas).
  //
  // Va con `sinEmpresa` porque la pregunta ES cross-tenant: un cliente puede
  // tener ficha en varias empresas y esta pantalla las reúne. El aislamiento
  // no se pierde — lo impone el filtro por `supabaseId`, que es la identidad
  // del usuario autenticado, y las lecturas de reservas van después empresa
  // por empresa con `reservasCliente(companyId, clienteId)`.
  const clienteIds = await sinEmpresa('cliente: mis fichas en todas las empresas', (tx) =>
    tx.cliente.findMany({
      where: { supabaseId: user.supabaseId },
      select: { id: true, companyId: true },
    })
  )
  if (clienteIds.length === 0) redirect('/cliente/excursiones')

  // Consultar reservas en TODAS las empresas donde tiene ficha
  const allReservas = await Promise.all(
    clienteIds.map((c) => reservasCliente(c.companyId, c.id))
  )
  const reservas = allReservas.flat().sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
  const ahora = new Date()

  const proximas = reservas.filter((r) => new Date(r.fecha) >= ahora)
  const pasadas = reservas.filter((r) => new Date(r.fecha) < ahora)

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-4 sm:py-8 space-y-6 sm:space-y-8">
        <PageHeader
          eyebrow="Actividad"
          title="Mis excursiones"
          description={`${reservas.length} reserva${reservas.length !== 1 ? 's' : ''} registrada${reservas.length !== 1 ? 's' : ''}. Accede a tus pases y códigos QR de embarque.`}
          action={
            <Button asChild variant="outline" size="sm" className="w-full sm:w-auto h-10 text-xs sm:text-sm font-semibold">
              <Link href="/cliente/excursiones">
                <Compass aria-hidden className="mr-1.5 h-4 w-4" />
                Explorar excursiones
              </Link>
            </Button>
          }
        />

        <div>
          {reservas.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-8 sm:p-12 text-center shadow-sm">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Ticket className="h-7 w-7" />
              </div>
              <h2 className="text-lg sm:text-xl font-bold text-foreground">Sin reservas todavía</h2>
              <p className="mt-2 text-xs sm:text-sm text-muted-foreground max-w-md mx-auto">
                Cuando reserves una excursión o tour, tus pases y tickets de embarque con código QR aparecerán aquí.
              </p>
              <Link
                href="/cliente/excursiones"
                className="mt-6 inline-flex w-full sm:w-auto items-center justify-center rounded-xl bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90 active:scale-[0.99]"
              >
                Explorar excursiones disponibles
              </Link>
            </div>
          ) : (
            <div className="space-y-8 sm:space-y-10">
              {proximas.length > 0 && (
                <section aria-labelledby="proximas-heading">
                  <div className="flex items-center justify-between mb-3.5 sm:mb-4">
                    <h2 id="proximas-heading" className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
                      <span className="flex h-2.5 w-2.5 rounded-full bg-success animate-pulse" />
                      Próximas salidas ({proximas.length})
                    </h2>
                  </div>
                  <div className="space-y-3">
                    {proximas.map((r) => (
                      <ReservaCard key={r.id} reserva={r} ahora={ahora} />
                    ))}
                  </div>
                </section>
              )}

              {pasadas.length > 0 && (
                <section aria-labelledby="pasadas-heading">
                  <div className="flex items-center justify-between mb-3.5 sm:mb-4">
                    <h2 id="pasadas-heading" className="text-base sm:text-lg font-bold text-muted-foreground">
                      Historial de pasadas ({pasadas.length})
                    </h2>
                  </div>
                  <div className="space-y-3">
                    {pasadas.map((r) => (
                      <ReservaCard key={r.id} reserva={r} ahora={ahora} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ReservaCard({
  reserva,
  ahora,
}: {
  reserva: {
    id: string
    numero: string
    estado: string
    fecha: Date
    hora: string | null
    adultos: number
    ninos: number
    total: number
    moneda: string
    excursion: { id: string; nombre: string; slug: string; portadaUrl: string | null }
  }
  ahora: Date
}) {
  const esPasada = new Date(reserva.fecha) < ahora
  const tono = TONO_RESERVA[reserva.estado as keyof typeof TONO_RESERVA] ?? 'neutral'

  return (
    <Link
      href={`/cliente/mis-excursiones/${reserva.id}`}
      className="group relative flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5 sm:gap-4 rounded-2xl border border-border bg-card p-3.5 sm:p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md active:scale-[0.99]"
    >
      {/* Thumbnail + status overlay */}
      <div className="relative h-32 sm:h-24 sm:w-28 w-full flex-shrink-0 overflow-hidden rounded-xl bg-muted">
        {reserva.excursion.portadaUrl ? (
          <Image
            src={reserva.excursion.portadaUrl}
            alt={reserva.excursion.nombre}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, 120px"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-primary/5">
            <CalendarDays className="h-8 w-8 text-primary/40" />
          </div>
        )}
        {esPasada && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px] flex items-center justify-center">
            <span className="rounded-full bg-background/90 px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
              Finalizada
            </span>
          </div>
        )}
      </div>

      {/* Info Container */}
      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-bold text-sm sm:text-base text-foreground group-hover:text-primary transition-colors line-clamp-1">
              {reserva.excursion.nombre}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">Reserva: <span className="font-mono font-semibold">{reserva.numero}</span></p>
          </div>
          <span
            className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-[11px] sm:text-xs font-bold ${TONO_CLASE[tono] ?? TONO_CLASE.neutral}`}
          >
            {ESTADO_RESERVA_LABEL[reserva.estado as keyof typeof ESTADO_RESERVA_LABEL] ?? reserva.estado}
          </span>
        </div>

        {/* Metadata row */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-medium">
            <CalendarDays className="h-3.5 w-3.5 text-primary" />
            {formatDate(reserva.fecha, { moneda: reserva.moneda })}
          </span>
          {reserva.hora && (
            <span className="inline-flex items-center gap-1 font-medium">
              <Clock className="h-3.5 w-3.5 text-primary" />
              {reserva.hora}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {reserva.adultos} ad.{reserva.ninos > 0 ? `, ${reserva.ninos} niñ.` : ''}
          </span>
        </div>

        {/* Price and Action row */}
        <div className="mt-2.5 pt-2 border-t border-border/50 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-muted-foreground block">Total pagado</span>
            <p className="text-sm sm:text-base font-bold text-foreground tabular-nums">
              {formatMoney(reserva.total, { moneda: reserva.moneda })}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary group-hover:translate-x-0.5 transition-transform">
            Ver pase / QR <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </Link>
  )
}
