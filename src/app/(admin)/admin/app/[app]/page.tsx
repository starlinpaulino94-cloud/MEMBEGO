import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { prisma } from '@/lib/prisma'
import { getCapacidadesEmpresa } from '@/modules/capacidades/resolver'
import { appPorSlug, type IconoApp } from '@/modules/apps/catalogo'
import { getDashboardOperativo } from '@/modules/apps/dashboard'
import { hmEnTz } from '@/modules/citas/disponibilidad'
import { CitaEstadoBadge } from '@/components/citas/CitaEstadoBadge'
import {
  ArrowLeft,
  ScanLine,
  CalendarDays,
  QrCode,
  Building2,
  Banknote,
  Car,
  Scissors,
  Users,
  Sparkles,
  PackageSearch,
  ListOrdered,
  Camera,
  BarChart3,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Pista, PistaSinCatalogo } from '@/components/carwash/Pista'

/** Resuelve el nombre de icono del catálogo (dato puro) a su componente. */
const ICONOS: Record<IconoApp, LucideIcon> = {
  Car,
  Scissors,
  ScanLine,
  CalendarDays,
  QrCode,
  Building2,
  Banknote,
  PackageSearch,
  ListOrdered,
  Camera,
  Users,
  Sparkles,
  BarChart3,
}

function fmtRD(n: number) {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 0,
  }).format(n)
}

const TIPO_LABEL: Record<string, string> = {
  SALE: 'Venta',
  PROMOTION_USE: 'Canje',
  VISIT: 'Visita',
  BENEFIT_USE: 'Beneficio',
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ app: string }> }) {
  const { app } = await params
  return { title: appPorSlug(app)?.nombre ?? 'Aplicación' }
}

/**
 * Plataforma modular · E6 — SHELL GENÉRICO de una app de negocio.
 *
 * Una sola pantalla sirve a TODAS las categorías: la identidad, los módulos y
 * el vocabulario salen del catálogo (`modules/apps/catalogo.ts`), y el tablero
 * del día de motores compartidos. Antes de E6 esta pantalla estaba escrita a
 * mano para Car Wash; montar una categoría nueva ya no toca este archivo.
 */
