import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatMoney } from '@/lib/format'
import { getRetencion } from '@/modules/riesgo/retencion'
import { PageHeader } from '@/components/ui/page-header'
import { SectionHeader } from '@/components/ui/section-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { UmbralesRetencionForm } from '@/components/admin/UmbralesRetencionForm'
import { getUmbralesRetencion } from '@/modules/riesgo/umbrales'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Retención',
  description: 'Quién se está enfriando, cuántos renuevan y cuánto servicio se debe',
}

const fmt = (n: number) => new Intl.NumberFormat('es-DO').format(n)

/** A dónde lleva cada tramo del reparto: la lista de esas personas, ya filtrada. */
const ENLACE_TRAMO: Record<string, string | null> = {
  '0-7': null,
  '8-15': null,
  '16-30': '/admin/riesgo?sinVisitas=15&vence=0',
  '31-60': '/admin/riesgo?sinVisitas=30&vence=0',
  '60+': '/admin/riesgo?sinVisitas=60&vence=0',
  nunca: '/admin/riesgo?sinVisitas=90&vence=0',
}

/**
 * RETENCIÓN Y CONSUMO (auditoría · C-12 y bloque 2 §12-13).
 *
 * Reportes contaba lo que ENTRA: ingresos, operaciones, clientes nuevos. Nada
 * contaba lo que se va, ni lo que se debe. Esta pantalla responde las tres
 * preguntas que faltaban, y cada número lleva a la lista de personas que hay
 * detrás — un porcentaje del que no se puede salir es un dato para mirar, no
 * para trabajar.
 */
export default async function RetencionPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)
  if (!companyId) return <SinEmpresaActiva seccion="el reporte de retención" />

  const [r, prefs, umbrales] = await Promise.all([
    getRetencion(companyId),
    getRegionalPrefs(companyId),
    getUmbralesRetencion(companyId),
  ])
  const dinero = (n: number) => formatMoney(n, prefs)

  const tasaRenovacion =
    r.vencidas > 0 ? Math.round((r.renovadas / r.vencidas) * 100) : null
  const maxTramo = Math.max(1, ...r.inactividad.map((t) => t.clientes))

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Analítica"
        title="Retención y consumo"
        description="Quién se está enfriando, cuántos vuelven al vencer, y cuánto servicio pagado sigue sin prestarse."
      />

      {/* ── Enfriamiento ────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader
          title="Hace cuánto que no vienen"
          description={`Los ${fmt(r.totalVigentes)} clientes con membresía vigente, repartidos por su última visita.`}
        />
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
          <ul className="divide-y divide-border/50">
            {r.inactividad.map((t) => {
              const enlace = ENLACE_TRAMO[t.clave]
              const pct = Math.round((t.clientes / maxTramo) * 100)
              const frio = t.clave === '60+' || t.clave === 'nunca'
              return (
                <li key={t.clave} className="flex items-center gap-4 px-4 py-3">
                  <span className="w-44 shrink-0 text-sm text-foreground">{t.label}</span>
                  {/* La barra es comparativa dentro de la propia tabla: importa
                      ver dónde se acumula la gente, no el porcentaje exacto. */}
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className={`block h-full rounded-full ${frio ? 'bg-destructive' : 'bg-primary'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="w-16 shrink-0 text-right text-h4 tabular-nums text-foreground">
                    {fmt(t.clientes)}
                  </span>
                  <span className="w-8 shrink-0">
                    {enlace && t.clientes > 0 && (
                      <Link
                        href={enlace}
                        title={`Ver los ${t.clientes} clientes de este tramo`}
                        aria-label={`Ver los ${t.clientes} clientes de ${t.label}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      {/* ── Renovación y pasivo ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader title="Lo que decide si el negocio crece" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-h4">Renovación</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {r.vencidas === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No ha vencido ninguna membresía en los últimos {r.ventanaDias} días.
                </p>
              ) : (
                <>
                  <p className="text-h1 tabular-nums text-foreground">{tasaRenovacion}%</p>
                  <p className="text-sm text-muted-foreground">
                    {fmt(r.renovadas)} de {fmt(r.vencidas)} membresías vencidas en los últimos{' '}
                    {r.ventanaDias} días tienen hoy una membresía vigente.
                  </p>
                  <p className="text-caption">
                    Cuenta como renovación tanto reabrir la suya como comprar otra: desde el
                    negocio es la misma decisión — volvió.
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-h4">Servicio pagado sin prestar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-h1 tabular-nums text-foreground">{fmt(r.usosPendientes)}</p>
              <p className="text-sm text-muted-foreground">
                usos vivos, que valen <strong className="text-foreground">{dinero(r.valorPendiente)}</strong>.
              </p>
              {/* Esto es lo que más sorprende de esta pantalla, así que se dice
                  con todas las letras en vez de dejarlo a interpretación. */}
              <p className="text-caption">
                No es dinero por ganar: es un <strong>pasivo</strong>. Son servicios ya
                cobrados que el negocio todavía debe. Si vencen sin consumirse no se
                convierten en ingreso extra — se convierten en un cliente molesto.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/riesgo?usos=con&sinVisitas=30&vence=0">
                  Ver quién los tiene y no viene
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Umbrales ────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader
          title="Cuándo se considera que un cliente se está yendo"
          description="Estos números definen el semáforo que verás en la tabla de clientes, en su ficha y en el reporte de riesgo. También son los que usan los avisos automáticos."
        />
        <div className="rounded-2xl border border-border/70 bg-card p-5">
          <UmbralesRetencionForm umbrales={umbrales} />
        </div>
      </section>

      {/* ── Consumo por plan ────────────────────────────────────────────── */}
      {r.porPlan.length > 0 && (
        <section className="space-y-4">
          <SectionHeader
            title="Qué planes se usan"
            description="Un plan que casi no se consume no es un buen negocio: es un cliente que no vuelve y una renovación que no llega."
          />
          <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
            <table className="w-full">
              <thead className="border-b border-border/70 bg-muted/50">
                <tr className="text-overline">
                  <th className="px-4 py-3 text-left">Plan</th>
                  <th className="px-4 py-3 text-right">Membresías</th>
                  <th className="px-4 py-3 text-right">Usos vendidos</th>
                  <th className="px-4 py-3 text-right">Sin consumir</th>
                  <th className="px-4 py-3 text-right">Consumido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {r.porPlan.map((p) => (
                  <tr key={p.plan} className="text-sm">
                    <td className="px-4 py-3 font-medium text-foreground">{p.plan}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(p.membresias)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(p.usosIncluidos)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(p.usosRestantes)}</td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`tabular-nums font-semibold ${
                          p.consumido < 40 ? 'text-warning' : 'text-foreground'
                        }`}
                      >
                        {p.consumido}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
