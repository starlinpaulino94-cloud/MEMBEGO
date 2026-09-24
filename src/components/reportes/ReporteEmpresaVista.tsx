import { formatMoney, type RegionalPrefs } from '@/lib/format'
import { formatoDinero, formatoEntero } from '@/modules/reportes/formato'
import { plural } from '@/lib/plural'
import type { Rango } from '@/modules/reportes/rango'
import { serieParaGrafico } from '@/modules/reportes/serie'
import { calcularInsights } from '@/modules/reportes/insights'
import {
  PREFERENCIAS_VACIAS,
  resolverCifras,
  type PreferenciasReportes,
} from '@/modules/reportes/preferencias'
import { TIPO_TX_LABEL, METODO_LABEL, type Reporte } from '@/modules/reportes/queries'
import { KpiReporte } from '@/components/reportes/KpiReporte'
import { PanelGrafico } from '@/components/reportes/graficos/PanelGrafico'
import { GraficoTendencia } from '@/components/reportes/graficos/GraficoTendencia'
import { GraficoDistribucion } from '@/components/reportes/graficos/GraficoDistribucion'
import { GraficoRanking } from '@/components/reportes/graficos/GraficoRanking'
import { ReporteImprimible, TablaReporte } from '@/components/ui/reporte-imprimible'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SectionHeader } from '@/components/ui/section-header'
import { StatusBanner } from '@/components/ui/status-banner'
import { ArrowRight, Lightbulb, Minus, TrendingDown, TrendingUp } from 'lucide-react'

/**
 * Cuántas columnas según cuántas cifras quedan.
 *
 * Escritas enteras y no armadas con `lg:grid-cols-${n}`: Tailwind lee las
 * clases del código fuente, y una clase construida en tiempo de ejecución no
 * llega al CSS. El síntoma sería una rejilla de una sola columna sin que nada
 * falle. En el papel se usa el mismo número, que es el que cabe en A4.
 */
const REJILLA: Record<number, string> = {
  1: 'lg:grid-cols-1 print:grid-cols-1',
  2: 'lg:grid-cols-2 print:grid-cols-2',
  3: 'lg:grid-cols-3 print:grid-cols-3',
  4: 'lg:grid-cols-4 print:grid-cols-4',
  5: 'lg:grid-cols-5 print:grid-cols-5',
}

/** A dónde lleva investigar cada cifra. Vacío en el montaje del superadmin. */
export interface EnlacesReporte {
  finanzas?: string
  operacion?: string
  clientes?: string
  membresias?: string
}

/**
 * EL REPORTE DE UNA EMPRESA, montado en dos sitios.
 *
 * Lo ve el dueño del negocio en `/admin/reportes` y el superadmin en
 * `/superadmin/reportes/[id]`. Es literalmente el mismo reporte, así que es el
 * mismo componente: si fueran dos copias, la próxima corrección entraría en una
 * y el superadmin y el cliente discutirían sobre cifras distintas del mismo
 * negocio — que es exactamente el problema que este módulo venía arrastrando.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTA PANTALLA ES UN TABLERO, NO UN REPORTE
 *
 * Y la diferencia decide qué entra. Un TABLERO responde «¿cómo va el negocio?»
 * en diez segundos y señala a dónde ir; un REPORTE responde «¿por qué pasó
 * esto?» y para eso hace falta profundidad. Meter aquí todo lo que se puede
 * medir convierte la primera pantalla en un vertedero de cifras donde ninguna
 * destaca — que es de donde venimos.
 *
 * Así que el orden es deliberado, de lo general a lo concreto:
 *
 *   1. CINCO cifras, no quince. Cada una con contra qué se compara, qué forma
 *      tuvo el periodo y a qué reporte lleva.
 *   2. Una gráfica grande: la evolución, que es la pregunta que ninguna tarjeta
 *      puede contestar.
 *   3. Dos repartos: de dónde viene el dinero y en qué se va el trabajo.
 *   4. Lo que los números significan, en frases.
 *   5. Los detalles, en tablas, al final.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS GRÁFICOS NO IMPRIMEN, Y POR ESO NUNCA VAN SOLOS
 *
 * `ResponsiveContainer` de Recharts mide el contenedor al pintar; en la hoja no
 * hay contenedor que medir y sale un hueco. `PanelGrafico` obliga a entregar
 * también la tabla equivalente, así que la regla dejó de depender de que quien
 * escribe la pantalla se acuerde. Esa tabla es además la alternativa textual
 * para un lector de pantalla.
 */
