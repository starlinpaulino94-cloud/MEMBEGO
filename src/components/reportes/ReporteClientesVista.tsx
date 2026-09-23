import Link from 'next/link'
import { formatoEntero } from '@/modules/reportes/formato'
import { plural } from '@/lib/plural'
import { formatMoney, type RegionalPrefs } from '@/lib/format'
import type { Rango } from '@/modules/reportes/rango'
import { serieParaGrafico } from '@/modules/reportes/serie'
import type { FilaClientes, ReporteClientes } from '@/modules/reportes/clientes'
import { TablaReporte as Tabla } from '@/components/reportes/TablaReporte'
import { num, porcentaje } from '@/modules/reportes/tabla'
import { KpiReporte } from '@/components/reportes/KpiReporte'
import { PanelGrafico } from '@/components/reportes/graficos/PanelGrafico'
import { GraficoTendencia } from '@/components/reportes/graficos/GraficoTendencia'
import { GraficoDistribucion } from '@/components/reportes/graficos/GraficoDistribucion'
import { ReporteImprimible } from '@/components/ui/reporte-imprimible'
import { SectionHeader } from '@/components/ui/section-header'
import { StatusBanner } from '@/components/ui/status-banner'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * CLIENTES.
 *
 * El orden es el argumento: primero cuánta gente entró y si volvió —que es lo
 * que dice si el negocio crece—, después la foto de hoy, y al final de dónde
 * vienen. Las cifras del periodo y la foto de hoy van SEPARADAS y rotuladas:
 * mezclarlas haría que alguien leyera «1.240 clientes» como si fueran del mes.
 *
 * Durante mucho tiempo esta pantalla NO tuvo gráficas, y estaba escrito aquí
 * que era una decisión: `ResponsiveContainer` de Recharts sale en blanco en
 * `@media print`.
 *
 * El problema era real; la conclusión, ya no. `PanelGrafico` **exige** la tabla
 * equivalente además del gráfico, así que el papel sale igual que siempre. Las
 * tablas no se han quitado de ningún sitio: están dentro del panel.
 */
