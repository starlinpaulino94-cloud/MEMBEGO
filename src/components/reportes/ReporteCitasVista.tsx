import Link from 'next/link'
import { plural } from '@/lib/plural'
import type { Rango } from '@/modules/reportes/rango'
import { serieParaGrafico } from '@/modules/reportes/serie'
import type { FilaCitas, ReporteCitas } from '@/modules/reportes/citas'
import { TablaReporte as Tabla } from '@/components/reportes/TablaReporte'
import { num } from '@/modules/reportes/tabla'
import { KpiReporte } from '@/components/reportes/KpiReporte'
import { PanelGrafico } from '@/components/reportes/graficos/PanelGrafico'
import { GraficoTendencia } from '@/components/reportes/graficos/GraficoTendencia'
import { GraficoRanking } from '@/components/reportes/graficos/GraficoRanking'
import { ReporteImprimible } from '@/components/ui/reporte-imprimible'
import { SectionHeader } from '@/components/ui/section-header'
import { StatusBanner } from '@/components/ui/status-banner'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * CITAS.
 *
 * Durante mucho tiempo esta pantalla NO tuvo gráficas, y estaba escrito aquí
 * que era una decisión: `ResponsiveContainer` de Recharts sale en blanco en
 * `@media print`, y este reporte se imprime para cuadrar la agenda.
 *
 * El problema era real; la conclusión, ya no. `PanelGrafico` **exige** la tabla
 * equivalente además del gráfico, así que el papel sale con los mismos números
 * de siempre y la pantalla gana lo que una columna de cifras no enseña: si las
 * canceladas suben en un día concreto o están repartidas por igual. Las tablas
 * no se han quitado de ningún sitio —están dentro del panel— y siguen siendo la
 * alternativa textual para un lector de pantalla.
 *
 * El aviso de que el estado es el de HOY se imprime a propósito y va ARRIBA:
 * es la única forma de que quien lea el papel dentro de un mes sepa qué está
 * leyendo. Un reporte de citas sin esa línea se lee como si dijera cuándo se
 * canceló cada una, que es justo lo que no puede decir.
 */
