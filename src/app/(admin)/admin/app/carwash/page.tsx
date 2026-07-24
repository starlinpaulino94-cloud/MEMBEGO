import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { prisma } from '@/lib/prisma'
import { getCapacidadesEmpresa } from '@/modules/capacidades/resolver'
import { getDashboardOperativo } from '@/modules/carwash/dashboard'
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
  PackageSearch,
  ListOrdered,
  Camera,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

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

export const metadata = { title: 'Car Wash' }

interface Modulo {
  href: string | null // null = próximamente
  label: string
  descripcion: string
  icon: LucideIcon
}

/**
 * Plataforma modular · E2 — SHELL de la app Car Wash.
 *
 * El "sistema del negocio": identidad propia y SU menú de módulos operativos.
 * En E2 los módulos ENLAZAN a las pantallas actuales (regla D5: ninguna URL
 * se mueve); en E3 ganarán rutas propias con redirecciones y el dashboard
 * operativo real. Los módulos futuros (cola, inventario, evidencia) aparecen
 * como "próximamente" hasta que su capacidad se encienda (E4/E5).
 */
export default async function CarwashShellPage() {
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

  // E3: dashboard operativo del día (citas, canjes, ventas, recompensas).
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

  const modulos: Modulo[] = [
    { href: '/admin/scanner', label: 'Escanear QR', descripcion: 'Canjes y visitas en pista', icon: ScanLine },
    ...(activas.has('CITAS')
      ? [{ href: '/admin/citas', label: 'Citas', descripcion: 'Agenda y turnos del día', icon: CalendarDays } as Modulo]
      : []),
    ...(activas.has('SEGUIMIENTO')
      ? [{ href: '/admin/seguimiento', label: 'Seguimiento', descripcion: 'Lavados gratis: quién no ha venido', icon: QrCode } as Modulo]
      : []),
    { href: '/admin/app/carwash/vehiculos', label: 'Vehículos', descripcion: 'Busca por placa, marca o dueño', icon: Car },
    { href: '/admin/sucursales', label: 'Sucursales', descripcion: 'Puntos de servicio', icon: Building2 },
    ...(activas.has('POS_CAJA')
      ? [{ href: '/empleado/caja', label: 'Caja', descripcion: 'Cobros y órdenes del día', icon: Banknote } as Modulo]
      : []),
    // E5: construidos; visibles como "próximamente" hasta encender su capacidad.
    {
      href: activas.has('COLA_VEHICULOS') ? '/admin/app/carwash/cola' : null,
      label: 'Cola de vehículos',
      descripcion: 'Estado de cada vehículo en pista',
      icon: ListOrdered,
    },
    {
      href: activas.has('INVENTARIO') ? '/admin/app/carwash/inventario' : null,
      label: 'Inventario',
      descripcion: 'Productos, químicos y existencias',
      icon: PackageSearch,
    },
    {
      href: activas.has('EVIDENCIA_FOTOS') ? '/admin/app/carwash/evidencias' : null,
      label: 'Fotos antes/después',
      descripcion: 'Evidencia y control de daños',
      icon: Camera,
    },
  ]

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
              <Car className="h-7 w-7" />
            </span>
          )}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/70">
              Sistema del negocio
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Car Wash · {empresa?.name ?? ''}
            </h1>
          </div>
        </div>
      </div>

      {/* Dashboard operativo del día (E3) */}
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

      {/* Menú de la app */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modulos.map((m) => {
          const Icon = m.icon
          const contenido = (
            <>
              <span
                className="flex h-11 w-11 items-center justify-center rounded-xl text-white"
                style={{ backgroundColor: m.href ? color : '#94A3B8' }}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-bold text-foreground">
                  {m.label}
                  {!m.href && (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                      próximamente
                    </span>
                  )}
                </p>
                <p className="truncate text-sm text-muted-foreground">{m.descripcion}</p>
              </div>
            </>
          )
          return m.href ? (
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
        Los módulos marcados como &quot;próximamente&quot; se activarán desde el panel de
        capacidades cuando estén construidos.
      </p>
    </div>
  )
}
