import Link from 'next/link'
import { formatoEntero } from '@/modules/reportes/formato'
import { plural } from '@/lib/plural'
import type { Rango } from '@/modules/reportes/rango'
import { serieParaGrafico } from '@/modules/reportes/serie'
import type { ReporteMembresias } from '@/modules/reportes/membresias'
import { TablaReporte as Tabla } from '@/components/reportes/TablaReporte'
import { num } from '@/modules/reportes/tabla'
import { KpiReporte } from '@/components/reportes/KpiReporte'
import { ReporteImprimible } from '@/components/ui/reporte-imprimible'
import { PanelGrafico } from '@/components/reportes/graficos/PanelGrafico'
import { GraficoTendencia } from '@/components/reportes/graficos/GraficoTendencia'
import { GraficoRanking } from '@/components/reportes/graficos/GraficoRanking'
import { SectionHeader } from '@/components/ui/section-header'
import { StatusBanner } from '@/components/ui/status-banner'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * CICLO DE VIDA DE LAS MEMBRESÍAS.
 *
 * Durante mucho tiempo esta pantalla NO tuvo gráficas, y estaba escrito aquí
 * que era una decisión: `ResponsiveContainer` de Recharts sale en blanco en
 * `@media print`, y este reporte se imprime más de lo que se mira.
 *
 * El problema era real; la conclusión, ya no. `PanelGrafico` **exige** la tabla
 * equivalente además del gráfico, así que el papel sale con los mismos números
 * de siempre. Y aquí la forma importa de verdad: altas y bajas dibujadas juntas
 * enseñan en un vistazo si el mes creció o solo se movió, que es lo que dos
 * cifras sueltas no dicen. Las tablas no se han quitado de ningún sitio: están
 * dentro del panel.
 *
 * Cada cifra lleva su enlace al detalle. Un número que no se puede abrir hasta
 * las filas que lo producen no es un reporte: es una afirmación.
 */
