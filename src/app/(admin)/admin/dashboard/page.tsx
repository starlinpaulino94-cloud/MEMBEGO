import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ADMIN_ROLES, FULL_ADMIN_ROLES } from '@/types'
import {
  Users,
  UserPlus,
  CheckCircle2,
  Clock,
  CalendarCheck,
  Wallet,
  Gift,
  Heart,
  Lightbulb,
  Activity,
  ArrowRight,
  Eye,
  UserX,
  Share2,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { adminMetrics } from '@/modules/admin/queries'
import { getDashboardEjecutivo, type DashboardEjecutivo } from '@/modules/admin/dashboardQueries'
import { getOnboardingEmpresa } from '@/modules/empresas/onboarding'
import { OnboardingChecklist } from '@/components/admin/OnboardingChecklist'
import { prisma } from '@/lib/prisma'
import { formatMoney } from '@/lib/format'
import { StatCard } from '@/components/ui/stat-card'
import { AnimatedCounter } from '@/components/system/AnimatedCounter'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

const fmt = (n: number) => new Intl.NumberFormat('es-DO').format(n)

const ACCION_LABEL: Record<string, string> = {
  VISITA_CONFIRMADA: 'Visita confirmada',
  PAGO_APROBADO: 'Pago aprobado',
  PAGO_RECHAZADO: 'Pago rechazado',
  MEMBRESIA_CANCELADA: 'Membresía cancelada',
  MEMBRESIA_RENOVADA: 'Membresía renovada',
  QR_GENERADO: 'QR generado',
  QR_USADO: 'QR usado',
  COMPROBANTE_IMPRESO: 'Comprobante impreso',
  REFERIDO_COMPLETADO: 'Referido completado',
  RECOMPENSA_OTORGADA: 'Recompensa otorgada',
  NOTA_INTERNA: 'Nota interna',
}

function fmtHora(d: Date) {
  return new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(d))
}

