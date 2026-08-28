import { formatMoney, type RegionalPrefs } from '@/lib/format'
import { plural } from '@/lib/plural'
import type { Rango } from '@/modules/reportes/rango'
import { calcularInsights } from '@/modules/reportes/insights'
import { TIPO_TX_LABEL, METODO_LABEL, type Reporte } from '@/modules/reportes/queries'
import { KpiReporte } from '@/components/reportes/KpiReporte'
import { ReporteImprimible, TablaReporte } from '@/components/ui/reporte-imprimible'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SectionHeader } from '@/components/ui/section-header'
import { StatusBanner } from '@/components/ui/status-banner'
import { ReporteChart } from '@/components/charts/ReporteChart'
import { Lightbulb } from 'lucide-react'

/**
 * EL REPORTE DE UNA EMPRESA, montado en dos sitios.
 *
 * Lo ve el dueño del negocio en `/admin/reportes` y el superadmin en
 * `/superadmin/reportes/[id]`. Es literalmente el mismo reporte, así que es el
 * mismo componente: si fueran dos copias, la próxima corrección entraría en una
 * y el superadmin y el cliente discutirían sobre cifras distintas del mismo
 * negocio — que es exactamente el problema que este módulo venía arrastrando.
 *
 * Lo único que cambia entre los dos montajes es la cabecera y los enlaces, que
 * llegan por props.
 */