export function ReporteEmpresaVista({
  reporte: r,
  rango,
  prefs,
  empresa,
  eyebrow,
  controles,
  generadoEn,
  enlaces,
  preferencias = PREFERENCIAS_VACIAS,
  personalizar,
}: {
  reporte: Reporte
  rango: Rango
  prefs: RegionalPrefs | null
  /** Nombre del negocio. Va en el papel: una hoja suelta tiene que decir de quién es. */
  empresa: string
  eyebrow?: React.ReactNode
  controles?: React.ReactNode
  generadoEn: string
  /** Rutas de drill-down. El superadmin no las pasa: sus reportes viven en otro sitio. */
  enlaces?: EnlacesReporte
  /** Qué cifras ve ESTA persona. El montaje del superadmin no las pasa. */
  preferencias?: PreferenciasReportes
  /** El panel para cambiarlas. Va aquí y no dentro para no atar la vista a una action. */
  personalizar?: React.ReactNode
}) {
  const dinero = (n: number) => formatMoney(n, prefs)
  const fDinero = formatoDinero(prefs)
  const entero = (n: number) => new Intl.NumberFormat(prefs?.idioma || 'es-DO').format(n)
  const fEntero = formatoEntero(prefs)

  // La serie se pliega a la granularidad del periodo: un año en días son 365
  // barras y no se lee ninguna. Es una SUMA de los mismos días que ya venían de
  // la base, así que la semana nunca puede discrepar del día.
  const serie = serieParaGrafico(r.serie, rango.granularidad)
  const insights = calcularInsights(r)
  const hayActividad = serie.some((p) => p.ventas > 0 || p.entregas > 0)
  const periodo = `${rango.desdeDia} a ${rango.hastaDia}`

  // Las series de las tarjetas salen de los datos que YA se consultan. Donde no
  // hay dato por día no se pinta sparkline: dibujar una línea inventada para
  // que las cinco tarjetas se vean iguales sería exactamente lo contrario de un
  // reporte.
  const serieIngresos = serie.map((p) => p.ingresos)
  const serieVentas = serie.map((p) => p.ventas)
  const serieEntregas = serie.map((p) => p.entregas)

  const ingresoTotal = (r.ingresosCaja?.valor ?? 0) + (r.ingresosMembresias?.valor ?? 0)

  // Las cifras del resumen, en el orden que eligió quien mira. El permiso
  // financiero ya viene resuelto en el propio reporte —sin él, `ingresosCaja`
  // llega en `null`—, así que aquí se le pasa eso mismo y no una comprobación
  // paralela que pudiera discrepar.
  const cifras = resolverCifras(preferencias, { verFinancieros: r.ingresosCaja !== null })
  const tarjetas: Record<string, React.ReactNode> = {
    ingresosCaja: (
      <KpiReporte
        key="ingresosCaja"
        label="Ingresos de caja"
        kpi={r.ingresosCaja}
        formato={dinero}
        serie={serieIngresos}
        href={enlaces?.finanzas}
        definicion="Dinero cobrado por el mostrador en el periodo. Solo transacciones aprobadas o aplicadas: una intención de pago no es un ingreso."
      />
    ),
    cobrosMembresias: (
      <KpiReporte
        key="cobrosMembresias"
        label="Cobros de membresías"
        kpi={r.ingresosMembresias}
        formato={dinero}
        href={enlaces?.finanzas}
        definicion="Lo cobrado por activaciones y renovaciones, fechado por la fecha de pago. Va aparte de la caja porque entra por otro camino."
      />
    ),
    ventas: (
      <KpiReporte
        key="ventas"
        label="Ventas"
        kpi={r.operaciones}
        formato={entero}
        serie={serieVentas}
        href={enlaces?.operacion}
        definicion="Operaciones cobradas en el periodo. No incluye las entregas sin cobro, que se cuentan aparte."
      />
    ),
    entregas: (
      <KpiReporte
        key="entregas"
        label="Entregas sin cobro"
        kpi={r.entregas}
        formato={entero}
        serie={serieEntregas}
        href={enlaces?.operacion}
        definicion="Beneficios entregados sin cobrar: canjes de membresía, recompensas y regalos. Es trabajo hecho, no dinero perdido."
      />
    ),
    clientesNuevos: (
      <KpiReporte
        key="clientesNuevos"
        label="Clientes nuevos"
        kpi={r.clientesNuevos}
        formato={entero}
        href={enlaces?.clientes}
        definicion="Clientes dados de alta en el periodo, por su fecha de registro. No mide si llegaron a venir: eso lo dice la tasa de activación del reporte de clientes."
      />
    ),
  }

  return (
    <ReporteImprimible
      titulo={`Reportes · ${empresa}`}
      subtitulo={`${rango.etiqueta} · ${periodo} (${plural(rango.dias, 'día', 'días')}) · vs. ${rango.etiquetaComparacion.toLowerCase()}`}
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

      {/* ── 1 · Resumen ejecutivo ───────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Resumen ejecutivo"
          description="Las cinco cifras que dicen cómo va el negocio. Cada una abre el reporte que la explica."
        />
        {personalizar}
        <div
          className={`mt-4 grid gap-4 sm:grid-cols-2 ${REJILLA[cifras.length] ?? 'lg:grid-cols-5'} print:gap-2`}
        >
          {cifras.map((c) => tarjetas[c.clave])}
        </div>
      </section>

      {/* ── 2 · La evolución ────────────────────────────────────────────── */}
      <PanelGrafico
        titulo="Rendimiento en el tiempo"
        pregunta="¿La cifra del periodo es una tendencia o el ruido de una semana?"
        periodo={periodo}
        accion={
          enlaces?.finanzas ? (
            <a href={enlaces.finanzas} className="text-caption text-primary hover:underline">
              Ver finanzas →
            </a>
          ) : undefined
        }
        grafico={
          hayActividad ? (
            <GraficoTendencia
              datos={serie.map((p) => ({ dia: p.dia, valor: p.ingresos }))}
              etiqueta="Ingresos de caja"
              formato={fDinero}
            />
          ) : (
            <p className="py-10 text-center text-small text-muted-foreground">
              Sin operaciones registradas en este periodo.
            </p>
          )
        }
        tabla={
          <TablaReporte
            vacio="Sin operaciones registradas en este periodo."
            columnas={[
              { clave: 'dia', titulo: 'Día' },
              { clave: 'ventas', titulo: 'Ventas', alinearDerecha: true },
              { clave: 'entregas', titulo: 'Entregas', alinearDerecha: true },
              { clave: 'ingresos', titulo: 'Ingresos de caja', alinearDerecha: true },
            ]}
            // Solo los días con algo: en papel, treinta filas de ceros gastan
            // una hoja para no decir nada.
            filas={serie
              .filter((p) => p.ventas > 0 || p.entregas > 0 || p.ingresos > 0)
              .map((p) => ({
                __clave: p.dia,
                dia: p.dia,
                ventas: entero(p.ventas),
                entregas: entero(p.entregas),
                ingresos: dinero(p.ingresos),
              }))}
          />
        }
      />

      {/* ── 3 · Los dos repartos ────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-2 print:gap-3">
        <PanelGrafico
          titulo="De dónde viene el dinero"
          pregunta="¿Por qué vía está entrando lo que se cobra?"
          periodo={periodo}
          grafico={
            r.porMetodo.length > 0 ? (
              <GraficoDistribucion
                datos={r.porMetodo.map((m) => ({
                  nombre: METODO_LABEL[m.metodo] ?? m.metodo,
                  valor: m.ingresos,
                }))}
                total={r.porMetodo.reduce((s, m) => s + m.ingresos, 0)}
                formato={fDinero}
              />
            ) : (
              <p className="py-10 text-center text-small text-muted-foreground">
                Sin cobros registrados en el periodo.
              </p>
            )
          }
          tabla={
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
          }
          nota={
            ingresoTotal > 0
              ? `El total cobrado del periodo, por las dos vías, fue ${dinero(ingresoTotal)}.`
              : undefined
          }
        />

        <PanelGrafico
          titulo="En qué se va el trabajo"
          pregunta="¿Qué tipo de operación ocupa al mostrador?"
          periodo={periodo}
          accion={
            enlaces?.operacion ? (
              <a href={enlaces.operacion} className="text-caption text-primary hover:underline">
                Ver operación →
              </a>
            ) : undefined
          }
          grafico={
            r.porTipo.length > 0 ? (
              <GraficoRanking
                filas={r.porTipo.map((t) => ({
                  nombre: TIPO_TX_LABEL[t.tipo] ?? t.tipo,
                  valor: t.operaciones,
                }))}
                formato={fEntero}
              />
            ) : (
              <p className="py-10 text-center text-small text-muted-foreground">
                Sin operaciones en el periodo.
              </p>
            )
          }
          tabla={
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
          }
        />
      </div>

      {/* ── 4 · Qué significan ──────────────────────────────────────────── */}
      {insights.length > 0 && (
        <section>
          <SectionHeader
            title="Qué dicen estos números"
            description="Solo aparece lo que tiene algo que decir: una sección que siempre está encendida enseña a ignorarla."
          />
          <ul className="grid gap-3 sm:grid-cols-2 print:grid-cols-2">
            {insights.map((i) => {
              const Icono =
                i.tono === 'bueno' ? TrendingUp : i.tono === 'malo' ? TrendingDown : Minus
              return (
                <li
                  key={i.texto}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 print:border-black print:p-2"
                >
                  <span
                    className={`mt-0.5 shrink-0 rounded-lg p-1.5 print:hidden ${
                      i.tono === 'bueno'
                        ? 'bg-success/10 text-success'
                        : i.tono === 'malo'
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {/* El icono cambia con el significado, no solo el color: quien
                        no distingue verde de rojo necesita otra señal. */}
                    <Icono className="h-4 w-4" aria-hidden />
                    <span className="sr-only">
                      {i.tono === 'bueno' ? 'Buena señal:' : i.tono === 'malo' ? 'Atención:' : 'Dato:'}
                    </span>
                  </span>
                  <Lightbulb className="hidden print:block h-4 w-4 shrink-0" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-small text-foreground print:text-xs">{i.texto}</p>
                    {/* El enlace solo aparece si ese montaje tiene a dónde ir:
                        el reporte que abre soporte no lleva estos destinos, y
                        un «ver más» que no lleva a nada es peor que ninguno.
                        No se imprime —en el papel no hay nada que pulsar—,
                        pero la frase sí, entera. */}
                    {i.investigar && enlaces?.[i.investigar.destino] && (
                      <a
                        href={enlaces[i.investigar.destino]}
                        className="mt-1.5 inline-flex items-center gap-1 text-caption text-primary hover:underline print:hidden"
                      >
                        {i.investigar.etiqueta}
                        <ArrowRight className="h-3 w-3" aria-hidden />
                      </a>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* ── 5 · El detalle ──────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-2 print:gap-3">
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