export function ReporteCitasVista({
  r,
  rango,
  empresa,
  generadoEn,
  qs,
  eyebrow,
  controles,
}: {
  r: ReporteCitas
  rango: Rango
  empresa: string
  generadoEn: string
  /** Query string del periodo y del filtro, para que el detalle abra igual. */
  qs?: string
  eyebrow?: React.ReactNode
  controles?: React.ReactNode
}) {
  const entero = (n: number) => new Intl.NumberFormat('es-DO').format(n)
  const periodo = `${rango.desdeDia} a ${rango.hastaDia}`

  // La serie se pliega a la granularidad del periodo: un año en días son 365
  // barras y no se lee ninguna. Es una SUMA de los mismos días que ya venían de
  // la base, así que la semana nunca puede discrepar del día.
  const serie = serieParaGrafico(r.serie, rango.granularidad)
  const detalle = (vista: string) =>
    `/admin/reportes/citas/detalle?vista=${vista}${qs ? `&${qs}` : ''}`
  const totalCancela =
    r.quienCancela.cliente + r.quienCancela.negocio + r.quienCancela.sinRegistrar

  return (
    <ReporteImprimible
      titulo={`Citas · ${empresa}`}
      subtitulo={`${rango.etiqueta} · ${rango.desdeDia} a ${rango.hastaDia} (${plural(rango.dias, 'día', 'días')}) · vs. ${rango.etiquetaComparacion.toLowerCase()}`}
      generadoEn={generadoEn}
      controles={controles}
      pie={
        <>
          Las citas se cuentan por el día en que ESTABAN AGENDADAS. «Reservadas en el periodo» es
          la otra pregunta —cuántas se pidieron— y por eso va en su propia cifra: una reserva de
          hoy para el mes que viene no es una cita de hoy.
        </>
      }
    >
      {eyebrow && <div className="print:hidden">{eyebrow}</div>}

      {/* SE IMPRIME. Un papel con estas cifras y sin esta línea se lee como si
          dijera cuándo se canceló cada cita, que es lo que no puede decir. */}
      <StatusBanner variant="info" title="El estado es el de hoy, no el del día de la cita">
        La tabla de citas guarda en qué estado está cada una, pero no cuándo cambió. Una cita del
        3 de marzo que se canceló el 10 de abril aparece como cancelada en el reporte de marzo.
        Este reporte dice cómo quedó la agenda de un periodo; no dice cuántas se cancelaron esa
        semana.
      </StatusBanner>

      {r.incompleto && (
        <StatusBanner variant="warning" title="El reporte está incompleto">
          Alguna consulta no respondió, así que hay cifras que pueden estar en cero sin serlo.
          Recarga en unos segundos antes de tomar decisiones con estos números.
        </StatusBanner>
      )}

      {r.filtro && (
        <p className="rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-small text-foreground print:border-black">
          <span className="font-semibold">Filtrado:</span> solo{' '}
          {[
            r.filtro.sucursal && `la sucursal «${r.filtro.sucursal.nombre}»`,
            r.filtro.servicio && `el servicio «${r.filtro.servicio}»`,
          ]
            .filter(Boolean)
            .join(' y ')}
          . Todas las cifras, la comparación y el día a día llevan el recorte.
        </p>
      )}

      {r.porConfirmar > 0 && (
        <StatusBanner
          variant="warning"
          title={`${r.porConfirmar} ${plural(r.porConfirmar, 'cita pendiente', 'citas pendientes')} de confirmar`}
        >
          Son citas que un cliente ya reservó para una hora que todavía no llega y que el negocio
          no ha confirmado. No depende del periodo elegido: una cita sin confirmar para el jueves
          es un problema hoy, se esté mirando el mes que se esté mirando.{' '}
          <Link href={detalle('POR_CONFIRMAR')} className="print:hidden font-semibold underline">
            Ver cuáles son
          </Link>
        </StatusBanner>
      )}

      {r.sinCerrar > 0 && (
        <StatusBanner
          variant="warning"
          title={`${r.sinCerrar} ${plural(r.sinCerrar, 'cita ya pasó', 'citas ya pasaron')} sin cerrar`}
        >
          Su hora venció y nadie las marcó como completadas ni como no-asistió, así que no entran
          en la tasa de asistencia. Mientras queden muchas sin cerrar, esa tasa mide solo la parte
          de la agenda que sí se cierra.{' '}
          <Link href={detalle('SIN_CERRAR')} className="print:hidden font-semibold underline">
            Ver cuáles son
          </Link>
        </StatusBanner>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
        <KpiReporte label="Citas agendadas" kpi={r.agendadas} formato={entero} />
        <KpiReporte label="Completadas" kpi={r.completadas} formato={entero} />
        <KpiReporte label="Canceladas" kpi={r.canceladas} formato={entero} invertido />
        <KpiReporte label="No asistió" kpi={r.noAsistio} formato={entero} invertido />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
        <div className="rounded-xl border border-border bg-card p-5 print:border-black print:p-2">
          <p className="text-overline">Tasa de asistencia</p>
          <p className="mt-1.5 text-h1 tabular-nums text-foreground print:text-base print:font-bold">
            {r.tasaAsistencia == null ? 'Sin dato' : `${r.tasaAsistencia} %`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {r.tasaAsistencia == null
              ? 'Ninguna cita del periodo se cerró todavía'
              : 'Completadas ÷ (completadas + no asistió)'}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 print:border-black print:p-2">
          <p className="text-overline">Tasa de cancelación</p>
          <p className="mt-1.5 text-h1 tabular-nums text-foreground print:text-base print:font-bold">
            {r.tasaCancelacion == null ? 'Sin dato' : `${r.tasaCancelacion} %`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {r.tasaCancelacion == null
              ? 'No hubo citas agendadas en el periodo'
              : 'Canceladas ÷ agendadas'}
          </p>
        </div>
        <Celda
          label="Reservadas en el periodo"
          valor={entero(r.reservadas.valor)}
          nota="Cuándo se pidieron, no cuándo eran"
        />
        <Celda
          label="Todavía abiertas"
          valor={entero(r.abiertas)}
          nota="Pendientes o confirmadas, sin cerrar"
        />
      </div>

      {/* El detalle no puede vivir escondido: es LA pantalla que responde «¿a
          quién se le canceló, cuándo y por qué?». Un número que no se puede
          abrir hasta sus filas es una afirmación, no un reporte. */}
      <div className="print:hidden">
        <Link
          href={detalle('TODAS')}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-small font-semibold text-primary hover:bg-muted/40"
        >
          Ver el detalle cita por cita: quién, cuándo y en qué quedó →
        </Link>
      </div>

      {r.agendadas.valor === 0 ? (
        <EmptyState
          title="Sin citas en este periodo"
          description="No había ninguna cita agendada en las fechas elegidas."
        />
      ) : (
        <>
          <section>
            <SectionHeader
              title="Quién cancela"
              description="De las canceladas del periodo. Distinguirlo importa: que cancele el cliente y que cancele el negocio son dos problemas distintos."
            />
            {totalCancela === 0 ? (
              <p className="text-small text-muted-foreground">
                No se canceló ninguna cita del periodo.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3 print:grid-cols-3">
                <Celda label="Canceló el cliente" valor={entero(r.quienCancela.cliente)} />
                <Celda label="Canceló el negocio" valor={entero(r.quienCancela.negocio)} />
                <Celda
                  label="Sin registrar"
                  valor={entero(r.quienCancela.sinRegistrar)}
                  nota="No se guardó quién"
                />
              </div>
            )}
          </section>

          {r.motivosCancelacion.length > 0 && (
            <section>
              <SectionHeader
                title="Motivos de cancelación"
                description="Solo aparecen las cancelaciones donde se escribió un motivo. El cliente cancela sin motivo desde su panel, así que estos son casi siempre del negocio."
              />
              <Tabla
                encabezados={['Motivo', 'Veces']}
                filas={r.motivosCancelacion.map((m) => [m.motivo, num(m.total, entero(m.total))])}
                vacio=""
              />
            </section>
          )}

          {/* La sucursal empezó a guardarse el día que la reserva la pidió;
              las citas anteriores caen en «(sin asignar)» y no se esconden,
              porque esconderlas rompería la suma de los subtotales. */}
          <section>
            <SectionHeader
              title="Por sucursal"
              description="Dónde se atiende cada cita. Las reservadas antes de que la app preguntara por la sucursal salen como «(sin asignar)»: no se rellenan hacia atrás porque no hay de dónde sacarlo, y con el tiempo esa fila se vacía sola."
            />
            <TablaCitas filas={r.porSucursal} columna="Sucursal" entero={entero} />
          </section>

          <PanelGrafico
            titulo="Qué se pide"
            pregunta="¿Qué servicios llenan la agenda?"
            periodo={periodo}
            nota="Ordenado por citas agendadas, que es la demanda. Un servicio muy agendado y poco completado se ve en la tabla, no en la barra."
            grafico={
              <GraficoRanking
                filas={r.porServicio.map((f) => ({ nombre: f.nombre, valor: f.agendadas }))}
                formato={entero}
              />
            }
            tabla={<TablaCitas filas={r.porServicio} columna="Servicio" entero={entero} />}
          />

          <section>
            <SectionHeader
              title="Quién atendió"
              description="Solo las citas completadas registran a la persona que atendió, así que el resto cae en «(sin asignar)». No es una medida de ritmo ni un ranking."
            />
            {r.porEmpleado === null ? (
              <p className="text-small text-muted-foreground">
                Tu cuenta no tiene permiso para ver el desglose por persona. El resto del reporte
                no cambia: las cifras de arriba ya los incluyen a todos.
              </p>
            ) : (
              <TablaCitas filas={r.porEmpleado} columna="Atendió" entero={entero} />
            )}
          </section>

          <PanelGrafico
            titulo="La agenda, día a día"
            pregunta="¿Se está llenando la agenda, y se está cumpliendo?"
            periodo={periodo}
            nota="La línea punteada son las completadas. El hueco entre las dos líneas son canceladas, no-asistió y las que siguen abiertas: la tabla las separa una por una."
            grafico={
              <GraficoTendencia
                datos={serie.map((p) => ({
                  dia: p.dia,
                  valor: p.agendadas,
                  anterior: p.completadas,
                }))}
                etiqueta="Agendadas"
                etiquetaAnterior="Completadas"
                formato={entero}
              />
            }
            tabla={
              <Tabla
                encabezados={['Día', 'Agendadas', 'Completadas', 'Canceladas', 'No asistió']}
                filas={serie
                  .filter((p) => p.agendadas > 0)
                  .map((p) => [
                    p.dia,
                    num(p.agendadas, entero(p.agendadas)),
                    num(p.completadas, entero(p.completadas)),
                    num(p.canceladas, entero(p.canceladas)),
                    num(p.noAsistio, entero(p.noAsistio)),
                  ])}
                vacio="Sin citas diarias en el periodo."
              />
            }
          />

          <p className="print:hidden text-caption text-muted-foreground">
            Abre el detalle de cada cifra:{' '}
            <Link href={detalle('TODAS')} className="underline">
              agendadas
            </Link>
            {' · '}
            <Link href={detalle('COMPLETADAS')} className="underline">
              completadas
            </Link>
            {' · '}
            <Link href={detalle('CANCELADAS')} className="underline">
              canceladas
            </Link>
            {' · '}
            <Link href={detalle('NO_ASISTIO')} className="underline">
              no asistió
            </Link>
            {' · '}
            <Link href={detalle('ABIERTAS')} className="underline">
              todavía abiertas
            </Link>
            {' · '}
            <Link href={detalle('RESERVADAS')} className="underline">
              reservadas en el periodo
            </Link>
          </p>
        </>
      )}
    </ReporteImprimible>
  )
}

function TablaCitas({
  filas,
  columna,
  entero,
}: {
  filas: FilaCitas[]
  columna: string
  entero: (n: number) => string
}) {
  return (
    <Tabla
      encabezados={[columna, 'Agendadas', 'Completadas', 'Canceladas', 'No asistió']}
      filas={filas.map((f) => [
        f.nombre,
        num(f.agendadas, entero(f.agendadas)),
        num(f.completadas, entero(f.completadas)),
        num(f.canceladas, entero(f.canceladas)),
        num(f.noAsistio, entero(f.noAsistio)),
      ])}
      vacio="Sin citas en el periodo."
    />
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