export function ReporteEmpresaVista({
  reporte: r,
  rango,
  prefs,
  empresa,
  eyebrow,
  controles,
  generadoEn,
}: {
  reporte: Reporte
  rango: Rango
  prefs: RegionalPrefs | null
  /** Nombre del negocio. Va en el papel: una hoja suelta tiene que decir de quién es. */
  empresa: string
  eyebrow?: React.ReactNode
  controles?: React.ReactNode
  generadoEn: string
}) {
  const dinero = (n: number) => formatMoney(n, prefs)
  const entero = (n: number) => new Intl.NumberFormat(prefs?.idioma || 'es-DO').format(n)
  const insights = calcularInsights(r)
  const hayActividad = r.serie.some((p) => p.ventas > 0 || p.entregas > 0)

  return (
    <ReporteImprimible
      titulo={`Reportes · ${empresa}`}
      subtitulo={`${rango.etiqueta} · ${rango.desdeDia} a ${rango.hastaDia} (${plural(rango.dias, 'día', 'días')})`}
      generadoEn={generadoEn}
      controles={controles}
      pie={
        <>
          Los ingresos de caja y los cobros de membresías se muestran por separado a propósito:
          son dinero que entra por caminos distintos y sumarlos en una sola cifra impediría
          cuadrar el reporte con la caja del día.
        </>
      }
    >
      {eyebrow && <div className="print:hidden">{eyebrow}</div>}

      {r.incompleto && (
        <StatusBanner variant="warning" title="El reporte está incompleto">
          Alguna consulta no respondió, así que hay cifras que pueden estar en cero sin serlo.
          Recarga en unos segundos antes de tomar decisiones con estos números.
        </StatusBanner>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 print:grid-cols-5 print:gap-2">
        <KpiReporte label="Ingresos de caja" kpi={r.ingresosCaja} formato={dinero} />
        <KpiReporte label="Cobros de membresías" kpi={r.ingresosMembresias} formato={dinero} />
        <KpiReporte label="Ventas" kpi={r.operaciones} formato={entero} />
        <KpiReporte label="Entregas sin cobro" kpi={r.entregas} formato={entero} />
        <KpiReporte label="Clientes nuevos" kpi={r.clientesNuevos} formato={entero} />
      </div>

      {insights.length > 0 && (
        <section>
          <SectionHeader title="Qué dicen estos números" />
          <ul className="space-y-2">
            {insights.map((i) => (
              <li
                key={i.texto}
                className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-4 print:border-black print:p-2"
              >
                <Lightbulb
                  className={`print:hidden mt-0.5 h-5 w-5 shrink-0 ${
                    i.tono === 'bueno'
                      ? 'text-success'
                      : i.tono === 'malo'
                        ? 'text-warning'
                        : 'text-primary'
                  }`}
                  aria-hidden
                />
                <p className="text-small text-foreground print:text-xs">{i.texto}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Card className="print:border-black">
        <CardHeader>
          <CardTitle className="text-h4">Actividad por día</CardTitle>
        </CardHeader>
        <CardContent>
          {hayActividad ? (
            <>
              {/* LA GRÁFICA NO IMPRIME. `ResponsiveContainer` de Recharts mide
                  el contenedor al pintar; en `@media print` el navegador
                  reordena el layout y la barra sale en blanco o cortada. En vez
                  de dejar un hueco en el papel, la misma información va como
                  tabla — que además es la alternativa textual que la gráfica
                  nunca tuvo para un lector de pantalla. */}
              <div className="print:hidden">
                <ReporteChart data={r.serie} />
              </div>
              <div className="hidden print:block">
                <TablaReporte
                  titulo="Actividad por día"
                  columnas={[
                    { clave: 'dia', titulo: 'Día' },
                    { clave: 'ventas', titulo: 'Ventas', alinearDerecha: true },
                    { clave: 'entregas', titulo: 'Entregas', alinearDerecha: true },
                    { clave: 'ingresos', titulo: 'Ingresos de caja', alinearDerecha: true },
                  ]}
                  // Solo los días con algo: en papel, treinta filas de ceros
                  // gastan una hoja para no decir nada.
                  filas={r.serie
                    .filter((p) => p.ventas > 0 || p.entregas > 0 || p.ingresos > 0)
                    .map((p) => ({
                      __clave: p.dia,
                      dia: p.dia,
                      ventas: entero(p.ventas),
                      entregas: entero(p.entregas),
                      ingresos: dinero(p.ingresos),
                    }))}
                />
              </div>
            </>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Sin operaciones registradas en este periodo.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-2 print:gap-3">
        <Card className="print:border-black">
          <CardHeader>
            <CardTitle className="text-h4">Operaciones por tipo</CardTitle>
          </CardHeader>
          <CardContent>
            <TablaReporte
              vacio="Sin operaciones en el periodo."
              columnas={[
                { clave: 'tipo', titulo: 'Tipo' },
                { clave: 'operaciones', titulo: 'Operaciones', alinearDerecha: true },
                { clave: 'ingresos', titulo: 'Ingresos', alinearDerecha: true },
              ]}
              filas={r.porTipo.map((t) => ({
                __clave: t.tipo,
                tipo: TIPO_TX_LABEL[t.tipo] ?? t.tipo,
                operaciones: entero(t.operaciones),
                ingresos: t.ingresos > 0 ? dinero(t.ingresos) : '—',
              }))}
            />
          </CardContent>
        </Card>

        <Card className="print:border-black">
          <CardHeader>
            <CardTitle className="text-h4">Cómo pagaron</CardTitle>
          </CardHeader>
          <CardContent>
            <TablaReporte
              vacio="Sin cobros registrados en el periodo."
              columnas={[
                { clave: 'metodo', titulo: 'Método' },
                { clave: 'ingresos', titulo: 'Ingresos', alinearDerecha: true },
                { clave: 'operaciones', titulo: 'Operaciones', alinearDerecha: true },
              ]}
              filas={r.porMetodo.map((m) => ({
                __clave: m.metodo,
                metodo: METODO_LABEL[m.metodo] ?? m.metodo,
                ingresos: dinero(m.ingresos),
                operaciones: entero(m.operaciones),
              }))}
            />
          </CardContent>
        </Card>

        <Card className="print:border-black">
          <CardHeader>
            <CardTitle className="text-h4">Clientes más activos</CardTitle>
          </CardHeader>
          <CardContent>
            <TablaReporte
              vacio="Sin visitas registradas."
              columnas={[
                { clave: 'nombre', titulo: 'Cliente' },
                { clave: 'operaciones', titulo: 'Operaciones', alinearDerecha: true },
              ]}
              filas={r.topClientes.map((c, i) => ({
                __clave: `${c.nombre}-${i}`,
                nombre: <span className="block truncate">{c.nombre}</span>,
                operaciones: entero(c.operaciones),
              }))}
            />
          </CardContent>
        </Card>

        <Card className="print:border-black">
          <CardHeader>
            <CardTitle className="text-h4">Membresías activas por plan</CardTitle>
            <p className="text-xs text-muted-foreground">
              Foto de hoy: no depende del periodo elegido.
            </p>
          </CardHeader>
          <CardContent>
            <TablaReporte
              vacio="Sin membresías activas."
              columnas={[
                { clave: 'plan', titulo: 'Plan' },
                { clave: 'count', titulo: 'Activas', alinearDerecha: true },
              ]}
              filas={r.activasPorPlan.map((p) => ({
                __clave: p.plan,
                plan: <span className="block truncate">{p.plan}</span>,
                count: entero(p.count),
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </ReporteImprimible>
  )
}
