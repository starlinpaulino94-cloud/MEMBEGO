import { redirect } from 'next/navigation'
import { requireSection } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import {
  getMetricas,
  getLeadsPorFuente,
  getTiempoPorEtapa,
  getLeadsPorAsignado,
  getLeadsAtencion,
} from '@/modules/crm/queries'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Users,
  Clock,
  TrendingUp,
  BarChart3,
  AlertTriangle,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

const ETAPA_LABELS: Record<string, string> = {
  NUEVO: 'Nuevo',
  CONTACTADO: 'Contactado',
  INTERESADO: 'Interesado',
  PROPUESTA: 'Propuesta',
  NEGOCIACION: 'Negociación',
  GANADO: 'Ganado',
  PERDIDO: 'Perdido',
}

const FUENTE_LABELS: Record<string, string> = {
  ORGANICO: 'Orgánico',
  PAGADO: 'Pagado',
  REFERENCIA: 'Referencia',
  EVENTO: 'Evento',
  OTRO: 'Otro',
}

export default async function MetricasPage() {
  const user = await requireSection('leads')
  if (!user) redirect('/login')

  const companyId = companyFilter(user)
  if (!companyId) {
    return (
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Selecciona una empresa desde el panel de superadmin para usar el CRM.
        </p>
      </div>
    )
  }

  const [metricas, fuentes, tiempoPorEtapa, asignados, atencion] = await Promise.all([
    getMetricas(companyId),
    getLeadsPorFuente(companyId),
    getTiempoPorEtapa(companyId),
    getLeadsPorAsignado(companyId),
    getLeadsAtencion(companyId),
  ])

  const maxAsignados = Math.max(...asignados.map((a) => a.cantidad), 1)
  const totalPipelineDias = tiempoPorEtapa.reduce((acc, t) => acc + t.dias, 0)
  const totalPipelineFormateado = totalPipelineDias === 1 ? '1 día' : `${Math.round(totalPipelineDias * 10) / 10} días`

  const STATS = [
    { label: 'Leads Hoy', value: String(metricas.leadsHoy), icon: Users, accent: 'text-primary' },
    { label: 'En Pipeline', value: String(metricas.enPipeline), icon: Clock, accent: 'text-warning' },
    { label: 'Ganados Este Mes', value: String(metricas.ganadosMes), icon: TrendingUp, accent: 'text-success' },
    { label: 'Tasa de Conversión', value: `${metricas.tasaConversion}%`, icon: BarChart3, accent: 'text-primary' },
  ] as const

  return (
    <div className="space-y-5">

      {/* ── Stats row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STATS.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.label}>
              <CardContent className="flex items-center gap-4 p-4">
                <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted/50')}>
                  <Icon className={cn('h-6 w-6', stat.accent)} />
                </span>
                <div>
                  <p className="text-overline">{stat.label}</p>
                  <p className="text-h2 mt-0.5">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* ── Grid: two columns ─────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Leads por Fuente */}
        <Card>
          <CardHeader>
            <CardTitle className="text-h4">Leads por Fuente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {fuentes.length === 0 && (
              <p className="text-sm text-muted-foreground">Sin datos aún.</p>
            )}
            {fuentes.map((f) => (
              <div key={f.fuente}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-small text-foreground">{FUENTE_LABELS[f.fuente] ?? f.fuente}</span>
                  <span className="text-caption text-muted-foreground tabular-nums">{f.porcentaje}%</span>
                </div>
                <div className="h-2 rounded-full bg-primary/20">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${f.porcentaje}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Tiempo Promedio por Etapa */}
        <Card>
          <CardHeader>
            <CardTitle className="text-h4">Tiempo Promedio por Etapa</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {tiempoPorEtapa.map((t) => (
                <div key={t.etapa} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <span className="text-small text-foreground">
                    {ETAPA_LABELS[t.etapa] ?? t.etapa}
                  </span>
                  <span className="text-small font-medium text-muted-foreground tabular-nums">
                    {t.diasFormateado}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                <span className="text-small font-medium text-foreground">Total pipeline</span>
                <span className="text-small font-semibold text-primary tabular-nums">{totalPipelineFormateado}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Leads por Asignado */}
        <Card>
          <CardHeader>
            <CardTitle className="text-h4">Leads por Asignado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {asignados.length === 0 && (
              <p className="text-sm text-muted-foreground">Sin leads asignados.</p>
            )}
            {asignados.map((a) => (
              <div key={a.asignadoA}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-small text-foreground">{a.asignadoA}</span>
                  <span className="text-caption text-muted-foreground tabular-nums">{a.cantidad} leads</span>
                </div>
                <div className="h-2 rounded-full bg-primary/20">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(a.cantidad / maxAsignados) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Requieren Atención */}
        <Card>
          <CardHeader>
            <CardTitle className="text-h4">Requieren Atención</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {atencion.length === 0 && (
              <p className="text-sm text-muted-foreground">No hay leads pendientes.</p>
            )}
            {atencion.map((a) => (
              <div
                key={a.id}
                className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div>
                  <p className="text-small font-medium text-foreground">{a.nombre}</p>
                  <p className="text-caption text-muted-foreground mt-0.5">
                    {a.diasEspera} días sin atención · {ETAPA_LABELS[a.etapa] ?? a.etapa}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