export function ReporteMembresiasVista({
  r,
  rango,
  empresa,
  generadoEn,
  qs,
  eyebrow,
  controles,
}: {
  r: ReporteMembresias
  rango: Rango
  empresa: string
  generadoEn: string
  /** Query string del rango, para que el detalle abra con el mismo periodo. */
  qs: string
  eyebrow?: React.ReactNode
  controles?: React.ReactNode
}) {
  const entero = (n: number) => new Intl.NumberFormat('es-DO').format(n)
  const fEntero = formatoEntero(null)

  // La serie se pliega a la granularidad del periodo: un año en días son 365
  // barras y no se lee ninguna. Es una SUMA de los mismos días que ya venían de
  // la base, así que la semana nunca puede discrepar del día.
  const serie = serieParaGrafico(r.serie, rango.granularidad)
  const periodo = `${rango.desdeDia} a ${rango.hastaDia}`
  const detalle = (tipo: string) =>
    `/admin/reportes/membresias/detalle?tipo=${tipo}${qs ? `&${qs.slice(1)}` : ''}`

  const hayMovimiento =
    r.activadas.valor +
      r.renovadas.valor +
      r.canceladas.valor +
      r.vencidas.valor +
      r.creadas.valor +
      r.rechazadas.valor +
      r.ajustadas.valor >
    0
  const cambios = r.cambiosDePlan
  const totalCambios = cambios.subida + cambios.bajada + cambios.lateral + cambios.desconocido

  return (
    <ReporteImprimible
      titulo={`Ciclo de vida de membresías · ${empresa}`}
      subtitulo={`${rango.etiqueta} · ${rango.desdeDia} a ${rango.hastaDia} (${plural(rango.dias, 'día', 'días')}) · vs. ${rango.etiquetaComparacion.toLowerCase()}`}
      generadoEn={generadoEn}
      controles={controles}
      pie={
        <>
          Estas cifras salen de los eventos de cada membresía, no de su estado actual: una
          membresía renovada tres veces sigue siendo una sola fila activa, y por eso el estado
          nunca podría responder «cuántas se renovaron este mes».
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

      {r.corte.rangoIncompleto && (
        <StatusBanner variant="info" title="Parte de este periodo es anterior al registro">
          {r.corte.desdeDia
            ? `El historial completo empieza el ${r.corte.desdeDia}. Antes de esa fecha solo existe lo que se pudo reconstruir de la bitácora —renovaciones y cancelaciones—, así que las activaciones y los cambios de plan de ese tramo aparecen en cero sin haberlo estado.`
            : 'Todavía no hay eventos registrados por el camino normal. Lo que se vea aquí procede del histórico reconstruido, que no cubre activaciones ni cambios de plan.'}
        </StatusBanner>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
        <KpiReporte label="Activaciones" kpi={r.activadas} formato={entero} />
        <KpiReporte label="Renovaciones" kpi={r.renovadas} formato={entero} />
        <KpiReporte label="Cancelaciones" kpi={r.canceladas} formato={entero} invertido />
        <KpiReporte label="Vencimientos" kpi={r.vencidas} formato={entero} invertido />
      </div>

      {/* El RESTO del ciclo, que la tabla ya guardaba y el reporte callaba:
          nacimientos pendientes, pagos rechazados y ajustes manuales (vigencia
          extendida, lavados corregidos). */}
      <div className="grid gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
        <KpiReporte label="Creadas (pendientes de pago)" kpi={r.creadas} formato={entero} />
        <KpiReporte label="Pagos rechazados" kpi={r.rechazadas} formato={entero} invertido />
        <KpiReporte label="Ajustes manuales" kpi={r.ajustadas} formato={entero} />
      </div>

      {/* El detalle no puede vivir escondido en una nota al pie: es LA pantalla
          que responde «¿cuándo, a quién y quién lo hizo?». */}
      <div className="print:hidden">
        <Link
          href={detalle('RENOVADA')}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-small font-semibold text-primary hover:bg-muted/40"
        >
          Ver el detalle evento por evento: quién, cuándo y por qué →
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2 print:gap-2">
        <div className="rounded-xl border border-border bg-card p-5 print:border-black print:p-2">
          <p className="text-overline">Tasa de renovación</p>
          <p className="mt-1.5 text-h1 tabular-nums text-foreground print:text-base print:font-bold">
            {r.tasaRenovacion == null ? 'Sin dato' : `${r.tasaRenovacion} %`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {r.tasaRenovacion == null
              ? 'No hubo renovaciones ni bajas en el periodo'
              : 'Renovaciones ÷ (renovaciones + bajas)'}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 print:border-black print:p-2">
          <p className="text-overline">Renovaciones automáticas</p>
          <p className="mt-1.5 text-h1 tabular-nums text-foreground print:text-base print:font-bold">
            {entero(r.renovadasAutomaticas)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cobradas por el sistema con la tarjeta guardada, sin que nadie las pidiera
          </p>
        </div>
      </div>

      {!hayMovimiento ? (
        <EmptyState
          title="Sin movimiento en este periodo"
          description="No se activó, renovó, canceló ni venció ninguna membresía en las fechas elegidas."
        />
      ) : (
        <>
          <section>
            <SectionHeader
              title="Cambios de plan"
              description={
                totalCambios === 0
                  ? 'Nadie cambió de plan en este periodo.'
                  : 'La subida o bajada se decide con los precios del momento del cambio, no con los de hoy.'
              }
            />
            {totalCambios > 0 && (
              <div className="grid gap-3 sm:grid-cols-4 print:grid-cols-4">
                <Celda label="Subieron" valor={entero(cambios.subida)} />
                <Celda label="Bajaron" valor={entero(cambios.bajada)} />
                <Celda label="Mismo precio" valor={entero(cambios.lateral)} />
                <Celda
                  label="Sin precio guardado"
                  valor={entero(cambios.desconocido)}
                  nota="No se puede clasificar"
                />
              </div>
            )}
          </section>

          <PanelGrafico
            titulo="Qué planes se mueven"
            pregunta="¿Dónde está pasando el ciclo de vida?"
            periodo={periodo}
            nota="La barra mide activaciones MÁS renovaciones —el movimiento de entrada—, que es el mismo orden en el que el motor devuelve la tabla. Las bajas no se restan de la barra: van en su columna, porque un plan con mucho movimiento en los dos sentidos no es lo mismo que uno tranquilo."
            grafico={
              <GraficoRanking
                filas={r.porPlan.map((p) => ({
                  nombre: p.plan,
                  valor: p.activadas + p.renovadas,
                }))}
                formato={fEntero}
              />
            }
            tabla={
              <Tabla
                encabezados={['Plan', 'Activaciones', 'Renovaciones', 'Bajas']}
                filas={r.porPlan.map((p) => [
                  p.plan,
                  num(p.activadas, entero(p.activadas)),
                  num(p.renovadas, entero(p.renovadas)),
                  num(p.bajas, entero(p.bajas)),
                ])}
                vacio="Ningún plan tuvo movimiento en el periodo."
              />
            }
          />

          {r.motivos.length > 0 && (
            <section>
              <SectionHeader
                title="Motivos de cancelación"
                description="Solo aparecen las cancelaciones donde se escribió un motivo."
              />
              <Tabla
                encabezados={['Motivo', 'Veces']}
                filas={r.motivos.map((m) => [m.motivo, num(m.total, entero(m.total))])}
                vacio=""
              />
            </section>
          )}

          <PanelGrafico
            titulo="Altas y bajas, día a día"
            pregunta="¿El mes creció, o solo se movió?"
            periodo={periodo}
            nota="La línea punteada son las bajas —canceladas y vencidas juntas—. Cuando se acerca a la de altas, el negocio está reponiendo, no creciendo. Las renovaciones no entran en el dibujo porque no cambian el tamaño de la base: van en la tabla."
            grafico={
              <GraficoTendencia
                datos={serie.map((p) => ({ dia: p.dia, valor: p.activadas, anterior: p.bajas }))}
                etiqueta="Activaciones"
                etiquetaAnterior="Bajas"
                formato={fEntero}
              />
            }
            tabla={
              <Tabla
                encabezados={['Día', 'Activaciones', 'Renovaciones', 'Bajas']}
                filas={serie
                  .filter((p) => p.activadas + p.renovadas + p.bajas > 0)
                  .map((p) => [
                    p.dia,
                    num(p.activadas, entero(p.activadas)),
                    num(p.renovadas, entero(p.renovadas)),
                    num(p.bajas, entero(p.bajas)),
                  ])}
                vacio="Sin movimiento diario en el periodo."
              />
            }
          />
        </>
      )}

      <p className="print:hidden text-caption text-muted-foreground">
        Abre el detalle de cada cifra:{' '}
        <Link href={detalle('ACTIVADA')} className="underline">
          activaciones
        </Link>
        {' · '}
        <Link href={detalle('RENOVADA')} className="underline">
          renovaciones
        </Link>
        {' · '}
        <Link href={detalle('CANCELADA')} className="underline">
          cancelaciones
        </Link>
        {' · '}
        <Link href={detalle('VENCIDA')} className="underline">
          vencimientos
        </Link>
        {' · '}
        <Link href={detalle('CAMBIO_PLAN')} className="underline">
          cambios de plan
        </Link>
        {' · '}
        <Link href={detalle('AJUSTADA')} className="underline">
          ajustes
        </Link>
        {' · '}
        <Link href={detalle('CREADA')} className="underline">
          creadas
        </Link>
        {' · '}
        <Link href={detalle('RECHAZADA')} className="underline">
          rechazadas
        </Link>
      </p>
    </ReporteImprimible>
  )
}

function Celda({ label, valor, nota }: { label: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 print:border-black print:p-2">
      <p className="text-overline">{label}</p>
      <p className="mt-1 text-h3 tabular-nums text-foreground">{valor}</p>
      {nota && <p className="mt-0.5 text-caption text-muted-foreground">{nota}</p>}
    </div>
  )
}
