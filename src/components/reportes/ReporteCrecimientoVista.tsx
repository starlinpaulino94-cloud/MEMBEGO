import type { RegionalPrefs } from '@/lib/format'
import { plural } from '@/lib/plural'
import type { Rango } from '@/modules/reportes/rango'
import {
  FUERA_DEL_EMBUDO,
  type FilaCanal,
  type FilaCampana,
  type ReporteCrecimiento,
} from '@/modules/reportes/crecimiento'
import { KpiReporte } from '@/components/reportes/KpiReporte'
import { PanelGrafico } from '@/components/reportes/graficos/PanelGrafico'
import { GraficoTendencia } from '@/components/reportes/graficos/GraficoTendencia'
import { GraficoRanking } from '@/components/reportes/graficos/GraficoRanking'
import { ReporteImprimible } from '@/components/ui/reporte-imprimible'
import { SectionHeader } from '@/components/ui/section-header'
import { StatusBanner } from '@/components/ui/status-banner'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * CRECIMIENTO.
 *
 * El orden es el argumento: primero cuánta gente entró por una invitación y
 * cuánta se quedó, después DÓNDE SE CAE —que es lo único que se puede
 * arreglar—, y al final lo que rodea al embudo: quién invita, qué enlaces
 * siguen vivos, qué apartó el antifraude y qué se premió.
 *
 * La pantalla cierra con lo que el reporte NO cuenta. No es humildad: es que
 * una etapa ausente se lee como un cero, y un cero es una afirmación sobre el
 * negocio. Si algún día `PRIMER_USO` empieza a escribirse, esa lista se vacía
 * sola y la etapa aparece arriba.
 */