export default async function AdminDashboard() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId

  // Superadmin sin empresa: mantiene la vista simple previa.
  if (!companyId) {
    const metrics = await adminMetrics(user).catch(() => ({
      totalClientes: 0,
      activas: 0,
      pendientes: 0,
      visitasHoy: 0,
    }))
    return (
      <div className="space-y-8 animate-fade-up">
        <h1 className="text-2xl font-bold tracking-tight">Todas las empresas</h1>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Clientes" value={<AnimatedCounter value={metrics.totalClientes} />} icon={Users} accent="sky" />
          <StatCard label="Membresías activas" value={<AnimatedCounter value={metrics.activas} />} icon={CheckCircle2} accent="green" />
          <StatCard label="Pagos pendientes" value={<AnimatedCounter value={metrics.pendientes} />} icon={Clock} accent="amber" />
          <StatCard label="Visitas hoy" value={<AnimatedCounter value={metrics.visitasHoy} />} icon={CalendarCheck} accent="indigo" />
        </div>
      </div>
    )
  }

  // Onboarding PRIMERO: mientras la empresa no esté publicada, el asistente es
  // su "home" (evita caer al panel vacío). Se resuelve antes de cargar el
  // dashboard pesado (17 queries) para no desperdiciarlas cuando se va a
  // redirigir igual. Los roles acotados (Marketing/Supervisor) NO hacen
  // onboarding. El redirect va fuera del try para no tragar el NEXT_REDIRECT.
  const onboarding = await getOnboardingEmpresa(companyId).catch(() => null)
  if (
    onboarding &&
    !onboarding.publicado &&
    FULL_ADMIN_ROLES.includes(user.metadata.role)
  ) {
    redirect('/onboarding')
  }

  let d: DashboardEjecutivo | null = null
  let company: { name: string; moneda: string; idioma: string } | null = null
  try {
    ;[d, company] = await Promise.all([
      getDashboardEjecutivo(companyId),
      prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true, moneda: true, idioma: true },
      }),
    ])
  } catch (e) {
    console.error('[admin-dashboard]', e)
  }
  const companyName = company?.name ?? ''

  if (!d) {
    return (
      <p className="text-muted-foreground">
        No pudimos cargar el panel en este momento. Intenta de nuevo.
      </p>
    )
  }

  const maxVisitas = Math.max(1, ...d.visitasPorDia.map((v) => v.total))

  return (
    <div className="space-y-8 animate-fade-up">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-overline">Centro de control</p>
          <h1 className="text-h1 mt-1 text-foreground">{companyName}</h1>
        </div>
        <p className="hidden text-sm text-muted-foreground sm:block">
          {new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'long' }).format(new Date())}
        </p>
      </div>

      {/* Onboarding (F5.1): guía hasta publicar el perfil */}
      {onboarding && <OnboardingChecklist onboarding={onboarding} />}

      {/* Acciones rápidas: lo que el equipo hace a diario, a un clic */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { href: '/admin/scanner', label: 'Escanear QR', icon: CalendarCheck },
          { href: '/admin/promociones/nuevo', label: 'Nueva promoción', icon: Gift },
          {
            href: '/admin/pagos',
            label: 'Validar pagos',
            icon: Wallet,
            badge: d.pagosPendientes > 0 ? d.pagosPendientes : undefined,
          },
          { href: '/admin/notificaciones', label: 'Enviar notificación', icon: Share2 },
        ].map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="card-interactive group relative flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 transition-colors group-hover:bg-primary group-hover:text-primary-foreground dark:text-primary">
              <a.icon className="h-5 w-5" />
            </span>
            <span className="text-sm font-medium text-foreground">{a.label}</span>
            {a.badge !== undefined && (
              <span className="absolute right-3 top-3 flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-[11px] font-bold text-white">
                {a.badge}
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* Clientes y membresías */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Clientes activos"
          value={<AnimatedCounter value={d.membresiasActivas} />}
          icon={CheckCircle2}
          accent="green"
          sub={`${fmt(d.clientesTotal)} clientes en total`}
        />
        <StatCard
          label="Clientes nuevos"
          value={<AnimatedCounter value={d.clientesNuevos30d} />}
          icon={UserPlus}
          accent="sky"
          sub="Últimos 30 días"
        />
        <StatCard
          label="Por vencer"
          value={<AnimatedCounter value={d.porVencer7d} />}
          icon={Clock}
          accent="amber"
          sub="Próximos 7 días"
        />
        <StatCard
          label="Ingresos estimados"
          value={formatMoney(d.ingresosEstimadosMes, company)}
          icon={Wallet}
          accent="violet"
          sub="Membresías activas / mes"
        />
      </div>

      {/* Comunidad y actividad */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Seguidores"
          value={<AnimatedCounter value={d.seguidores} />}
          icon={Heart}
          accent="red"
          sub={`+${d.nuevosSeguidores30d} este mes`}
        />
        <StatCard
          label="Promociones activas"
          value={<AnimatedCounter value={d.promosActivas} />}
          icon={Gift}
          accent="amber"
        />
        <StatCard
          label="Referidos completados"
          value={<AnimatedCounter value={d.referidosCompletados} />}
          icon={Share2}
          accent="indigo"
        />
        <StatCard
          label="Visitas"
          value={<AnimatedCounter value={d.visitasHoy} />}
          icon={CalendarCheck}
          accent="sky"
          sub={`${fmt(d.visitasMes)} este mes`}
        />
      </div>

      {/* Recomendaciones (BI) */}
      {d.recomendaciones.length > 0 && (
        <Card className="border-info/30 bg-info/10/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-info">
              <Lightbulb className="h-5 w-5 text-primary" />
              Recomendaciones para hoy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {d.recomendaciones.map((r) => (
              <div
                key={r.texto}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-card p-3 text-sm shadow-sm"
              >
                <p className="text-foreground">{r.texto}</p>
                <Link href={r.href}>
                  <Button size="sm" variant="outline" className="gap-1.5">
                    {r.cta} <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Visitas últimos 14 días */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Visitas — últimos 14 días
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-32 items-end gap-1.5">
              {d.visitasPorDia.map((v, idx) => (
                <div
                  key={v.fecha}
                  className="animate-grow-y group relative flex-1 rounded-t-md bg-gradient-to-t from-emerald-500 to-emerald-300 opacity-70 transition-opacity hover:opacity-100"
                  style={{
                    height: `${Math.max(4, (v.total / maxVisitas) * 100)}%`,
                    animationDelay: `${idx * 35}ms`,
                  }}
                  title={`${v.fecha}: ${v.total} visita(s)`}
                />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground/70">
              <span>{d.visitasPorDia[0]?.fecha.slice(5)}</span>
              <span>{d.visitasPorDia.at(-1)?.fecha.slice(5)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Top promociones */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gift className="h-4 w-4 text-muted-foreground" />
              Promociones más exitosas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {d.topPromos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aún sin datos. Publica promociones y aparecerán aquí sus
                métricas.
              </p>
            ) : (
              <ul className="space-y-3">
                {d.topPromos.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {p.titulo}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Eye className="h-3.5 w-3.5" /> {fmt(p.vistas)}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Heart className="h-3.5 w-3.5" /> {p.guardadas}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Alertas */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Alertas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            {/* Cada alerta lleva directo al módulo donde se resuelve. */}
            <Link
              href="/admin/pagos"
              className="flex items-center justify-between rounded-xl bg-warning/10 p-3 transition-colors hover:bg-warning/20"
            >
              <span className="flex items-center gap-2 font-medium text-warning-foreground">
                <Clock className="h-4 w-4 text-warning" /> Pagos por validar
              </span>
              <span className="inline-flex items-center gap-1 font-bold text-warning-foreground">
                {d.pagosPendientes} <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
            <Link
              href="/admin/membresias"
              className="flex items-center justify-between rounded-xl bg-destructive/10 p-3 transition-colors hover:bg-destructive/15"
            >
              <span className="flex items-center gap-2 font-medium text-destructive">
                <Clock className="h-4 w-4" /> Membresías por vencer (7 días)
              </span>
              <span className="inline-flex items-center gap-1 font-bold text-destructive">
                {d.porVencer7d} <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
            <Link
              href="/admin/clientes"
              className="flex items-center justify-between rounded-xl bg-muted p-3 transition-colors hover:bg-muted/70"
            >
              <span className="flex items-center gap-2 font-medium text-foreground">
                <UserX className="h-4 w-4 text-muted-foreground" /> Clientes en riesgo (30 días sin visitas)
              </span>
              <span className="inline-flex items-center gap-1 font-bold text-foreground">
                {d.clientesEnRiesgo} <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          </CardContent>
        </Card>

        {/* Actividad reciente */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Actividad reciente
            </CardTitle>
          </CardHeader>
          <CardContent>
            {d.actividad.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin actividad registrada.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {d.actividad.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <p className="font-medium text-foreground">
                        {ACCION_LABEL[a.accion] ?? a.accion}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {a.autor ?? 'Sistema'} · {a.entidadTipo}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">{fmtHora(a.fecha)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
