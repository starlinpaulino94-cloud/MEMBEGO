import Link from 'next/link'
import { conEmpresa } from '@/lib/tenant'
import { redirect } from 'next/navigation'
import { ADMIN_ROLES, FULL_ADMIN_ROLES } from '@/types'
import {
  Activity,
  ArrowRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  IdCard,
  Lightbulb,
  Megaphone,
  Plus,
  QrCode,
  Share2,
  Smartphone,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getDashboardEjecutivo, type DashboardEjecutivo } from '@/modules/admin/dashboardQueries'
import { getOnboardingEmpresa } from '@/modules/empresas/onboarding'
import { getHomePublicada } from '@/modules/home/composicion'
import { leerSlidesEditor } from '@/modules/home/editor-contrato'
import { OnboardingChecklist } from '@/components/admin/OnboardingChecklist'
import { formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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
  COMPOSICION_PUBLICADA: 'Inicio publicado',
  COMPOSICION_PAUSADA: 'Inicio pausado',
}

function fmtHora(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat('es-DO', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(d))
}

/** «+18.5%» real, o null cuando no hay base de comparación. */
function delta(actual: number, anterior: number): string | null {
  if (anterior <= 0) return null
  const pct = ((actual - anterior) / anterior) * 100
  const signo = pct >= 0 ? '+' : ''
  return `${signo}${pct.toFixed(1)}%`
}

function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase()
}

/** Tarjeta KPI del diseño: rótulo arriba, número grande, línea y pie. */
function Kpi({
  icono: Icono,
  rotulo,
  valor,
  unidad,
  linea,
  lineaTono = 'muted',
  pie,
}: {
  icono: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  rotulo: string
  valor: string
  unidad?: string
  linea?: React.ReactNode
  lineaTono?: 'brand' | 'success' | 'muted'
  pie?: React.ReactNode
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4 elevation-1">
      <div className="flex items-start justify-between gap-2">
        <p className="text-label-sm uppercase tracking-wide text-muted-foreground">{rotulo}</p>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-primary-soft text-primary">
          <Icono className="size-4" aria-hidden />
        </span>
      </div>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-h1 tabular-nums text-foreground">{valor}</span>
        {unidad ? <span className="text-small text-muted-foreground">{unidad}</span> : null}
      </p>
      {linea ? (
        <p
          className={cn(
            'mt-0.5 text-caption',
            lineaTono === 'brand' && 'font-semibold text-primary',
            lineaTono === 'success' && 'font-semibold text-success'
          )}
        >
          {linea}
        </p>
      ) : null}
      {pie ? (
        <div className="mt-auto flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5 pt-1.5 text-label-sm text-muted-foreground [&>*]:min-w-0">
          {pie}
        </div>
      ) : null}
    </div>
  )
}

