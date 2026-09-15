import Link from 'next/link'
import { plural } from '@/lib/plural'
import type { Rango } from '@/modules/reportes/rango'
import type { ReporteMembresias } from '@/modules/reportes/membresias'
import { KpiReporte } from '@/components/reportes/KpiReporte'
import { ReporteImprimible } from '@/components/ui/reporte-imprimible'
import { SectionHeader } from '@/components/ui/section-header'
import { StatusBanner } from '@/components/ui/status-banner'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * CICLO DE VIDA DE LAS MEMBRESÍAS.
 *
 * Sin gráficas, y es una decisión, no una carencia: `ResponsiveContainer` de
 * Recharts sale en blanco en `@media print` —está documentado en
 * `docs/REPORTES.md`— y este reporte se imprime más de lo que se mira. Las
 * tablas dicen lo mismo, se imprimen bien y además son la alternativa textual
 * para un lector de pantalla.
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
  const detalle = (tipo: string) =>
    `/admin/reportes/membresias/detalle?tipo=${tipo}${qs ? `&${qs.slice(1)}` : ''}`

  const hayMovimiento =
    r.activadas.valor + r.renovadas.valor + r.canceladas.valor + r.vencidas.valor > 0
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

          <section>
            <SectionHeader title="Por plan" />
            <Tabla
              encabezados={['Plan', 'Activaciones', 'Renovaciones', 'Bajas']}
              filas={r.porPlan.map((p) => [
                p.plan,
                entero(p.activadas),
                entero(p.renovadas),
                entero(p.bajas),
              ])}
              vacio="Ningún plan tuvo movimiento en el periodo."
            />
          </section>

          {r.motivos.length > 0 && (
            <section>
              <SectionHeader
                title="Motivos de cancelación"
                description="Solo aparecen las cancelaciones donde se escribió un motivo."
              />
              <Tabla
                encabezados={['Motivo', 'Veces']}
                filas={r.motivos.map((m) => [m.motivo, entero(m.total)])}
                vacio=""
              />
            </section>
          )}

          <section>
            <SectionHeader title="Día a día" />
            <Tabla
              encabezados={['Día', 'Activaciones', 'Renovaciones', 'Bajas']}
              filas={r.serie
                .filter((p) => p.activadas + p.renovadas + p.bajas > 0)
                .map((p) => [p.dia, entero(p.activadas), entero(p.renovadas), entero(p.bajas)])}
              vacio="Sin movimiento diario en el periodo."
            />
          </section>
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

function Tabla({
  encabezados,
  filas,
  vacio,
}: {
  encabezados: string[]
  filas: string[][]
  vacio: string
}) {
  if (filas.length === 0) {
    return vacio ? <p className="text-small text-muted-foreground">{vacio}</p> : null
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-small">
        <thead>
          <tr className="border-b border-border text-left">
            {encabezados.map((h, i) => (
              <th
                key={h}
                className={`py-2 text-overline ${i === 0 ? '' : 'text-right tabular-nums'}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <tr key={fila.join('|')} className="border-b border-border/60">
              {fila.map((celda, i) => (
                <td
                  key={i}
                  className={`py-2 ${i === 0 ? 'text-foreground' : 'text-right tabular-nums text-foreground'}`}
                >
                  {celda}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
