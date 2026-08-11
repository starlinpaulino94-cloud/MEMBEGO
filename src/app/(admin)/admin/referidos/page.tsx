import Link from 'next/link'
import { conEmpresaOTodas } from '@/lib/tenant'
import {
  Users,
  Gift,
  Trophy,
  MousePointerClick,
  BadgeCheck,
  DollarSign,
  ShieldAlert,
  Activity,
  Megaphone,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { referidoEstadoUi } from '@/lib/estados'
import { ADMIN_ROLES } from '@/types'
import { companyFilter } from '@/modules/admin/queries'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatMoney } from '@/lib/format'
import {
  getEmpresaReferidosDashboard,
  type EmpresaReferidosDashboard,
} from '@/modules/referidos/actions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/components/ui/stat-card'
import { Badge } from '@/components/ui/badge'
import { ReglaRecompensaForm } from '@/components/admin/ReglaRecompensaForm'
import { ReglaRecompensaToggle } from '@/components/admin/ReglaRecompensaToggle'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const TIPO_LABEL: Record<string, string> = {
  LAVADOS_GRATIS: 'Usos gratis',
  DESCUENTO_PORCENTAJE: 'Descuento %',
  DESCUENTO_MONTO: 'Descuento RD$',
}

const CANAL_LABEL: Record<string, string> = {
  native: 'Compartir nativo',
  copy: 'Enlace copiado',
  qr: 'Código QR',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  facebook: 'Facebook',
  x: 'X (Twitter)',
  email: 'Email',
  sms: 'SMS',
  directo: 'Directo',
}