export default async function AppShellPage({
  params,
}: {
  params: Promise<{ app: string }>
}) {
  const { app: slug } = await params
  const definicion = appPorSlug(slug)
  if (!definicion) notFound()

  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  if (!companyId) {
    return <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
  }

  const [empresa, capacidades] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, colorPrimario: true, logoUrl: true, zonaHoraria: true },
    }),
    getCapacidadesEmpresa(companyId).catch(() => null),
  ])
  const color = empresa?.colorPrimario || '#0D9488'
  const activas = new Set(capacidades?.activas ?? [])
  const tz = empresa?.zonaHoraria || 'America/Santo_Domingo'
  const IconApp = ICONOS[definicion.icon]

  // Tablero operativo del día (compartido por todas las apps).
  const dia = await getDashboardOperativo(companyId, tz)
  const kpis = [
    { label: 'Citas de hoy', valor: String(dia.citasActivas), href: '/admin/citas' },
    { label: 'Canjes de hoy', valor: String(dia.canjesHoy), href: '/admin/registros' },
    {
      label: 'Caja de hoy',
      valor: `${fmtRD(dia.ventasHoyMonto)} · ${dia.ventasHoyCount}`,
      href: '/admin/registros',
    },
    {
      label: 'Regalos sin usar',
      valor:
        dia.recompensasPorVencer > 0
          ? `${dia.recompensasSinUsar} (${dia.recompensasPorVencer} por vencer)`
          : String(dia.recompensasSinUsar),
      href: '/admin/seguimiento',
    },
  ]
  const proximasCitas = dia.citas
    .filter((c) => ['PENDIENTE', 'CONFIRMADA'].includes(c.estado))
    .slice(0, 6)

  // Fase 1 · Car Wash: la portada deja de ser un menú y pasa a ser la CABINA.
  // Solo esta app la tiene; el resto conserva el tablero genérico. Si la
  // migración 20260762 no está aplicada, `getEstadoPista` devuelve null y la
  // pantalla cae al tablero de siempre sin romperse.
  const esCarWash = definicion.slug === 'carwash'
  const [pista, catalogo] = esCarWash
    ? await Promise.all([
        (await import('@/modules/carwash/pista')).getEstadoPista(companyId, dia.inicioDia),
        (await import('@/modules/carwash/catalogo'))
          .getEstadoCatalogo(companyId)
          .catch(() => null),
      ])
    : [null, null]
  const faltanEnCatalogo = catalogo
    ? [
        catalogo.tipos === 0 && 'tipos de vehículo',
        catalogo.servicios === 0 && 'servicios',
        catalogo.bahias === 0 && 'bahías',
      ].filter((x): x is string => typeof x === 'string')
    : []

  // Módulos del catálogo filtrados por las capacidades encendidas.
  const modulos = definicion.modulos
    .filter((m) => !m.capacidad || activas.has(m.capacidad) || m.proximamente)
    .map((m) => ({
      ...m,
      disponible: !m.capacidad || activas.has(m.capacidad),
    }))

  return (
    <div className="space-y-6">
      {/* Cabecera con identidad de la app (no de MembeGo) */}
      <div
        className="rounded-3xl p-6 text-white shadow-premium"
        style={{ background: `linear-gradient(135deg, ${color} 0%, #0f172a 130%)` }}
      >
        <Link
          href="/admin/dashboard"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-white/85 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Volver a MembeGo
        </Link>
        <div className="mt-4 flex items-center gap-4">
          {empresa?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={empresa.logoUrl}
              alt=""
              className="h-14 w-14 rounded-2xl bg-white/10 object-cover"
            />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15">
              <IconApp className="h-7 w-7" />
            </span>
          )}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/70">
              Sistema del negocio
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight">
              {definicion.nombre} · {empresa?.name ?? ''}
            </h1>
          </div>
        </div>
      </div>

      {/* Car Wash · la CABINA reemplaza al tablero genérico: lo que pasa en
          pista AHORA, en vez de contadores de cierre a media jornada. */}
      {esCarWash && faltanEnCatalogo.length > 0 && (
        <PistaSinCatalogo faltan={faltanEnCatalogo} />
      )}
      {esCarWash && pista && <Pista estado={pista} />}

      {/* Tablero del día (resto de apps, o Car Wash sin migración aplicada) */}
      {!(esCarWash && pista) && (
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((k) => (
          <Link
            key={k.label}
            href={k.href}
            className="rounded-2xl border border-border/70 bg-card p-4 transition hover:border-foreground/30"
          >
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{k.label}</dt>
            <dd className="mt-1 truncate text-lg font-bold tabular-nums text-foreground">
              {k.valor}
            </dd>
          </Link>
        ))}
      </dl>
      )}

      {/* Citas y últimas operaciones: solo cuando no hay cabina de pista. */}
      {!(esCarWash && pista) && (
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Próximas citas de hoy */}
        <section className="rounded-2xl border border-border/70 bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            <CalendarDays className="h-4 w-4" /> Citas de hoy
          </h2>
          {proximasCitas.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay citas activas para hoy.</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {proximasCitas.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">
                      {hmEnTz(c.inicio, tz)} · {c.cliente.nombre}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.vehiculo ? `${c.vehiculo.marca} ${c.vehiculo.modelo}` : null}
                      {c.vehiculo && c.servicio ? ' · ' : null}
                      {c.servicio}
                    </p>
                  </div>
                  <CitaEstadoBadge estado={c.estado} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Últimas operaciones de hoy */}
        <section className="rounded-2xl border border-border/70 bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            <Banknote className="h-4 w-4" /> Últimas operaciones
          </h2>
          {dia.ultimas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay operaciones hoy.</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {dia.ultimas.map((op) => (
                <li key={op.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">
                      {TIPO_LABEL[op.tipo] ?? op.tipo}
                      {op.cliente ? ` · ${op.cliente}` : ''}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {hmEnTz(op.fecha, tz)}
                      {op.detalle ? ` · ${op.detalle}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
                    {op.monto != null && op.monto > 0 ? fmtRD(op.monto) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      )}

      {/* Menú de la app (del catálogo) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modulos.map((m) => {
          const Icon = ICONOS[m.icon]
          const contenido = (
            <>
              <span
                className="flex h-11 w-11 items-center justify-center rounded-xl text-white"
                style={{ backgroundColor: m.disponible ? color : '#94A3B8' }}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-bold text-foreground">
                  {m.label}
                  {!m.disponible && (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                      próximamente
                    </span>
                  )}
                </p>
                <p className="truncate text-sm text-muted-foreground">{m.descripcion}</p>
              </div>
            </>
          )
          return m.disponible ? (
            <Link
              key={m.label}
              href={m.href}
              className="flex items-center gap-4 rounded-2xl border border-border/70 bg-card p-5 shadow-card transition hover:-translate-y-0.5 hover:border-foreground/30"
            >
              {contenido}
            </Link>
          ) : (
            <div
              key={m.label}
              className="flex items-center gap-4 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-5 opacity-75"
            >
              {contenido}
            </div>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Los módulos marcados como &quot;próximamente&quot; se activan desde el panel de
        capacidades.
      </p>
    </div>
  )
}
