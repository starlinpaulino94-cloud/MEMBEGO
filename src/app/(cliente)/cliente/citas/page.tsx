import Link from 'next/link'
import { conEmpresa, conEmpresaOTodas } from '@/lib/tenant'
import { ArrowLeft, CalendarDays, CalendarX2, Clock } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import {
  diasDeVentana,
  getAgendaConfig,
  getCitasCliente,
  getDisponibilidadDia,
} from '@/modules/citas/queries'
import { etiquetaDia, hmEnTz, ymdEnTz } from '@/modules/citas/disponibilidad'
import { ReservarCita } from '@/components/citas/ReservarCita'
import { CancelarCitaButton } from '@/components/citas/CancelarCitaButton'
import { CitaEstadoBadge } from '@/components/citas/CitaEstadoBadge'
import { EmptyState } from '@/components/system/EmptyState'
import { cn, safeInternalPath } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Mis citas',
  description: 'Reserva tu turno y gestiona tus citas',
}

const ACTIVAS = ['PENDIENTE', 'CONFIRMADA']

export default async function CitasClientePage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; compra?: string; retorno?: string }>
}) {
  const user = await requireRole('CLIENTE')
  const { fecha, compra, retorno: retornoParam } = await searchParams
  // Fase 4 · contexto de ubicación: quien agendó desde el mapa puede volver al
  // detalle de la empresa (sanitizado contra open redirect).
  const retorno = safeInternalPath(retornoParam, '/cliente/mis-promociones')
  const retornoParamQs = retornoParam ? `&retorno=${encodeURIComponent(retorno)}` : ''

  if (!user.metadata.clienteId) {
    return (
      <main className="container max-w-3xl py-8">
        <p className="text-muted-foreground">Tu cuenta no está completamente configurada.</p>
      </main>
    )
  }

  // El narrowing del `if (!user.metadata.clienteId)` de arriba NO sobrevive al
  // closure: dentro de la función vuelve a ser `string | null`. Se extrae aquí.
  const clienteId = user.metadata.clienteId
  const cliente = await conEmpresaOTodas(
    user.metadata.companyId,
    'citas del cliente: su ficha y sus vehículos son de su empresa activa',
    (tx) =>
      tx.cliente.findUnique({
        where: { id: clienteId },
        select: {
          id: true,
          companyId: true,
          vehiculos: { select: { id: true, marca: true, modelo: true }, orderBy: { createdAt: 'desc' } },
          company: { select: { name: true, zonaHoraria: true, idioma: true } },
        },
      })
  )
  if (!cliente) {
    return (
      <main className="container max-w-3xl py-8">
        <p className="text-muted-foreground">No se encontró tu información.</p>
      </main>
    )
  }

  const tz = cliente.company.zonaHoraria
  const idioma = cliente.company.idioma ?? 'es-DO'
  const [cfg, citas] = await Promise.all([
    getAgendaConfig(cliente.companyId),
    getCitasCliente(cliente.id),
  ])

  // Cita para canjear una recompensa gratis (?compra=): valida que sea suya
  // y esté disponible; al reservar, su QR queda habilitado.
  const compraCanje = compra
    ? await conEmpresa(cliente.companyId, (tx) =>
        tx.productoCompra.findFirst({
          where: {
            id: compra,
            clienteId: cliente.id,
            estado: 'ACTIVA',
            usosRestantes: { gt: 0 },
          },
          select: { id: true, promocion: { select: { titulo: true } } },
        })
      ).catch(() => null)
    : null
  const compraParam = compraCanje ? `&compra=${compraCanje.id}` : ''

  const ahora = new Date()
  const proximas = citas
    .filter((c) => ACTIVAS.includes(c.estado) && c.inicio >= ahora)
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime())
  const historial = citas.filter((c) => !proximas.includes(c)).slice(0, 10)

  // Días abiertos de la ventana de reserva; el seleccionado viene de la URL.
  const diasAbiertos = cfg?.activa
    ? diasDeVentana(cfg, tz).filter((d) => !d.etiquetaCerrado)
    : []
  const fechaSel =
    fecha && diasAbiertos.some((d) => d.ymd === fecha) ? fecha : (diasAbiertos[0]?.ymd ?? null)
  const disponibilidad =
    cfg?.activa && fechaSel
      ? await getDisponibilidadDia(cliente.companyId, cfg, fechaSel, tz)
      : null

  return (
    <main className="container max-w-3xl space-y-8 py-8">
      {retornoParam && (
        <Link
          href={retorno}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Volver
        </Link>
      )}
      <header className="animate-fade-up">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
          Citas · {cliente.company.name}
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground">
          Reserva tu turno
        </h1>
        <p className="mt-2 text-muted-foreground">
          Elige el día y la hora que te convengan; te esperamos sin filas.
        </p>
      </header>

      {compraCanje && (
        <div className="animate-fade-up rounded-2xl border border-success/30 bg-success/10 p-4">
          <p className="text-sm font-semibold text-foreground">
            🎁 Estás agendando tu {compraCanje.promocion?.titulo ?? 'recompensa'} GRATIS
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Elige el día y la hora en que vendrás. Al confirmar la cita, el QR de tu
            recompensa quedará habilitado para presentarlo ese día.
          </p>
        </div>
      )}

      {!cfg?.activa ? (
        <EmptyState
          icon={CalendarX2}
          title="Aún no hay citas en línea"
          description={`${cliente.company.name} todavía no activó las reservas desde la app. Vuelve pronto.`}
        />
      ) : diasAbiertos.length === 0 ? (
        <EmptyState
          icon={CalendarX2}
          title="Sin días disponibles"
          description="El negocio no tiene horarios abiertos en los próximos días."
        />
      ) : (
        <section className="animate-fade-up space-y-4">
          {/* Selector de día */}
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {diasAbiertos.map((d) => (
              <Link
                key={d.ymd}
                href={`/cliente/citas?fecha=${d.ymd}${compraParam}${retornoParamQs}`}
                aria-current={d.ymd === fechaSel ? 'date' : undefined}
                className={cn(
                  'shrink-0 rounded-xl border px-3.5 py-2 text-sm font-semibold capitalize transition',
                  d.ymd === fechaSel
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border/70 bg-card text-foreground hover:border-foreground/40'
                )}
              >
                {etiquetaDia(d.ymd, tz, idioma)}
              </Link>
            ))}
          </div>

          {/* Turnos del día */}
          {disponibilidad && fechaSel && (
            <ReservarCita
              fecha={fechaSel}
              etiquetaFecha={etiquetaDia(fechaSel, tz, idioma)}
              slots={disponibilidad.slots}
              vehiculos={cliente.vehiculos}
              limiteDiaAlcanzado={disponibilidad.limiteDiaAlcanzado}
              notas={cfg.notas}
              compraId={compraCanje?.id ?? null}
              compraTitulo={compraCanje?.promocion?.titulo ?? null}
            />
          )}
        </section>
      )}

      {/* Próximas citas */}
      {proximas.length > 0 && (
        <section className="animate-fade-up space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <CalendarDays className="h-5 w-5 text-primary" /> Próximas citas
          </h2>
          {proximas.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-card"
            >
              <div className="min-w-0">
                <p className="font-semibold capitalize text-foreground">
                  {etiquetaDia(ymdEnTz(c.inicio, tz), tz, idioma)} ·{' '}
                  {hmEnTz(c.inicio, tz)}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {c.vehiculo ? `${c.vehiculo.marca} ${c.vehiculo.modelo}` : null}
                  {c.vehiculo && c.servicio ? ' · ' : null}
                  {c.servicio}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <CitaEstadoBadge estado={c.estado} />
                <CancelarCitaButton citaId={c.id} />
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Historial */}
      {historial.length > 0 && (
        <section className="animate-fade-up">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Clock className="h-4 w-4" /> Historial
          </h2>
          <div className="divide-y divide-border/50 rounded-2xl border border-border/70 bg-card px-4">
            {historial.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <p className="capitalize text-foreground/80">
                  {etiquetaDia(ymdEnTz(c.inicio, tz), tz, idioma)} ·{' '}
                  {hmEnTz(c.inicio, tz)}
                </p>
                <CitaEstadoBadge estado={c.estado} />
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