export default async function AdminDashboard() {
  const user = await requireRole(ADMIN_ROLES)
  // ÁMBITO EMPRESA: sin empresa activa no hay vista global aquí — el
  // superadmin elige empresa en plataforma y el staff ve /admin/sin-empresa.
  const companyId = await requireCompanyContext(user)

  // Onboarding PRIMERO: mientras la empresa no esté publicada, el asistente es
  // su "home". Se resuelve antes de cargar el dashboard pesado para no
  // desperdiciarlo cuando se va a redirigir igual.
  const onboarding = await getOnboardingEmpresa(companyId).catch(() => null)
  if (onboarding && !onboarding.publicado && FULL_ADMIN_ROLES.includes(user.metadata.role)) {
    redirect('/onboarding')
  }

  let d: DashboardEjecutivo | null = null
  let company: { name: string; moneda: string; idioma: string; zonaHoraria: string } | null = null
  let publicada: Awaited<ReturnType<typeof getHomePublicada>> = null
  try {
    // La empresa se lee ANTES: su zona horaria decide dónde empieza «hoy».
    company = await conEmpresa(companyId, (tx) =>
      tx.company.findUnique({
        where: { id: companyId },
        select: { name: true, moneda: true, idioma: true, zonaHoraria: true },
      })
    )
    ;[d, publicada] = await Promise.all([
      getDashboardEjecutivo(companyId, company?.zonaHoraria || 'America/Santo_Domingo'),
      getHomePublicada(companyId).catch(() => null),
    ])
  } catch (e) {
    console.error('[admin-dashboard]', e)
  }

  if (!d) {
    return (
      <p className="text-muted-foreground">
        No pudimos cargar el panel en este momento. Intenta de nuevo.
      </p>
    )
  }

  const tz = company?.zonaHoraria || 'America/Santo_Domingo'
  const maxVisitas = Math.max(1, ...d.visitasPorDia.map((v) => v.total))

  // «Pico: Sábados» — el día con más canjes de la serie, si hubo alguno.
  const pico = d.visitasPorDia.reduce(
    (mejor, v) => (v.total > (mejor?.total ?? 0) ? v : mejor),
    null as { fecha: string; total: number } | null
  )
  const nombrePico = pico
    ? new Intl.DateTimeFormat('es-DO', { weekday: 'long', timeZone: 'UTC' }).format(
        new Date(`${pico.fecha}T12:00:00Z`)
      )
    : null

  const deltaIngresos = delta(d.ingresosCobradosMes, d.ingresosMesAnterior)
  const mesActualLabel = new Intl.DateTimeFormat(company?.idioma || 'es-DO', {
    timeZone: tz,
    month: 'long',
    year: 'numeric',
  }).format(new Date())

  // El hero publicado (si hay): la tarjeta «Estado en App Móvil» enseña lo que
  // el cliente está viendo AHORA, no una maqueta.
  const heroBloque = publicada?.bloques.find((b) => b.tipo === 'HERO')
  let heroSlide: { titulo: string; subtitulo: string } | null = null
  try {
    const slides = heroBloque ? leerSlidesEditor(heroBloque.config) : []
    heroSlide = slides[0] ?? null
  } catch {
    heroSlide = null
  }
  const bloquesActivos = publicada?.bloques.filter((b) => b.activo).length ?? 0

  return (
    <div className="animate-fade-up space-y-6">
      {/* ── Cabecera del resumen ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-h1 text-foreground">Resumen Operativo</h1>
            {deltaIngresos ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-primary-soft px-2.5 py-1 text-label-md font-semibold text-primary">
                <TrendingUp className="size-3.5" aria-hidden />
                {deltaIngresos} vs mes anterior
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-small text-muted-foreground">
            Centro de mando comercial y flujo de canjes de {company?.name ?? 'tu negocio'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg border border-border bg-card px-3 py-2 text-label-lg capitalize text-muted-foreground">
            {mesActualLabel}
          </span>
          <Button asChild variant="secondary" className="rounded-full">
            <Link href="/admin/promociones/nuevo">
              <Plus className="size-4" aria-hidden /> Nuevo Beneficio
            </Link>
          </Button>
          <Button asChild className="rounded-full bg-retail-deep text-white hover:opacity-95">
            <Link href="/admin/scanner">
              <QrCode className="size-4" aria-hidden /> Escanear QR
            </Link>
          </Button>
        </div>
      </div>

      {/* Onboarding (F5.1): guía hasta publicar el perfil */}
      {onboarding && <OnboardingChecklist onboarding={onboarding} />}

      {/* ── Avisos: solo los que tienen algo que decir ───────────────────── */}
      {d.porVencer7d + d.pagosPendientes === 0 && d.topPromos.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-small text-muted-foreground">
          <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
          Todo al día: sin pagos por validar ni membresías a punto de vencer.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {d.porVencer7d > 0 ? (
            <div className="flex flex-col rounded-xl border border-border bg-card p-4 elevation-1">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                  <CircleAlert className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-label-lg text-foreground">
                    {d.porVencer7d} {d.porVencer7d === 1 ? 'Membresía' : 'Membresías'} en Riesgo
                  </p>
                  <p className="text-caption">Vencen en los próximos 7 días</p>
                </div>
                <span className="shrink-0 rounded-full bg-destructive/10 px-2.5 py-1 text-label-sm font-semibold text-destructive">
                  Crítico
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="flex -space-x-1.5" aria-hidden>
                  {d.porVencerNombres.map((n) => (
                    <span
                      key={n}
                      className="flex size-7 items-center justify-center rounded-full border-2 border-card bg-brand-primary-soft text-label-sm font-semibold text-primary"
                    >
                      {iniciales(n)}
                    </span>
                  ))}
                  {d.porVencer7d > d.porVencerNombres.length ? (
                    <span className="flex size-7 items-center justify-center rounded-full border-2 border-card bg-muted text-label-sm font-semibold text-muted-foreground">
                      +{d.porVencer7d - d.porVencerNombres.length}
                    </span>
                  ) : null}
                </span>
                <Link
                  href="/admin/riesgo?vence=7&sinVisitas=0"
                  className="inline-flex items-center gap-1 text-label-lg text-primary hover:underline"
                >
                  Renovar ahora <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
            </div>
          ) : null}

          {d.pagosPendientes > 0 ? (
            <div className="flex flex-col rounded-xl border border-border bg-card p-4 elevation-1">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary-soft text-primary">
                  <Banknote className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-label-lg text-foreground">
                    {d.pagosPendientes}{' '}
                    {d.pagosPendientes === 1 ? 'Pago por Validar' : 'Pagos por Validar'}
                  </p>
                  <p className="text-caption">
                    {d.transferenciasMonto > 0
                      ? `Transferencias declaradas · ${formatMoney(d.transferenciasMonto, company)}`
                      : 'En la cola de validación'}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-warning/10 px-2.5 py-1 text-label-sm font-semibold text-warning">
                  Pendientes
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="truncate text-caption">
                  {d.ultimaTransferencia != null
                    ? `Última: ${formatMoney(d.ultimaTransferencia, company)}`
                    : ''}
                </span>
                <Button asChild size="sm" className="rounded-full bg-retail-deep text-white hover:opacity-95">
                  <Link href="/admin/pagos">Revisar y Aprobar</Link>
                </Button>
              </div>
            </div>
          ) : null}

          {d.topPromos[0] ? (
            <div className="flex flex-col rounded-xl border border-border bg-card p-4 elevation-1">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary-soft text-primary">
                  <Megaphone className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label-lg text-foreground">
                    Campaña: {d.topPromos[0].titulo}
                  </p>
                  <p className="text-caption">
                    {fmt(d.topPromos[0].vistas)} vistas registradas en app
                  </p>
                </div>
                {d.topPromos[0].vistas > 0 ? (
                  <span className="shrink-0 rounded-full bg-retail-cyan/15 px-2.5 py-1 text-label-sm font-semibold text-retail-deep">
                    {Math.min(
                      100,
                      Math.round((d.topPromos[0].guardadas / d.topPromos[0].vistas) * 100)
                    )}
                    % Guardan
                  </span>
                ) : null}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span
                  className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`${d.topPromos[0].guardadas} de ${d.topPromos[0].vistas} vistas la guardaron`}
                >
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{
                      width: `${Math.min(100, Math.round((d.topPromos[0].guardadas / Math.max(1, d.topPromos[0].vistas)) * 100))}%`,
                    }}
                  />
                </span>
                <Link
                  href={`/admin/promociones/${d.topPromos[0].id}/editar`}
                  className="shrink-0 text-label-lg text-primary hover:underline"
                >
                  Gestionar oferta
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* ── KPI del período ──────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icono={Wallet}
          rotulo="Ingresos del mes"
          valor={formatMoney(d.ingresosCobradosMes, company)}
          linea={deltaIngresos ? `${deltaIngresos} vs mes anterior` : 'Membresías con pago confirmado'}
          lineaTono={deltaIngresos ? 'success' : 'muted'}
          pie={
            <>
              <span className="truncate">
                Recurrente esperado: {formatMoney(d.recurrenteEsperado, company)}
              </span>
              <span className="shrink-0">
                Anterior: {formatMoney(d.ingresosMesAnterior, company)}
              </span>
            </>
          }
        />
        <Kpi
          icono={IdCard}
          rotulo="Membresías activas"
          valor={fmt(d.membresiasActivas)}
          unidad="vigentes"
          linea={
            d.porVencer7d > 0 ? `${d.porVencer7d} por vencer en 7 días` : 'Ninguna vence esta semana'
          }
          lineaTono={d.porVencer7d > 0 ? 'brand' : 'muted'}
          pie={
            d.topPlanes.length > 0 ? (
              <>
                {d.topPlanes.map((p) => (
                  <span key={p.nombre} className="truncate">
                    <span aria-hidden>● </span>
                    {p.total} {p.nombre}
                  </span>
                ))}
              </>
            ) : undefined
          }
        />
        <Kpi
          icono={QrCode}
          rotulo="Canjes hoy"
          valor={fmt(d.visitasHoy)}
          unidad="validados"
          linea={`${fmt(d.visitasMes)} en el mes`}
          lineaTono="brand"
          pie={
            d.citasHoy > 0 ? (
              <>
                <span className="truncate">Agenda de hoy</span>
                <span className="shrink-0 font-semibold text-foreground">
                  {d.citasHoy} {d.citasHoy === 1 ? 'cita' : 'citas'}
                </span>
              </>
            ) : undefined
          }
        />
        <Kpi
          icono={Users}
          rotulo="Clientes registrados"
          valor={fmt(d.clientesTotal)}
          unidad="socios"
          linea={`+${fmt(d.clientesNuevos30d)} nuevos este período`}
          lineaTono="brand"
          pie={
            <>
              <span className="truncate">Seguidores</span>
              <span className="shrink-0 font-semibold text-foreground">
                {fmt(d.seguidores)} (+{d.nuevosSeguidores30d})
              </span>
            </>
          }
        />
      </div>

      {/* ── Canjes de los últimos 14 días ────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-5 elevation-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-h3 text-foreground">
              Visitas y Canjes validados
              <span className="text-small font-normal text-muted-foreground">
                (Últimos 14 días)
              </span>
              {nombrePico && (pico?.total ?? 0) > 0 ? (
                <span className="rounded-full bg-retail-cyan/15 px-2.5 py-1 text-label-sm font-semibold capitalize text-retail-deep">
                  Pico: {nombrePico}
                </span>
              ) : null}
            </h2>
            <p className="mt-0.5 text-caption">
              Canjes validados en caja, en el calendario del negocio
            </p>
          </div>
          <span className="flex items-center gap-1.5 text-label-md text-muted-foreground">
            <span className="size-2.5 rounded-full bg-primary" aria-hidden /> Canjes validados
          </span>
        </div>

        <div className="mt-4 flex h-40 items-end gap-1.5">
          {d.visitasPorDia.map((v, idx) => (
            <div
              key={v.fecha}
              className="animate-grow-y group relative flex-1 rounded-t-lg bg-primary/80 transition-colors hover:bg-primary"
              style={{
                height: `${Math.max(3, (v.total / maxVisitas) * 100)}%`,
                animationDelay: `${idx * 35}ms`,
              }}
              title={`${v.fecha}: ${v.total} canje(s)`}
            />
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          {d.visitasPorDia.map((v, idx) => (
            <span
              key={v.fecha}
              className={cn(
                'flex-1 text-center text-label-sm text-muted-foreground',
                idx === d.visitasPorDia.length - 1 && 'font-bold text-primary'
              )}
            >
              {idx === d.visitasPorDia.length - 1 ? `Hoy (${v.total})` : v.fecha.slice(8)}
            </span>
          ))}
        </div>

        {/* La franja del pie lleva cifras REALES del período, no las del
            mockup: aquí viven las referencias que antes eran su propia lista. */}
        <dl className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-3 text-label-md text-muted-foreground">
          <div className="flex items-baseline gap-1.5">
            <dt>Visitas este mes:</dt>
            <dd className="font-bold text-foreground">{fmt(d.visitasMes)}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt>Promociones activas:</dt>
            <dd className="font-bold text-foreground">{fmt(d.promosActivas)}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt>Referidos completados:</dt>
            <dd className="font-bold text-foreground">{fmt(d.referidosCompletados)}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt>Clientes sin visitas 30 días:</dt>
            <dd>
              <Link
                href="/admin/riesgo?sinVisitas=30&vence=0"
                className="font-bold text-primary hover:underline"
              >
                {fmt(d.clientesEnRiesgo)}
              </Link>
            </dd>
          </div>
        </dl>
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* ── Actividad en vivo ──────────────────────────────────────────── */}
        <section className="rounded-xl border border-border bg-card p-5 elevation-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-h3 text-foreground">
              <span className="size-2 rounded-full bg-success" aria-hidden />
              Canjes y Actividad en Vivo
            </h2>
            <Link
              href="/admin/actividad"
              className="text-label-lg text-primary hover:underline"
            >
              Ver registro completo
            </Link>
          </div>

          {d.actividad.length === 0 ? (
            <p className="mt-3 text-small text-muted-foreground">Sin actividad registrada.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {d.actividad.slice(0, 5).map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-3 rounded-lg bg-muted/60 px-3 py-2.5"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary-soft text-label-lg text-primary">
                    {a.autor ? iniciales(a.autor) : <Activity className="size-4" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-label-lg text-foreground">
                        {a.autor ?? 'Sistema'}
                      </span>
                      <span className="rounded-full bg-card px-2 py-0.5 text-label-sm font-semibold text-muted-foreground">
                        {ACCION_LABEL[a.accion] ?? a.accion}
                      </span>
                    </span>
                    <span className="block truncate text-caption">{a.entidadTipo}</span>
                  </span>
                  <span className="shrink-0 text-label-sm text-muted-foreground">
                    {fmtHora(a.fecha, tz)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-label-md text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <QrCode className="size-4" aria-hidden />
              Validaciones de hoy:{' '}
              <span className="font-bold text-foreground">{fmt(d.visitasHoy)} canjes</span>
            </span>
            <Link href="/admin/registros" className="text-primary hover:underline">
              Auditoría rápida
            </Link>
          </p>
        </section>

        {/* ── Estado en App Móvil ────────────────────────────────────────── */}
        <section className="rounded-xl border border-border bg-card p-5 elevation-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-h3 text-foreground">
              <Smartphone className="size-4" aria-hidden /> Estado en App Móvil
            </h2>
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-label-sm font-semibold',
                publicada?.estado === 'PUBLICADA'
                  ? 'bg-success/10 text-success'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {publicada?.estado === 'PUBLICADA'
                ? 'Público Ahora'
                : publicada?.estado === 'PAUSADA'
                  ? 'Pausado'
                  : 'Sin publicación'}
            </span>
          </div>

          {heroSlide ? (
            <>
              <p className="mt-3 flex items-center justify-between text-label-sm uppercase tracking-wide text-muted-foreground">
                Banner principal activo
                <span>
                  {bloquesActivos} {bloquesActivos === 1 ? 'bloque' : 'bloques'}
                </span>
              </p>
              <Link
                href="/admin/personalizacion"
                className="retail-header mt-2 block rounded-lg p-4 text-white outline-none transition hover:opacity-95 focus-visible:ring-2 focus-visible:ring-primary"
              >
                <p className="text-label-sm uppercase tracking-wide text-white">
                  {publicada?.territorio ?? company?.name}
                </p>
                <p className="mt-0.5 text-h3 text-white">{heroSlide.titulo}</p>
                {heroSlide.subtitulo ? (
                  <p className="mt-0.5 line-clamp-2 text-caption text-white">
                    {heroSlide.subtitulo}
                  </p>
                ) : null}
              </Link>
            </>
          ) : (
            <p className="mt-3 rounded-lg bg-muted/60 p-3 text-caption">
              El Inicio del cliente aún no tiene composición publicada.{' '}
              <Link href="/admin/personalizacion" className="font-semibold text-primary hover:underline">
                Componer y publicar
              </Link>
            </p>
          )}

          {d.topPromos.length > 0 ? (
            <>
              <p className="mt-4 flex items-center justify-between text-label-sm uppercase tracking-wide text-muted-foreground">
                Promociones con más vistas
                <Link
                  href="/admin/promociones"
                  className="font-semibold normal-case text-primary hover:underline"
                >
                  Editar
                </Link>
              </p>
              <ul className="mt-2 space-y-2">
                {d.topPromos.slice(0, 2).map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-2.5 rounded-lg bg-muted/60 px-3 py-2.5"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card text-primary">
                      <Megaphone className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label-lg text-foreground">
                        {p.titulo}
                      </span>
                      <span className="block text-label-sm text-muted-foreground">
                        {fmt(p.vistas)} vistas · {fmt(p.guardadas)} guardadas
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-label-sm font-semibold text-success">
                      Activa
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {d.citasHoy > 0 ? (
            <p className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3 text-label-md text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-4" aria-hidden /> Agenda de hoy
              </span>
              <Link href="/admin/citas" className="font-bold text-primary hover:underline">
                {d.citasHoy} {d.citasHoy === 1 ? 'cita' : 'citas'}
              </Link>
            </p>
          ) : null}
        </section>
      </div>

      {/* ── Recomendaciones y atajos que no viven arriba ─────────────────── */}
      <section className="space-y-3">
          {d.recomendaciones.map((r) => (
            <p
              key={r.texto}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
            >
              <span className="flex min-w-0 items-center gap-2.5 text-small text-foreground">
                <Lightbulb className="size-5 shrink-0 text-primary" aria-hidden />
                {r.texto}
              </span>
              <Button asChild size="sm" variant="outline" className="rounded-full">
                <Link href={r.href}>
                  {r.cta} <ArrowRight aria-hidden />
                </Link>
              </Button>
            </p>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline" className="rounded-full">
              <Link href="/admin/pagos">
                <Wallet className="size-4" aria-hidden /> Validar pagos
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="rounded-full">
              <Link href="/admin/notificaciones">
                <Share2 className="size-4" aria-hidden /> Enviar notificación
              </Link>
            </Button>
          </div>
      </section>
    </div>
  )
}