export function ReporteClientesVista({
  r,
  rango,
  prefs,
  empresa,
  generadoEn,
  verRiesgo,
  eyebrow,
  controles,
}: {
  r: ReporteClientes
  rango: Rango
  prefs: RegionalPrefs | null
  empresa: string
  generadoEn: string
  /** Si quien mira puede abrir el semáforo, que vive en su propia pantalla. */
  verRiesgo?: boolean
  eyebrow?: React.ReactNode
  controles?: React.ReactNode
}) {
  const entero = (n: number) => new Intl.NumberFormat(prefs?.idioma || 'es-DO').format(n)
  const fEntero = formatoEntero(prefs)
  const dinero = (n: number) => formatMoney(n, prefs)
  const pct = (n: number, de: number) => (de === 0 ? '—' : `${Math.round((n / de) * 100)} %`)

  // La serie se pliega a la granularidad del periodo: un año en días son 365
  // barras y no se lee ninguna. Es una SUMA de los mismos días que ya venían de
  // la base, así que la semana nunca puede discrepar del día.
  const serie = serieParaGrafico(r.serie, rango.granularidad)
  const periodo = `${rango.desdeDia} a ${rango.hastaDia}`

  // Un anillo con treinta porciones no se lee: se enseñan los cinco mayores y
  // el resto va junto, dicho con todas las letras. La tabla de debajo —que el
  // panel exige— sigue trayendo la lista entera, así que no se esconde nada.
  const TOPE_ANILLO = 5
  const mayores = r.porCanal.slice(0, TOPE_ANILLO)
  const cola = r.porCanal.slice(TOPE_ANILLO).reduce((s, c) => s + c.clientes, 0)
  const canalesDelAnillo = [
    ...mayores.map((c) => ({ nombre: c.nombre, valor: c.clientes })),
    // «El resto» y no «otros N canales»: la última fila de `porCanal` puede ser
    // ya una bolsa («(resto, agrupado)») de más canales de los que se cuentan.
    ...(cola > 0 ? [{ nombre: 'El resto de los canales', valor: cola }] : []),
  ]

  return (
    <ReporteImprimible
      titulo={`Clientes · ${empresa}`}
      subtitulo={`${rango.etiqueta} · ${rango.desdeDia} a ${rango.hastaDia} (${plural(rango.dias, 'día', 'días')}) · vs. ${rango.etiquetaComparacion.toLowerCase()}`}
      generadoEn={generadoEn}
      controles={controles}
      pie={
        <>
          Este reporte solo mide la relación de {empresa} con cada cliente. Una misma persona
          puede ser cliente de varios negocios: lo que hizo en otro no aparece aquí, ni se puede
          deducir de estas cifras.
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
          title="Lo que pasó en el periodo"
          description="Altas, actividad y dinero fechados por cuándo ocurrieron."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
          <KpiReporte label="Clientes nuevos" kpi={r.nuevos} formato={entero} />
          <KpiReporte label="Con actividad" kpi={r.conActividad} formato={entero} />
          <KpiReporte label="Con algún cobro" kpi={r.quePagaron} formato={entero} />
          {r.valorGenerado ? (
            <KpiReporte label="Valor generado" kpi={r.valorGenerado} formato={dinero} />
          ) : (
            <Celda
              label="Valor generado"
              valor="Sin permiso"
              nota="Tu cuenta no ve cifras de dinero"
            />
          )}
        </div>
      </section>

      <section>
        <SectionHeader
          title="¿Los nuevos volvieron?"
          description="Un alta que nunca vuelve no es un cliente, es un formulario. Se cuenta si vino alguna vez, no solo dentro del periodo: quien se registró el día 30 todavía no ha tenido tiempo."
        />
        <div className="grid gap-4 sm:grid-cols-3 print:grid-cols-3">
          <Celda label="Altas del periodo" valor={entero(r.nuevos.valor)} />
          <Celda label="De esos, vinieron" valor={entero(r.nuevosQueVolvieron)} />
          <Celda
            label="Tasa de activación"
            valor={r.tasaActivacion == null ? 'Sin dato' : `${r.tasaActivacion} %`}
            nota={r.tasaActivacion == null ? 'No hubo altas en el periodo' : 'Vinieron ÷ altas'}
          />
        </div>
      </section>

      {/* La foto de hoy va aparte y rotulada: si estuviera arriba con las
          demás, «1.240 clientes» se leería como si fueran los del mes. */}
      <section className="rounded-xl border border-dashed border-border p-5 print:border-black print:p-2">
        <SectionHeader
          title="Foto de hoy — no depende del periodo"
          description="Cuántos hay ahora mismo. No se comparan contra el periodo anterior porque el pasado de una foto de hoy no existe."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
          <Celda label="Clientes en total" valor={entero(r.base)} />
          <Celda
            label="Con membresía vigente"
            valor={entero(r.conMembresiaVigente)}
            nota={`${pct(r.conMembresiaVigente, r.base)} de la base`}
          />
          <Celda
            label="Nunca tuvieron membresía"
            valor={entero(r.sinMembresiaNunca)}
            nota={`${pct(r.sinMembresiaNunca, r.base)} de la base`}
          />
          <Celda
            label="Aceptan promociones"
            valor={entero(r.consentimiento.promos)}
            nota={`${entero(r.consentimiento.recordatorios)} aceptan recordatorios`}
          />
        </div>
        {verRiesgo && (
          <p className="print:hidden mt-3 text-caption text-muted-foreground">
            ¿Cuáles están activos, en riesgo o dormidos?{' '}
            <Link href="/admin/riesgo" className="underline">
              El semáforo del cliente vive en Riesgo
            </Link>
            , con sus umbrales configurables y el detalle por persona.
          </p>
        )}
      </section>

      {r.nuevos.valor === 0 ? (
        <EmptyState
          title="Sin altas en este periodo"
          description="No se registró ningún cliente nuevo en las fechas elegidas. El resto del reporte sigue siendo válido."
        />
      ) : (
        <>
          <PanelGrafico
            titulo="Por dónde llegaron"
            pregunta="¿De dónde sale de verdad la gente nueva?"
            periodo={periodo}
            nota="El anillo enseña los cinco canales mayores; el resto va junto en una porción, y la tabla los lista uno a uno. «(directo o sin registrar)» son los que llegaron sin enlace de campaña: es un canal más, no un error."
            grafico={
              <GraficoDistribucion
                datos={canalesDelAnillo}
                formato={fEntero}
                total={r.nuevos.valor}
              />
            }
            tabla={
              <TablaClientes
                filas={r.porCanal}
                columna="Canal"
                total={r.nuevos.valor}
                entero={entero}
              />
            }
          />

          <section>
            <SectionHeader title="De dónde son" description="Ciudad declarada en su perfil." />
            <TablaClientes filas={r.porCiudad} columna="Ciudad" total={r.nuevos.valor} entero={entero} />
          </section>

          <PanelGrafico
            titulo="Altas, día a día"
            pregunta="¿El crecimiento es sostenido, o son dos días sueltos?"
            periodo={periodo}
            nota="Una campaña se ve como un pico; el boca a boca, como una línea que no baja. La cifra de arriba no distingue entre las dos."
            grafico={
              <GraficoTendencia
                datos={serie.map((p) => ({ dia: p.dia, valor: p.nuevos }))}
                etiqueta="Altas"
                formato={fEntero}
              />
            }
            tabla={
              <Tabla
                encabezados={['Día', 'Altas']}
                filas={serie
                  .filter((p) => p.nuevos > 0)
                  .map((p) => [p.dia, num(p.nuevos, entero(p.nuevos))])}
                vacio="Sin altas diarias en el periodo."
              />
            }
          />
        </>
      )}

      <section>
        <SectionHeader
          title="Los que más dejaron en el periodo"
          description="Solo cobros de membresía: una venta de mostrador puede no llevar cliente, y mezclarla ordenaría mal la tabla sin decirlo."
        />
        {r.topClientes === null ? (
          <p className="text-small text-muted-foreground">
            Esta tabla lleva nombres y dinero a la vez, así que hacen falta los dos permisos: ver
            cifras de dinero y ver datos personales. El resto del reporte no cambia.
          </p>
        ) : (
          <Tabla
            encabezados={['Cliente', 'Cobros de membresía']}
            filas={r.topClientes.map((c) => [c.nombre, num(c.monto, dinero(c.monto))])}
            vacio="Nadie pagó una membresía en el periodo."
          />
        )}
      </section>
    </ReporteImprimible>
  )
}

function TablaClientes({
  filas,
  columna,
  total,
  entero,
}: {
  filas: FilaClientes[]
  columna: string
  total: number
  entero: (n: number) => string
}) {
  return (
    <Tabla
      encabezados={[columna, 'Altas', '% de las altas']}
      filas={filas.map((f) => [
        f.nombre,
        num(f.clientes, entero(f.clientes)),
        porcentaje(f.clientes, total),
      ])}
      vacio="Sin altas en el periodo."
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
