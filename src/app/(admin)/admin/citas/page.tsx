import Link from 'next/link'
import { CalendarDays, Search, Settings2, Users, X } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { prisma } from '@/lib/prisma'
import {
  getAgenda,
  getAgendaConfig,
  leerFiltrosAgenda,
  ESTADOS_CITA,
  RANGOS_AGENDA,
  RANGO_LABELS,
  type EstadoCita,
} from '@/modules/citas/queries'
import { etiquetaDia, hmEnTz, ymdEnTz } from '@/modules/citas/disponibilidad'
import { CitaAdminActions } from '@/components/citas/CitaAdminActions'
import { CitaEstadoBadge } from '@/components/citas/CitaEstadoBadge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Citas' }

const ESTADO_LABELS: Record<EstadoCita, string> = {
  PENDIENTE: 'Por confirmar',
  CONFIRMADA: 'Confirmadas',
  COMPLETADA: 'Completadas',
  CANCELADA: 'Canceladas',
  NO_ASISTIO: 'No asistió',
}

/** Construye una URL de la agenda conservando los filtros que no cambian. */
function urlAgenda(base: Record<string, string | number | null>, cambios: Record<string, string | number | null>) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...base, ...cambios })) {
    if (v !== null && v !== '' && v !== undefined) params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `/admin/citas?${qs}` : '/admin/citas'
}

/**
 * AGENDA DE LA EMPRESA — vista completa, no solo el día de hoy.
 *
 * Antes esta pantalla mostraba únicamente las citas de una fecha, así que para
 * saber "qué tengo esta semana" había que ir día por día. Ahora abre en
 * PRÓXIMAS (lo que el negocio necesita para prepararse) y desde ahí se filtra
 * por rango, estado y nombre/teléfono. Las citas se agrupan por día para que
 * la lista se lea como una agenda y no como un volcado de filas.
 */