export function ReporteCrecimientoVista({
  r,
  rango,
  prefs,
  empresa,
  generadoEn,
  hrefClientes,
  eyebrow,
  controles,
}: {
  r: ReporteCrecimiento
  rango: Rango
  prefs: RegionalPrefs | null
  empresa: string
  generadoEn: string
  /** El reporte de clientes, con el MISMO periodo: de ahí se investiga un alta. */
  hrefClientes?: string
  eyebrow?: React.ReactNode
  controles?: React.ReactNode
}) {
  const entero = (n: number) => new Intl.NumberFormat(prefs?.idioma || 'es-DO').format(n)
  const periodo = `${rango.desdeDia} a ${rango.hastaDia}`

  const primeraEtapa = r.embudo[0]?.eventos ?? 0
  const topeEmbudo = Math.max(...r.embudo.map((e) => e.eventos), 1)
  const canalesConClics = [...r.porCanal].sort((a, b) => b.clics - a.clics).slice(0, 8)

  return (
    <ReporteImprimible
      titulo={`Crecimiento · ${empresa}`}
      subtitulo={`${rango.etiqueta} · ${rango.desdeDia} a ${rango.hastaDia} (${plural(rango.dias, 'día', 'días')}) · vs. ${rango.etiquetaComparacion.toLowerCase()}`}
      generadoEn={generadoEn}
      controles={controles}
      pie={
        <>
          Las cifras del embudo salen de una bitácora que se escribe sin bloquear el registro ni
          el pago: si una escritura falla, el evento se pierde en silencio. Léelas como «al menos
          esto», nunca como «exactamente esto».
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

      <section>
        <SectionHeader
          title="Resumen"
          description="Lo que pasó con las invitaciones en el periodo elegido."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
          <KpiReporte
            label="Clics en invitaciones"
            kpi={r.clics}
            formato={entero}
            definicion="Veces que alguien abrió un enlace de invitación. No cuenta bots ni al propio dueño del enlace."
            serie={r.serie.map((p) => p.clics)}
          />
          <KpiReporte
            label="Registros atribuidos"
            kpi={r.registros}
            formato={entero}
            definicion="Cuentas creadas con una invitación detrás, fechadas el día del registro."
            serie={r.serie.map((p) => p.registros)}
            href={hrefClientes}
            hrefLabel="Ver clientes"
          />
          <KpiReporte
            label="Referidos completados"
            kpi={r.completados}
            formato={entero}
            definicion="Vínculos que llegaron a completarse, por su fecha de cierre. No cuenta los marcados como sospechosos."
          />
          <KpiReporte
            label="Invitados con membresía"
            kpi={r.membresias}
            formato={entero}
            definicion="Invitados que activaron una membresía después de llegar por una invitación."
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3 print:grid-cols-3">
          <Celda
            label="De clic a registro"
            valor={r.tasaRegistro == null ? 'Sin dato' : `${r.tasaRegistro} %`}
            nota={
              r.tasaRegistro == null
                ? 'No hubo clics en el periodo'
                : `${entero(r.registros.valor)} de ${entero(r.clics.valor)} clics`
            }
          />
          <Celda
            label="De registro a membresía"
            valor={r.tasaMembresia == null ? 'Sin dato' : `${r.tasaMembresia} %`}
            nota={
              r.tasaMembresia == null
                ? 'No hubo registros en el periodo'
                : `${entero(r.membresias.valor)} de ${entero(r.registros.valor)} registros`
            }
          />
          <Celda
            label="Visitas únicas"
            valor={entero(r.visitas.unicas)}
            nota={
              r.visitas.sinIdentificar > 0
                ? `${entero(r.visitas.sinIdentificar)} clics llegaron sin cookie y no se pueden agrupar por persona`
                : 'Personas distintas, no pulsaciones'
            }
          />
        </div>
      </section>

      {primeraEtapa === 0 && r.clics.valor === 0 ? (
        <EmptyState
          title="Nadie usó una invitación en este periodo"
          description="No se generó, compartió ni abrió ningún enlace en las fechas elegidas. El resto del reporte sigue siendo válido: las secciones de abajo miran lo que hay alrededor del embudo."
        />
      ) : (
        <>
          <PanelGrafico
            titulo="Clics y registros, día a día"
            pregunta="¿El interés se está convirtiendo en cuentas, o solo en visitas?"
            periodo={periodo}
            nota="Los registros van punteados. Un día con muchos clics y ningún registro suele apuntar al formulario, no al enlace."
            grafico={
              <GraficoTendencia
                datos={r.serie.map((p) => ({ dia: p.dia, valor: p.clics, anterior: p.registros }))}
                etiqueta="Clics"
                etiquetaAnterior="Registros"
                formato={entero}
              />
            }
            tabla={
              <Tabla
                encabezados={['Día', 'Clics', 'Registros']}
                filas={r.serie
                  .filter((p) => p.clics > 0 || p.registros > 0)
                  .map((p) => [p.dia, entero(p.clics), entero(p.registros)])}
                vacio="Sin clics ni registros en el periodo."
              />
            }
          />

          <PanelGrafico
            titulo="El embudo, paso a paso"
            pregunta="¿En qué paso concreto se pierde la gente?"
            periodo={periodo}
            nota="Cada barra se mide contra el paso más alto. La caída entre dos pasos seguidos es lo accionable: el resto son consecuencias de esa caída."
            grafico={
              <GraficoRanking
                filas={r.embudo.map((e) => ({ nombre: e.nombre, valor: e.eventos }))}
                formato={entero}
                maximo={topeEmbudo}
              />
            }
            tabla={
              <Tabla
                encabezados={['Paso', 'Eventos', 'Referentes distintos', '% del paso anterior']}
                filas={r.embudo.map((e, i) => {
                  const previo = i === 0 ? null : r.embudo[i - 1].eventos
                  return [
                    e.nombre,
                    entero(e.eventos),
                    entero(e.referentes),
                    previo == null ? '—' : previo === 0 ? 'Sin dato' : `${Math.round((e.eventos / previo) * 100)} %`,
                  ]
                })}
                vacio="Sin eventos del embudo en el periodo."
              />
            }
          />

          <PanelGrafico
            titulo="Por dónde entra la gente"
            pregunta="¿Qué canal devuelve clics de verdad, y no solo compartidos?"
            periodo={periodo}
            nota="«(sin canal registrado)» son los enlaces abiertos sin rastro del canal: un enlace pegado a mano llega así."
            grafico={
              <GraficoRanking
                filas={canalesConClics.map((c) => ({ nombre: c.nombre, valor: c.clics }))}
                formato={entero}
              />
            }
            tabla={<TablaCanales filas={r.porCanal} entero={entero} />}
          />
        </>
      )}

      <section>
        <SectionHeader
          title="Quién trae más gente"
          description="Se cuentan referidos COMPLETADOS en el periodo, no clics: alguien con veinte clics y ningún registro no trajo a nadie."
        />
        {r.topReferentes === null ? (
          <p className="text-small text-muted-foreground">
            Esta tabla es una lista de personas identificadas, así que hace falta el permiso de
            ver datos personales. El resto del reporte no cambia.
          </p>
        ) : (
          <Tabla
            encabezados={['Cliente', 'Referidos completados']}
            filas={r.topReferentes.map((t) => [t.nombre, entero(t.completados)])}
            vacio="Ningún vínculo se completó en el periodo."
          />
        )}
      </section>

      <section className="rounded-xl border border-dashed border-border p-5 print:border-black print:p-2">
        <SectionHeader
          title="Los enlaces de invitación"
          description="Cuántos se crearon en el periodo y cuántos siguen sirviendo ahora mismo. Los vigentes son una foto de hoy y por eso no se comparan contra el periodo anterior."
        />
        <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
          <Celda label="Creados en el periodo" valor={entero(r.enlaces.creados)} />
          <Celda
            label="Vigentes ahora mismo"
            valor={entero(r.enlaces.vigentesHoy)}
            nota="Activos y sin caducar"
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Lo que el antifraude apartó"
          description="Registros atribuidos con huella repetida —misma red o mismo dispositivo—. Se conservan para auditoría, no cuentan en el embudo y no dan puntos."
        />
        <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
          <Celda label="Referidos marcados sospechosos" valor={entero(r.bloqueados.referidosSospechosos)} />
          <Celda label="Intentos bloqueados" valor={entero(r.bloqueados.eventosFraude)} />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Recompensas otorgadas en el periodo"
          description="Conviven dos motores de recompensa con reglas distintas. Van separados a propósito: sumarlos daría un total que no corresponde a ninguna configuración real."
        />
        <Tabla
          encabezados={['Motor', 'Pendientes', 'Entregadas', 'Rechazadas']}
          filas={[
            [
              'Programa de referidos',
              entero(r.recompensas.referidos.pendientes),
              entero(r.recompensas.referidos.entregadas),
              entero(r.recompensas.referidos.rechazadas),
            ],
            [
              'Reglas de crecimiento',
              entero(r.recompensas.growth.pendientes),
              entero(r.recompensas.growth.entregadas),
              entero(r.recompensas.growth.rechazadas),
            ],
          ]}
          vacio=""
        />
      </section>

      {(r.fueraDeLaEmpresa.registros > 0 || r.fueraDeLaEmpresa.membresias > 0) && (
        <section>
          <SectionHeader
            title="Se fueron a otro negocio de la plataforma"
            description="Personas invitadas por un cliente tuyo que acabaron registrándose en otra empresa de MembeGo. No cuentan en tu embudo porque no son clientes tuyos."
          />
          <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
            <Celda label="Registros en otra empresa" valor={entero(r.fueraDeLaEmpresa.registros)} />
            <Celda label="Membresías en otra empresa" valor={entero(r.fueraDeLaEmpresa.membresias)} />
          </div>
        </section>
      )}

      <section>
        <SectionHeader
          title="Campañas «Invita y Gana»"
          description="Es un embudo APARTE, con sus propios hitos. Quien pasó por una campaña puede dejar huella en los dos, así que estas cifras NO se suman a las de arriba."
        />
        <TablaCampanas filas={r.campanas} entero={entero} />
      </section>

      <section className="rounded-xl border border-dashed border-border p-5 print:border-black print:p-2">
        <SectionHeader
          title="Lo que este reporte NO cuenta"
          description="Y por qué. Una etapa ausente se leería como un cero, y un cero afirma algo sobre el negocio."
        />
        <ul className="space-y-1.5 text-small text-muted-foreground">
          {FUERA_DEL_EMBUDO.map((f) => (
            <li key={f.clave}>
              <span className="text-foreground">{f.clave}</span> — {f.razon}
            </li>
          ))}
        </ul>
      </section>
    </ReporteImprimible>
  )
}

function TablaCanales({ filas, entero }: { filas: FilaCanal[]; entero: (n: number) => string }) {
  return (
    <Tabla
      encabezados={['Canal', 'Compartidos', 'Clics', 'Clics por compartido']}
      filas={filas.map((f) => [
        f.nombre,
        entero(f.compartidos),
        entero(f.clics),
        // Sin compartidos no es «0»: son clics que llegaron por un enlace que
        // se compartió antes del periodo, o pegado a mano.
        f.compartidos === 0 ? '—' : (f.clics / f.compartidos).toFixed(1),
      ])}
      vacio="Nadie compartió ni abrió un enlace en el periodo."
    />
  )
}

function TablaCampanas({ filas, entero }: { filas: FilaCampana[]; entero: (n: number) => string }) {
  return (
    <Tabla
      encabezados={['Campaña', 'Enlaces abiertos', 'Registros', 'Premios reclamados']}
      filas={filas.map((f) => [f.nombre, entero(f.clics), entero(f.registros), entero(f.premios)])}
      vacio="Ninguna campaña de invitación tuvo movimiento en el periodo."
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
