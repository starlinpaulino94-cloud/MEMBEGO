import Link from 'next/link'
import { conEmpresaOTodas } from '@/lib/tenant'
import Form from 'next/form'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { companyFilter } from '@/modules/admin/queries'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatMoney } from '@/lib/format'
import { leerRango, paramsDeRango, PRESETS } from '@/modules/reportes/rango'
import {
  getReporte,
  TIPO_TX_LABEL,
  METODO_LABEL,
  type Kpi,
} from '@/modules/reportes/queries'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { SectionHeader } from '@/components/ui/section-header'
import { StatusBanner } from '@/components/ui/status-banner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ReporteChart } from '@/components/charts/ReporteChart'
import { Download, Lightbulb, TrendingDown, TrendingUp } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Reportes' }

/** Variación contra el periodo anterior, con su signo y su color. */
function Variacion({ kpi, invertido = false }: { kpi: Kpi; invertido?: boolean }) {
  if (kpi.variacion == null) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {kpi.anterior === 0 && kpi.valor > 0 ? 'primer periodo con datos' : 'sin datos antes'}
      </p>
    )
  }
  const sube = kpi.variacion > 0
  const bueno = invertido ? !sube : sube
  const Icono = sube ? TrendingUp : TrendingDown
  return (
    <p
      className={`mt-1 flex items-center gap-1 text-xs ${
        kpi.variacion === 0
          ? 'text-muted-foreground'
          : bueno
            ? 'text-success'
            : 'text-destructive'
      }`}
    >
      <Icono className="h-3.5 w-3.5" aria-hidden />
      {sube ? '+' : ''}
      {kpi.variacion}% vs. periodo anterior
    </p>
  )
}

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)
  if (!companyId || companyId === '__none__') {
    return <SinEmpresaActiva seccion="tus reportes" />
  }

  const sp = await searchParams
  const empresa = await conEmpresaOTodas(
    companyId,
    'reportes: sin empresa activa es el superadmin',
    (tx) => tx.company
      .findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      .catch(() => null)
  )
  const timeZone = empresa?.zonaHoraria || 'America/Santo_Domingo'

  const rango = leerRango(sp, timeZone)
  const prefs = await getRegionalPrefs(companyId)
  const fmtMoney = (n: number) => formatMoney(n, prefs)

  const r = await getReporte(companyId, rango, timeZone)

  const tarjetas = [
    { label: 'Ingresos de caja', kpi: r.ingresosCaja, formato: fmtMoney },
    { label: 'Cobros de membresías', kpi: r.ingresosMembresias, formato: fmtMoney },
    { label: 'Ventas', kpi: r.operaciones, formato: (n: number) => String(n) },
    { label: 'Entregas sin cobro', kpi: r.entregas, formato: (n: number) => String(n) },
    { label: 'Clientes nuevos', kpi: r.clientesNuevos, formato: (n: number) => String(n) },
  ]

  const hayActividad = r.serie.some((p) => p.ventas > 0 || p.entregas > 0)

  /**
   * INSIGHTS (§55) — leer el reporte por ti.
   *
   * No consulta nada nuevo: interpreta las MISMAS cifras que ya están arriba.
   * Un panel de KPIs dice qué pasó; lo que falta es qué significa. "Ingresos
   * -18%" pide una frase que diga si eso es la tendencia o el ruido de una
   * semana corta.
   *
   * Solo salen los que tienen algo que decir: sin variación significativa, la
   * sección no aparece. Un insight que siempre está encendido es decoración.
   */
  const UMBRAL = 10
  const insights: { texto: string; tono: 'bueno' | 'malo' | 'neutro' }[] = []

  const mayorIngreso =
    r.ingresosCaja.variacion != null && Math.abs(r.ingresosCaja.variacion) >= UMBRAL
      ? r.ingresosCaja
      : null
  if (mayorIngreso?.variacion != null) {
    const sube = mayorIngreso.variacion > 0
    insights.push({
      texto: sube
        ? `Los ingresos de caja subieron ${mayorIngreso.variacion}% frente al periodo anterior de la misma duración.`
        : `Los ingresos de caja bajaron ${Math.abs(mayorIngreso.variacion)}% frente al periodo anterior de la misma duración.`,
      tono: sube ? 'bueno' : 'malo',
    })
  }

  if (r.clientesNuevos.variacion != null && Math.abs(r.clientesNuevos.variacion) >= UMBRAL) {
    const sube = r.clientesNuevos.variacion > 0
    insights.push({
      texto: sube
        ? `Entraron ${r.clientesNuevos.variacion}% más clientes nuevos que en el periodo anterior.`
        : `Entraron ${Math.abs(r.clientesNuevos.variacion)}% menos clientes nuevos que en el periodo anterior.`,
      tono: sube ? 'bueno' : 'malo',
    })
  }

  // Proporción de entregas sin cobro: alta puede ser normal (membresías) o
  // señal de fuga. La frase lo enuncia sin sentenciar.
  const totalOps = r.operaciones.valor + r.entregas.valor
  if (totalOps >= 10) {
    const pctEntregas = Math.round((r.entregas.valor / totalOps) * 100)
    if (pctEntregas >= 60) {
      insights.push({
        texto: `${pctEntregas}% de las operaciones fueron entregas sin cobro. Es lo esperable si tu negocio va por membresías; si no, conviene revisar de dónde salen.`,
        tono: 'neutro',
      })
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reportes"
        description={`${rango.etiqueta} · ${rango.desdeDia} a ${rango.hastaDia} (${rango.dias} día${rango.dias === 1 ? '' : 's'})`}
        action={
          <Button asChild variant="secondary">
            <a href={`/admin/reportes/export${paramsDeRango(rango)}`}>
              <Download className="mr-2 h-4 w-4" /> Exportar CSV
            </a>
          </Button>
        }
      />

      {r.incompleto && (
        <StatusBanner variant="warning" title="El reporte está incompleto">
          Alguna consulta no respondió, así que hay cifras que pueden estar en cero
          sin serlo. Recarga en unos segundos antes de tomar decisiones con estos
          números.
        </StatusBanner>
      )}

      {/* Filtros: presets como enlaces (compartibles) + rango a mano. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => {
            const activo = rango.preset === p.clave
            return (
              <Link
                key={p.clave}
                href={`/admin/reportes?rango=${p.clave}`}
                className={`inline-flex min-h-10 items-center rounded-lg px-3 text-small font-semibold transition-colors ${
                  activo
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                aria-current={activo ? 'page' : undefined}
              >
                {p.label}
              </Link>
            )
          })}
        </div>

        <Form action="/admin/reportes" className="ml-auto flex flex-wrap items-end gap-2">
          <label className="text-caption">
            Desde
            <Input type="date" name="desde" defaultValue={rango.desdeDia} className="mt-1" />
          </label>
          <label className="text-caption">
            Hasta
            <Input type="date" name="hasta" defaultValue={rango.hastaDia} className="mt-1" />
          </label>
          <Button type="submit" variant="secondary">
            Aplicar
          </Button>
        </Form>
      </div>

      {/* KPIs con comparación contra el periodo anterior del mismo largo. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {tarjetas.map((t) => (
          <div key={t.label} className="rounded-xl border border-border bg-card p-5">
            <p className="text-overline">{t.label}</p>
            <p className="mt-1.5 truncate text-h1 tabular-nums text-foreground">
              {t.formato(t.kpi.valor)}
            </p>
            <Variacion kpi={t.kpi} />
          </div>
        ))}
      </div>

      {/* Insights: qué significan los números de arriba. */}
      {insights.length > 0 && (
        <section>
          <SectionHeader title="Qué dicen estos números" />
          <ul className="space-y-2">
            {insights.map((i) => (
              <li
                key={i.texto}
                className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-4"
              >
                <Lightbulb
                  className={`mt-0.5 h-5 w-5 shrink-0 ${
                    i.tono === 'bueno'
                      ? 'text-success'
                      : i.tono === 'malo'
                        ? 'text-warning'
                        : 'text-primary'
                  }`}
                  aria-hidden
                />
                <p className="text-small text-foreground">{i.texto}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-h4">Actividad por día</CardTitle>
        </CardHeader>
        <CardContent>
          {hayActividad ? (
            <ReporteChart data={r.serie} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Sin operaciones registradas en este periodo.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-h4">Operaciones por tipo</CardTitle>
          </CardHeader>
          <CardContent>
            {r.porTipo.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin operaciones en el periodo.</p>
            ) : (
              <ul className="divide-y divide-border/50">
                {r.porTipo.map((t) => (
                  <li key={t.tipo} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-foreground">{TIPO_TX_LABEL[t.tipo] ?? t.tipo}</span>
                    <span className="shrink-0 text-right">
                      <span className="font-semibold tabular-nums text-foreground">
                        {t.operaciones}
                      </span>
                      {t.ingresos > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {fmtMoney(t.ingresos)}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-h4">Cómo pagaron</CardTitle>
          </CardHeader>
          <CardContent>
            {r.porMetodo.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin cobros registrados en el periodo.</p>
            ) : (
              <ul className="divide-y divide-border/50">
                {r.porMetodo.map((m) => (
                  <li key={m.metodo} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-foreground">{METODO_LABEL[m.metodo] ?? m.metodo}</span>
                    <span className="shrink-0 text-right">
                      <span className="font-semibold tabular-nums text-foreground">
                        {fmtMoney(m.ingresos)}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {m.operaciones} op.
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-h4">Clientes más activos</CardTitle>
          </CardHeader>
          <CardContent>
            {r.topClientes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin visitas registradas.</p>
            ) : (
              <ul className="divide-y divide-border/50">
                {r.topClientes.map((c) => (
                  <li key={c.nombre} className="flex justify-between gap-3 py-2 text-sm">
                    <span className="truncate text-foreground">{c.nombre}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-foreground">
                      {c.operaciones}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-h4">Membresías activas por plan</CardTitle>
            <p className="text-xs text-muted-foreground">
              Foto de hoy: no depende del periodo elegido.
            </p>
          </CardHeader>
          <CardContent>
            {r.activasPorPlan.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin membresías activas.</p>
            ) : (
              <ul className="divide-y divide-border/50">
                {r.activasPorPlan.map((p) => (
                  <li key={p.plan} className="flex justify-between gap-3 py-2 text-sm">
                    <span className="truncate text-foreground">{p.plan}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-foreground">
                      {p.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Los ingresos de caja y los cobros de membresías se muestran por separado a
        propósito: son dinero que entra por caminos distintos y sumarlos en una
        sola cifra impediría cuadrar el reporte con la caja del día.
      </p>
    </div>
  )
}