export default async function CitasAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ rango?: string; estado?: string; q?: string; p?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const sp = await searchParams
  // Superadmin: trabaja sobre su empresa ACTIVA (igual que el resto del panel).
  const companyId = companyFilter(user) ?? user.metadata.companyId ?? null

  if (!companyId) {
    return <SinEmpresaActiva seccion="tu agenda de citas" />
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { zonaHoraria: true, idioma: true },
  })
  const tz = company?.zonaHoraria ?? 'America/Santo_Domingo'
  const idioma = company?.idioma ?? 'es-DO'

  const filtros = leerFiltrosAgenda(sp)
  const [cfg, agenda] = await Promise.all([
    getAgendaConfig(companyId),
    getAgenda(companyId, filtros, tz).catch(() => null),
  ])

  // Estado de los filtros para reconstruir enlaces sin perder el contexto.
  const base = { rango: filtros.rango, estado: filtros.estado, q: filtros.q || null }
  const hayFiltros = filtros.estado !== null || filtros.q !== ''

  // Agrupación por día: la agenda se lee por fechas, no como una tabla plana.
  const porDia = new Map<string, NonNullable<typeof agenda>['citas']>()
  for (const c of agenda?.citas ?? []) {
    const ymd = ymdEnTz(c.inicio, tz)
    if (!porDia.has(ymd)) porDia.set(ymd, [])
    porDia.get(ymd)!.push(c)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Citas"
          description="Toda tu agenda: próximas, pasadas y por confirmar."
        />
        <Button asChild variant="outline" className="gap-1.5">
          <Link href="/admin/citas/configuracion">
            <Settings2 className="h-4 w-4" /> Configurar agenda
          </Link>
        </Button>
      </div>

      {!cfg?.activa && (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-foreground">
          Tu agenda está <b>apagada</b>: los clientes no pueden reservar. Actívala en{' '}
          <Link href="/admin/citas/configuracion" className="font-semibold underline">
            configurar agenda
          </Link>
          .
        </div>
      )}

      {/* Rango temporal */}
      <div className="flex flex-wrap gap-2">
        {RANGOS_AGENDA.map((r) => (
          <Link
            key={r}
            href={urlAgenda(base, { rango: r, p: null })}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              filtros.rango === r
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'border border-border/70 text-muted-foreground hover:bg-muted/60'
            }`}
          >
            {RANGO_LABELS[r]}
          </Link>
        ))}
      </div>

      {/* Estado + búsqueda */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={urlAgenda(base, { estado: null, p: null })}
          className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide transition-colors ${
            filtros.estado === null
              ? 'bg-foreground text-background'
              : 'border border-border/70 text-muted-foreground hover:bg-muted/60'
          }`}
        >
          Todas {agenda ? `(${Object.values(agenda.porEstado).reduce((a, b) => a + b, 0)})` : ''}
        </Link>
        {ESTADOS_CITA.map((e) => (
          <Link
            key={e}
            href={urlAgenda(base, { estado: e, p: null })}
            className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide transition-colors ${
              filtros.estado === e
                ? 'bg-foreground text-background'
                : 'border border-border/70 text-muted-foreground hover:bg-muted/60'
            }`}
          >
            {ESTADO_LABELS[e]} {agenda ? `(${agenda.porEstado[e]})` : ''}
          </Link>
        ))}

        <form action="/admin/citas" method="get" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="rango" value={filtros.rango} />
          {filtros.estado && <input type="hidden" name="estado" value={filtros.estado} />}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              name="q"
              defaultValue={filtros.q}
              placeholder="Nombre o teléfono"
              className="h-9 w-52 rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Buscar
          </Button>
        </form>
      </div>

      {hayFiltros && (
        <Link
          href={urlAgenda({}, { rango: filtros.rango })}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" /> Quitar filtros
        </Link>
      )}

      {/* Resultados */}
      {agenda === null ? (
        <p className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          No se pudo cargar la agenda. Recarga la página; si sigue igual, revisa que la
          migración de citas esté aplicada.
        </p>
      ) : agenda.citas.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          <CalendarDays className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
          {hayFiltros
            ? 'Ninguna cita coincide con estos filtros.'
            : `Sin citas en «${RANGO_LABELS[filtros.rango].toLowerCase()}».`}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {agenda.total} cita{agenda.total !== 1 ? 's' : ''}
            {agenda.totalPaginas > 1 && ` · página ${agenda.pagina} de ${agenda.totalPaginas}`}
          </p>

          <div className="space-y-6">
            {[...porDia.entries()].map(([ymd, delDia]) => (
              <section key={ymd} className="space-y-3">
                <h2 className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1.5 text-sm font-bold text-foreground backdrop-blur">
                  {etiquetaDia(ymd, idioma, tz)}
                  <span className="ml-2 font-normal text-muted-foreground">
                    · {delDia.length} cita{delDia.length !== 1 ? 's' : ''}
                  </span>
                </h2>

                {delDia.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-2xl border border-border/70 bg-card p-4 shadow-card"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span className="rounded-xl bg-muted/70 px-3 py-2 text-sm font-bold tabular-nums text-foreground">
                          {hmEnTz(c.inicio, tz)}
                        </span>
                        <div className="min-w-0">
                          <Link
                            href={`/admin/clientes/${c.cliente.id}`}
                            className="flex items-center gap-1.5 font-semibold text-foreground hover:underline"
                          >
                            <Users className="h-4 w-4 text-muted-foreground" />
                            {c.cliente.nombre}
                          </Link>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {c.cliente.telefono && <span>{c.cliente.telefono} · </span>}
                            {c.vehiculo && (
                              <span>
                                {c.vehiculo.marca} {c.vehiculo.modelo} {c.vehiculo.color} ·{' '}
                              </span>
                            )}
                            {c.servicio ?? 'Sin detalle'}
                          </p>
                          {c.sucursal?.nombre && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {c.sucursal.nombre}
                            </p>
                          )}
                          {c.estado === 'CANCELADA' && c.motivoCancelacion && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Motivo: {c.motivoCancelacion} (
                              {c.canceladaPor === 'CLIENTE' ? 'cliente' : 'negocio'})
                            </p>
                          )}
                          {c.estado === 'COMPLETADA' && c.atendidaPor?.name && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Atendida por {c.atendidaPor.name}
                            </p>
                          )}
                        </div>
                      </div>
                      <CitaEstadoBadge estado={c.estado} />
                    </div>
                    <div className="mt-3 border-t border-border/50 pt-3 empty:hidden">
                      <CitaAdminActions
                        citaId={c.id}
                        estado={c.estado}
                        clienteNombre={c.cliente.nombre}
                      />
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>

          {agenda.totalPaginas > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button
                asChild
                variant="outline"
                size="sm"
                disabled={agenda.pagina <= 1}
                className={agenda.pagina <= 1 ? 'pointer-events-none opacity-50' : ''}
              >
                <Link href={urlAgenda(base, { p: agenda.pagina - 1 })}>Anterior</Link>
              </Button>
              <span className="text-sm text-muted-foreground">
                {agenda.pagina} / {agenda.totalPaginas}
              </span>
              <Button
                asChild
                variant="outline"
                size="sm"
                disabled={agenda.pagina >= agenda.totalPaginas}
                className={
                  agenda.pagina >= agenda.totalPaginas ? 'pointer-events-none opacity-50' : ''
                }
              >
                <Link href={urlAgenda(base, { p: agenda.pagina + 1 })}>Siguiente</Link>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