/** Barra horizontal simple, renderizada en servidor. */
function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return (
    <div className="h-2 w-full rounded-full bg-muted">
      <div
        className={cn('h-2 rounded-full bg-primary', className)}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export default async function ReferidosPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)
  const isSuperadmin = user.metadata.role === 'SUPERADMIN'
  const where = companyId ? { companyId } : {}
  const prefs = await getRegionalPrefs(companyId)
  const fmtMoney = (n: number) => formatMoney(n, prefs)

  let dash: EmpresaReferidosDashboard | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let reglas: any[] = []
  // El superadmin no tiene empresa propia: debe elegir a cuál aplica la regla.
  let companies: { id: string; name: string }[] = []
  try {
    // `getEmpresaReferidosDashboard` abre su propia transacción: se queda
    // fuera del envoltorio para no anidar transacciones (agota el pool).
    ;[dash, [reglas, companies]] = await Promise.all([
      getEmpresaReferidosDashboard(companyId ?? null),
      conEmpresaOTodas(
      companyId,
      'referidos: sin empresa activa es el superadmin, que cruza empresas a propósito',
      (tx) => Promise.all([
        tx.reglaRecompensa.findMany({
          where,
          orderBy: { valorCondicion: 'asc' },
          include: { company: { select: { name: true } } },
        }),
        isSuperadmin
          ? tx.company.findMany({
              where: { isActive: true },
              select: { id: true, name: true },
              orderBy: { name: 'asc' },
            })
          : Promise.resolve([]),
        ])
      ),
    ])
  } catch (e) {
    console.error('[admin-referidos]', e)
  }

  if (!dash) {
    return (
      <p className="text-muted-foreground">
        No pudimos cargar el programa de referidos. Intenta más tarde.
      </p>
    )
  }

  const { kpis } = dash
  const maxDiario = Math.max(...dash.registrosDiarios.map((d) => d.registros), 1)
  const maxMensual = Math.max(
    ...dash.evolucionMensual.map((m) => Math.max(m.registros, m.membresias)),
    1
  )
  const maxCanal = Math.max(
    ...dash.porCanal.map((c) => c.clicks + c.compartidos),
    1
  )

  const kpiCards = [
    { label: 'Visitantes únicos', valor: String(kpis.visitantesUnicos), icon: MousePointerClick, accent: 'violet' as const },
    { label: 'Registros', valor: String(kpis.registros), icon: Users, accent: 'amber' as const },
    { label: 'Referidos válidos', valor: String(kpis.membresias), icon: BadgeCheck, accent: 'green' as const },
    { label: 'Conversión (registro → compra)', valor: `${kpis.conversionPct}%`, icon: Trophy, accent: 'green' as const },
    { label: 'Ingresos por referidos', valor: fmtMoney(kpis.ingresosReferidos), icon: DollarSign, accent: 'green' as const },
    { label: 'Valor promedio por referido', valor: fmtMoney(kpis.valorPromedioPorReferido), icon: DollarSign, accent: 'sky' as const },
    { label: 'Recompensas (entregadas / pendientes)', valor: `${kpis.recompensasEntregadas} / ${kpis.recompensasPendientes}`, icon: Gift, accent: 'violet' as const },
    { label: 'Sospechosos / fraudes', valor: `${kpis.sospechosos} / ${kpis.fraudes}`, icon: ShieldAlert, accent: 'red' as const },
  ]

  const maxEmbudo = Math.max(...dash.embudo.map((e) => e.valor), 1)

  const MOVIMIENTO_LABEL: Record<string, string> = {
    LINK: 'generó su enlace',
    SHARE: 'compartió su enlace',
    CLICK: 'recibió un clic',
    REGISTRO_INICIADO: 'llevó a alguien al registro',
    REGISTRO: 'logró un registro',
    VERIFICADO: 'su referido verificó el correo',
    MEMBRESIA: 'su referido activó membresía',
    COMPRA: 'su referido compró',
    RECOMPENSA: 'recibió una recompensa',
    FRAUDE: 'intento bloqueado (antifraude)',
    REGISTRO_GLOBAL: 'registro global MembeGo',
    MEMBRESIA_GLOBAL: 'membresía global MembeGo',
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Invita y Gana — Rendimiento"
        description="Rendimiento del programa de referidos y reglas de recompensa."
        action={
          <Link href="/admin/invitaciones">
            <Button variant="outline" className="gap-2">
              <Megaphone className="h-4 w-4" />
              Campañas
            </Button>
          </Link>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpiCards.map((k) => (
          <StatCard key={k.label} label={k.label} value={k.valor} icon={k.icon} accent={k.accent} />
        ))}
      </div>

      {/* Fase E6 · Embudo de conversión completo, con tasas por etapa */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Embudo de conversión</CardTitle>
          <p className="text-sm text-muted-foreground">
            Cada etapa proviene de eventos reales registrados; el porcentaje es
            la tasa respecto a la etapa anterior.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {dash.embudo.map((e) => (
              <div key={e.etapa} className="flex items-center gap-3 text-sm">
                <span className="w-44 shrink-0 text-muted-foreground">{e.etapa}</span>
                <Bar value={e.valor} max={maxEmbudo} className="bg-primary/70" />
                <span className="w-14 shrink-0 text-right font-semibold tabular-nums text-foreground">
                  {e.valor}
                </span>
                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {e.tasaPct != null ? `${e.tasaPct}%` : ''}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
            <span>Clics totales: <strong className="text-foreground">{kpis.clicks}</strong></span>
            <span>Compartidos: <strong className="text-foreground">{kpis.compartidos}</strong></span>
            <span>Verificados: <strong className="text-foreground">{kpis.verificados}</strong></span>
            <span>Clientes activos: <strong className="text-foreground">{kpis.activos}</strong></span>
            {kpis.tiempoPromedioConversionDias != null && (
              <span>
                Tiempo promedio a conversión:{' '}
                <strong className="text-foreground">{kpis.tiempoPromedioConversionDias} días</strong>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Embajadores activos/inactivos */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 py-4">
          <div className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4 text-success" />
            <span className="font-semibold text-foreground">{kpis.embajadoresActivos}</span>
            <span className="text-muted-foreground">embajadores activos (30 días)</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4 text-muted-foreground/40" />
            <span className="font-semibold text-foreground">{kpis.embajadoresInactivos}</span>
            <span className="text-muted-foreground">inactivos</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Evolución mensual */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evolución mensual</CardTitle>
          </CardHeader>
          <CardContent>
            {dash.evolucionMensual.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin datos todavía.</p>
            ) : (
              <div className="space-y-3">
                {dash.evolucionMensual.map((m) => (
                  <div key={m.mes} className="space-y-1 text-xs">
                    <div className="flex justify-between text-muted-foreground">
                      <span className="font-medium text-foreground">{m.mes}</span>
                      <span>
                        {m.registros} registros · {m.membresias} membresías
                      </span>
                    </div>
                    <Bar value={m.registros} max={maxMensual} className="bg-warning" />
                    <Bar value={m.membresias} max={maxMensual} className="bg-success" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Registros diarios */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registros diarios (últimos 30 días)</CardTitle>
          </CardHeader>
          <CardContent>
            {dash.registrosDiarios.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin registros en los últimos 30 días.</p>
            ) : (
              <div className="space-y-2">
                {dash.registrosDiarios.map((d) => (
                  <div key={d.dia} className="flex items-center gap-3 text-xs">
                    <span className="w-16 shrink-0 text-muted-foreground">{d.dia}</span>
                    <Bar value={d.registros} max={maxDiario} />
                    <span className="w-6 shrink-0 text-right font-medium text-foreground">
                      {d.registros}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Por canal */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rendimiento por canal</CardTitle>
          </CardHeader>
          <CardContent>
            {dash.porCanal.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aún no hay actividad de compartir/clics.
              </p>
            ) : (
              <div className="space-y-2">
                {dash.porCanal.map((c) => (
                  <div key={c.canal} className="flex items-center gap-3 text-xs">
                    <span className="w-28 shrink-0 text-muted-foreground">
                      {CANAL_LABEL[c.canal] ?? c.canal}
                    </span>
                    <Bar value={c.clicks + c.compartidos} max={maxCanal} className="bg-primary/70" />
                    <span className="w-28 shrink-0 text-right text-muted-foreground">
                      {c.clicks} clics · {c.compartidos} shares
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Por campaña */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-4 w-4 text-primary" />
              Clics por campaña
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dash.porCampana.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin campañas registradas. Agrega <code>?utm_campaign=nombre</code> a
                los enlaces /r/ para medirlas.
              </p>
            ) : (
              <ul className="space-y-2">
                {dash.porCampana.map((c) => (
                  <li key={c.campana} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{c.campana}</span>
                    <Badge variant="secondary">{c.clicks} clics</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Top embajadores */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top embajadores (por conversiones)</CardTitle>
          </CardHeader>
          <CardContent>
            {dash.topEmbajadores.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay embajadores con actividad.</p>
            ) : (
              <ul className="space-y-2">
                {dash.topEmbajadores.map((t, i) => (
                  <li key={t.nombre + i} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-foreground">
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
                          ['bg-warning text-warning-foreground', 'bg-muted-foreground/30 text-foreground', 'bg-warning/40 text-warning-foreground'][i] ??
                          'bg-muted text-muted-foreground'
                        }`}
                      >
                        {i + 1}
                      </span>
                      {t.nombre}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t.membresias} conv · {t.registros} reg · {t.puntos} pts
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Top conversión */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mayor conversión (mín. 3 registros)</CardTitle>
          </CardHeader>
          <CardContent>
            {dash.topConversion.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Se mostrará cuando haya embajadores con al menos 3 registros.
              </p>
            ) : (
              <ul className="space-y-2">
                {dash.topConversion.map((t, i) => (
                  <li key={t.nombre + i} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{t.nombre}</span>
                    <span className="text-xs text-muted-foreground">
                      {t.pct}% ({t.membresias}/{t.registros})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Fase E6: últimos movimientos (eventos reales) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimos movimientos</CardTitle>
          </CardHeader>
          <CardContent>
            {dash.ultimosMovimientos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin actividad todavía.</p>
            ) : (
              <ul className="space-y-2">
                {dash.ultimosMovimientos.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-foreground">
                      <strong>{m.nombre}</strong>{' '}
                      <span className="text-muted-foreground">
                        {MOVIMIENTO_LABEL[m.tipo] ?? m.tipo}
                        {m.canal ? ` · ${CANAL_LABEL[m.canal] ?? m.canal}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat('es-DO', { dateStyle: 'short', timeStyle: 'short' }).format(m.fecha)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Fase E6: estado de cada referido */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Referidos recientes</CardTitle>
          </CardHeader>
          <CardContent>
            {dash.referidosRecientes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay referidos.</p>
            ) : (
              <ul className="space-y-2">
                {dash.referidosRecientes.slice(0, 10).map((r) => {
                  const e = referidoEstadoUi(r.estado)
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate text-foreground">
                        <strong>{r.nombre}</strong>{' '}
                        <span className="text-muted-foreground">por {r.referente}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {new Intl.DateTimeFormat('es-DO', { dateStyle: 'short' }).format(r.fecha)}
                        </span>
                        <Badge variant={e.variant} className="text-[10px]">{e.label}</Badge>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Reglas de recompensa */}
      <Card>
        <CardHeader>
          <CardTitle>Reglas de recompensa</CardTitle>
          <p className="text-sm text-muted-foreground">
            {isSuperadmin
              ? 'Define los premios por referidos para cada empresa. Elige la empresa a la que aplica cada regla.'
              : 'Define los premios que reciben tus clientes al referir más personas.'}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {reglas.length > 0 && (
            <div className="space-y-2">
              {reglas.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border border-border/60 p-3"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{r.nombre}</p>
                      {isSuperadmin && r.company?.name && (
                        <Badge variant="secondary" className="text-xs">
                          {r.company.name}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {r.valorCondicion} referidos completados → {Number(r.valorRecompensa)}{' '}
                      {TIPO_LABEL[r.tipoRecompensa]}
                    </p>
                  </div>
                  <ReglaRecompensaToggle id={r.id} activo={r.activo} />
                </div>
              ))}
            </div>
          )}
          <ReglaRecompensaForm companies={isSuperadmin ? companies : undefined} />
        </CardContent>
      </Card>
    </div>
  )
}
