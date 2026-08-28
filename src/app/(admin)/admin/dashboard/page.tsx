import Link from 'next/link'
import { conEmpresaOTodas } from '@/lib/tenant'
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
import { formatMoney } from '@/lib/format'
import { StatCard } from '@/components/ui/stat-card'
import { AnimatedCounter } from '@/components/system/AnimatedCounter'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SectionHeader } from '@/components/ui/section-header'

export const dynamic = 'force-dynamic'

const fmt = (n: number) => new Intl.NumberFormat('es-DO').format(n)

const ACCION_LABEL: Record<string, string> = {
  VISITA_CONFIRMADA: 'Visita confirmada',
  VISITA_REVERTIDA: 'Visita revertida',
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
        <h1 className="text-h1">Todas las empresas</h1>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Clientes" value={<AnimatedCounter value={metrics.totalClientes} />} icon={Users} accent="brand" />
          <StatCard label="Membresías activas" value={<AnimatedCounter value={metrics.activas} />} icon={CheckCircle2} accent="success" />
          <StatCard label="Pagos pendientes" value={<AnimatedCounter value={metrics.pendientes} />} icon={Clock} accent="warning" />
          <StatCard label="Visitas hoy" value={<AnimatedCounter value={metrics.visitasHoy} />} icon={CalendarCheck} accent="brand" />
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
  let company: { name: string; moneda: string; idioma: string; zonaHoraria: string } | null = null
  try {
    // La empresa se lee ANTES: su zona horaria decide dónde empieza «hoy», y
    // las métricas no pueden calcularse sin ella (ver `dashboardQueries`).
    company = await conEmpresaOTodas(
      companyId,
      'dashboard: sin empresa activa es el superadmin, que cruza empresas a propósito',
      (tx) => tx.company.findUnique({
        where: { id: companyId },
        select: { name: true, moneda: true, idioma: true, zonaHoraria: true },
      })
    )
    d = await getDashboardEjecutivo(
      companyId,
      company?.zonaHoraria || 'America/Santo_Domingo'
    )
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

  /**
   * NIVEL 1 · Lo que requiere atención (§43).
   *
   * Solo entran los avisos con cuenta MAYOR QUE CERO. Antes se pintaban los
   * tres siempre, así que un panel sano mostraba "Pagos por validar 0" en
   * ámbar de forma permanente — y un aviso que está siempre encendido enseña
   * a no mirarlo. Cuando no hay nada pendiente, la sección lo dice y calla.
   */
  const atencion = [
    {
      href: '/admin/pagos',
      label: 'Pagos por validar',
      valor: d.pagosPendientes,
      icon: Wallet,
      tono: 'warning' as const,
    },
    // «Cada punto lleva a donde se resuelve» es la promesa de esta sección, y
    // durante mucho tiempo no se cumplió: los dos avisos de abajo llevaban a la
    // lista completa, sin filtrar, y el administrador tenía que volver a buscar
    // a mano a las personas que el panel acababa de identificar. Ahora llevan a
    // la MISMA lista ya acotada.
    {
      href: '/admin/riesgo?vence=7&sinVisitas=0',
      label: 'Membresías vencen en 7 días',
      valor: d.porVencer7d,
      icon: Clock,
      tono: 'danger' as const,
    },
    {
      href: '/admin/riesgo?sinVisitas=30&vence=0',
      label: 'Clientes sin visitas en 30 días',
      valor: d.clientesEnRiesgo,
      icon: UserX,
      tono: 'neutral' as const,
    },
  ].filter((a) => a.valor > 0)

  /**
   * NIVEL 2 · Estado del negocio (§44).
   *
   * CUATRO KPI arriba, no ocho. Antes había dos filas de cuatro tarjetas
   * idénticas: con todo al mismo peso visual, nada destaca y la vista se
   * vuelve un tablero de números que hay que leer entero para enterarse de
   * algo. Los que quedan responden a "¿cómo va el negocio?"; el resto son
   * cifras de referencia y bajan a una franja compacta.
   */
  const secundarias = [
    { label: 'Clientes en total', valor: fmt(d.clientesTotal) },
    // Lo que facturarían las membresías vigentes al renovar, a precio de
    // tarifa (con el precio de la categoría del vehículo cuando existe). Es una
    // proyección, así que vive aquí y no entre los KPI: no es dinero cobrado.
    { label: 'Recurrente esperado', valor: formatMoney(d.recurrenteEsperado, company) },
    { label: 'Seguidores', valor: `${fmt(d.seguidores)} (+${d.nuevosSeguidores30d} este mes)` },
    { label: 'Promociones activas', valor: fmt(d.promosActivas) },
    { label: 'Referidos completados', valor: fmt(d.referidosCompletados) },
    { label: 'Visitas este mes', valor: fmt(d.visitasMes) },
  ]

  return (
    <div className="space-y-10 animate-fade-up">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-overline">Centro de control</p>
          <h1 className="text-h1 mt-1 text-balance text-foreground">{companyName}</h1>
        </div>
        <p className="hidden text-small text-muted-foreground sm:block">
          {/* La fecha del encabezado es la del NEGOCIO, no una constante: si
              dijera otro día que el «hoy» de las visitas, el panel volvería a
              contradecirse a sí mismo. */}
          {new Intl.DateTimeFormat(company?.idioma || 'es-DO', {
            timeZone: company?.zonaHoraria || 'America/Santo_Domingo',
            dateStyle: 'long',
          }).format(new Date())}
        </p>
      </div>

      {/* Onboarding (F5.1): guía hasta publicar el perfil */}
      {onboarding && <OnboardingChecklist onboarding={onboarding} />}

      {/* ── NIVEL 1 · Requiere tu atención ─────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Requiere tu atención"
          description="Lo que no avanza solo. Cada punto lleva a donde se resuelve."
        />
        {atencion.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-small text-muted-foreground">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden />
            Todo al día: sin pagos por validar, sin membresías a punto de vencer
            y sin clientes inactivos.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {atencion.map((a) => (
              <li key={a.href}>
                <Link
                  href={a.href}
                  className={`card-interactive flex items-center gap-3 rounded-xl border p-4 ${
                    a.tono === 'danger'
                      ? 'border-destructive/40 bg-destructive/5'
                      : a.tono === 'warning'
                        ? 'border-warning/40 bg-warning/5'
                        : 'border-border bg-card'
                  }`}
                >
                  <a.icon
                    className={`h-5 w-5 shrink-0 ${
                      a.tono === 'danger'
                        ? 'text-destructive'
                        : a.tono === 'warning'
                          ? 'text-warning'
                          : 'text-muted-foreground'
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 text-small font-medium text-foreground">
                    {a.label}
                  </span>
                  <span className="shrink-0 text-h3 tabular-nums text-foreground">{a.valor}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── NIVEL 2 · Estado del negocio ───────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader title="Estado del negocio" />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Clientes activos"
            value={<AnimatedCounter value={d.membresiasActivas} />}
            icon={CheckCircle2}
            accent="success"
            sub="Con membresía vigente"
          />
          {/* «Ingresos estimados» mezclaba dos cosas que no son la misma: lo
              que entró y lo que se espera que entre. Aquí manda lo COBRADO —es
              el dato duro— y lo esperado baja a las cifras de referencia. */}
          <StatCard
            label="Cobrado este mes"
            value={formatMoney(d.ingresosCobradosMes, company)}
            icon={Wallet}
            accent="brand"
            sub="Membresías con pago confirmado"
          />
          <StatCard
            label="Visitas hoy"
            value={<AnimatedCounter value={d.visitasHoy} />}
            icon={CalendarCheck}
            accent="brand"
            sub={`${fmt(d.visitasMes)} este mes`}
          />
          <StatCard
            label="Clientes nuevos"
            value={<AnimatedCounter value={d.clientesNuevos30d} />}
            icon={UserPlus}
            accent="brand"
            sub="Últimos 30 días"
          />
        </div>

        {/* Cifras de referencia: consulta, no vigilancia. */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-3 lg:grid-cols-5">
          {secundarias.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className="truncate text-caption">{m.label}</dt>
              <dd className="mt-0.5 truncate text-h4 tabular-nums text-foreground">{m.valor}</dd>
            </div>
          ))}
        </dl>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Visitas últimos 14 días */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-h4">
                <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
                Visitas — últimos 14 días
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex h-32 items-end gap-1.5">
                {d.visitasPorDia.map((v, idx) => (
                  <div
                    key={v.fecha}
                    // Azul como serie principal (§55). Era un degradado
                    // esmeralda: el color de la marca vieja.
                    className="animate-grow-y group relative flex-1 rounded-t-lg bg-primary/70 transition-colors hover:bg-primary"
                    style={{
                      height: `${Math.max(4, (v.total / maxVisitas) * 100)}%`,
                      animationDelay: `${idx * 35}ms`,
                    }}
                    title={`${v.fecha}: ${v.total} visita(s)`}
                  />
                ))}
              </div>
              <div className="mt-2 flex justify-between text-caption">
                <span>{d.visitasPorDia[0]?.fecha.slice(5)}</span>
                <span>{d.visitasPorDia.at(-1)?.fecha.slice(5)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Top promociones */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-h4">
                <Gift className="h-4 w-4 text-muted-foreground" aria-hidden />
                Promociones más exitosas
              </CardTitle>
            </CardHeader>
            <CardContent>
              {d.topPromos.length === 0 ? (
                <p className="text-small text-muted-foreground">
                  Aún sin datos. Publica promociones y aparecerán aquí sus
                  métricas.
                </p>
              ) : (
                <ul className="space-y-3">
                  {d.topPromos.map((p, i) => (
                    <li key={p.id} className="flex items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-caption font-bold text-muted-foreground">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-small font-medium text-foreground">
                          {p.titulo}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-caption">
                        <Eye className="h-3.5 w-3.5" aria-hidden /> {fmt(p.vistas)}
                        <span className="sr-only">vistas</span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-caption">
                        <Heart className="h-3.5 w-3.5" aria-hidden /> {p.guardadas}
                        <span className="sr-only">guardadas</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── NIVEL 3 · Qué puedes hacer ─────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader
          title="Qué puedes hacer"
          description="Recomendaciones del sistema y los atajos del día a día."
        />

        {d.recomendaciones.length > 0 && (
          <ul className="space-y-2">
            {d.recomendaciones.map((r) => (
              <li
                key={r.texto}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
              >
                <p className="flex min-w-0 items-center gap-2.5 text-small text-foreground">
                  <Lightbulb className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                  {r.texto}
                </p>
                <Button asChild size="sm" variant="outline">
                  <Link href={r.href}>
                    {r.cta} <ArrowRight aria-hidden />
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { href: '/admin/scanner', label: 'Escanear QR', icon: CalendarCheck },
            { href: '/admin/promociones/nuevo', label: 'Nueva promoción', icon: Gift },
            { href: '/admin/pagos', label: 'Validar pagos', icon: Wallet },
            { href: '/admin/notificaciones', label: 'Enviar notificación', icon: Share2 },
          ].map((a) => (
            <li key={a.href}>
              <Link
                href={a.href}
                className="card-interactive group flex h-full items-center gap-3 rounded-xl border border-border bg-card p-4"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <a.icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-small font-medium text-foreground">{a.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Actividad reciente — bitácora, al final: se consulta, no se vigila. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-h4">
            <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
            Actividad reciente
          </CardTitle>
        </CardHeader>
        <CardContent>
          {d.actividad.length === 0 ? (
            <p className="text-small text-muted-foreground">Sin actividad registrada.</p>
          ) : (
            <ul className="divide-y divide-border">
              {d.actividad.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-small font-medium text-foreground">
                      {ACCION_LABEL[a.accion] ?? a.accion}
                    </p>
                    <p className="truncate text-caption">
                      {a.autor ?? 'Sistema'} · {a.entidadTipo}
                    </p>
                  </div>
                  <span className="shrink-0 text-caption">{fmtHora(a.fecha)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
