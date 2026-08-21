import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarDays, Clock, Users, Ticket } from 'lucide-react'
import { getUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { reservasCliente } from '@/modules/excursiones/reservas/queries'
import { formatMoney, formatDate } from '@/lib/format'
import { ESTADO_RESERVA_LABEL, TONO_RESERVA } from '@/modules/excursiones/reservas/nucleo'

const TONO_CLASE: Record<string, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-info/10 text-info',
  neutral: 'bg-muted text-muted-foreground',
  danger: 'bg-destructive/10 text-destructive',
}

export default async function MisExcursionesPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  // Obtener TODAS las fichas de cliente del usuario (en todas las empresas)
  const clienteIds = await prisma.cliente.findMany({
    where: { supabaseId: user.supabaseId },
    select: { id: true, companyId: true },
  })
  if (clienteIds.length === 0) redirect('/cliente/explorar')

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
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-h2 font-bold">Mis excursiones</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {reservas.length} reserva{reservas.length !== 1 ? 's' : ''} en total
          </p>
        </div>

        {reservas.length === 0 ? (
          <div className="rounded-xl border bg-card p-12 text-center shadow-sm">
            <Ticket className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <h2 className="text-h3 font-semibold">Sin reservas todavía</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Cuando reserves una excursión, aparecerá aquí.
            </p>
            <Link
              href="/cliente/explorar"
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              Explorar excursiones
            </Link>
          </div>
        ) : (
          <>
            {proximas.length > 0 && (
              <section aria-labelledby="proximas-heading" className="mb-10">
                <h2 id="proximas-heading" className="text-h3 font-bold">
                  Próximas ({proximas.length})
                </h2>
                <div className="mt-4 space-y-3">
                  {proximas.map((r) => (
                    <ReservaCard key={r.id} reserva={r} ahora={ahora} />
                  ))}
                </div>
              </section>
            )}

            {pasadas.length > 0 && (
              <section aria-labelledby="pasadas-heading">
                <h2 id="pasadas-heading" className="text-h3 font-bold">
                  Pasadas ({pasadas.length})
                </h2>
                <div className="mt-4 space-y-3">
                  {pasadas.map((r) => (
                    <ReservaCard key={r.id} reserva={r} ahora={ahora} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
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
      href={`/cliente/excursiones/${reserva.id}`}
      className="group flex items-center gap-4 rounded-xl border bg-card p-4 shadow-sm transition hover:shadow-md hover:border-primary/50"
    >
      <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
        {reserva.excursion.portadaUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={reserva.excursion.portadaUrl}
            alt={reserva.excursion.nombre}
            className="h-full w-full object-cover transition group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}
        {esPasada && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <span className="rounded-full bg-background/80 px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Finalizada
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold truncate">{reserva.excursion.nombre}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">Reserva: {reserva.numero}</p>
          </div>
          <span
            className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONO_CLASE[tono] ?? TONO_CLASE.neutral}`}
          >
            {ESTADO_RESERVA_LABEL[reserva.estado as keyof typeof ESTADO_RESERVA_LABEL] ?? reserva.estado}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" />
            {formatDate(reserva.fecha, { moneda: reserva.moneda })}
          </span>
          {reserva.hora && (
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {reserva.hora}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {reserva.adultos} adulto{reserva.adultos !== 1 ? 's' : ''}
            {reserva.ninos > 0 && `, ${reserva.ninos} niño${reserva.ninos !== 1 ? 's' : ''}`}
          </span>
        </div>

        <p className="mt-2 text-sm font-semibold text-primary">
          {formatMoney(reserva.total, { moneda: reserva.moneda })}
        </p>
      </div>

      <div className="flex-shrink-0 text-muted-foreground/50">
        <span className="text-xs">Ver detalle</span>
      </div>
    </Link>
  )
}