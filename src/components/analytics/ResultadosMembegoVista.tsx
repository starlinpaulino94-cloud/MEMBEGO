import { formatMoney, type RegionalPrefs } from '@/lib/format'
import { plural } from '@/lib/plural'
import { formatoDinero } from '@/modules/reportes/formato'
import type { Rango } from '@/modules/reportes/rango'
import { serieParaGrafico } from '@/modules/reportes/serie'
import { ETIQUETA_CANAL_ANALITICA } from '@/modules/analytics/domain'
import type { ResultadosDeMembego } from '@/modules/analytics/queries'
import { ETIQUETA_ESTADO_OFERTA } from '@/modules/deals/domain'
import { KpiReporte } from '@/components/reportes/KpiReporte'
import { PanelGrafico } from '@/components/reportes/graficos/PanelGrafico'
import { GraficoTendencia } from '@/components/reportes/graficos/GraficoTendencia'
import { GraficoDistribucion } from '@/components/reportes/graficos/GraficoDistribucion'
import { ReporteImprimible, TablaReporte } from '@/components/ui/reporte-imprimible'
import { SectionHeader } from '@/components/ui/section-header'
import Link from 'next/link'

const num = (n: number, idioma?: string | null) => new Intl.NumberFormat(idioma || 'es-DO').format(n)

/** Una cifra suelta con su definición (para lo que no tiene comparación contra el periodo anterior). */
function Celda({ label, valor, nota }: { label: string; valor: string; nota: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 print:border-black print:p-2">
      <p className="text-overline">{label}</p>
      <p className="mt-1.5 truncate text-h2 tabular-nums text-foreground print:text-base print:font-bold">{valor}</p>
      <p className="mt-1 text-xs text-muted-foreground">{nota}</p>
    </div>
  )
}

/**
 * RESULTADOS MEMBEGO — lo que la plataforma le produjo a la empresa y lo que le costó.
 *
 * El orden es el argumento: primero la frase que responde la pregunta del dueño («¿me conviene
 * Membego?»), después las cifras con su comparación, después de dónde vinieron (canales, ofertas) y
 * al final cómo se leen. Solo cuenta lo que vino por el marketplace; las ventas de la caja, las
 * membresías y las excursiones no son de Membego y no están aquí.
 */
export function ResultadosMembegoVista({
  r,
  rango,
  prefs,
  empresa,
  generadoEn,
  eyebrow,
  controles,
}: {
  r: ResultadosDeMembego
  rango: Rango
  prefs: RegionalPrefs | null
  empresa: string
  generadoEn: string
  eyebrow?: React.ReactNode
  controles?: React.ReactNode
}) {
  const dinero = (n: number) => formatMoney(n, prefs, 2)
  const fDinero = formatoDinero(prefs, 2)
  const entero = (n: number) => num(n, prefs?.idioma)
  const periodo = `${rango.desdeDia} a ${rango.hastaDia}`
  const serie = serieParaGrafico(r.serie, rango.granularidad)
  const hayActividad = r.pedidos.valor > 0 || r.embudo.creados > 0 || r.ofertas.length > 0
  const toma = r.ventas.valor > 0 ? Math.round((r.comisiones.valor / r.ventas.valor) * 1000) / 10 : null

  const canales = r.porCanal.slice(0, 5).map((c) => ({ nombre: ETIQUETA_CANAL_ANALITICA[c.canal], valor: c.ventas }))
  const cola = r.porCanal.slice(5).reduce((t, c) => t + c.ventas, 0)
  if (cola > 0) canales.push({ nombre: 'Los demás canales', valor: cola })

  return (
    <ReporteImprimible
      titulo={`Resultados Membego · ${empresa}`}
      subtitulo={`${rango.etiqueta} · ${periodo} (${plural(rango.dias, 'día', 'días')}) · vs. ${rango.etiquetaComparacion.toLowerCase()}`}
      generadoEn={generadoEn}
      controles={controles}
      pie={
        <>
          Ventas = lo que valieron los pedidos Membego completados en el periodo (sin impuestos), fechados por el día en que se completaron;
          un pedido reembolsado deja de contar. Comisiones = lo que Membego te cobró por esos mismos pedidos (las revertidas no cuentan).
          «Cliente nuevo» es quien no había completado antes ningún pedido Membego contigo; pudo haber comprado antes por otro camino
          (caja, membresía). Solo se cuenta lo que llegó por el marketplace.
        </>
      }
    >
      {eyebrow && <div className="print:hidden">{eyebrow}</div>}

      {!hayActividad ? (
        <p className="rounded-xl border border-border bg-card px-5 py-8 text-center text-muted-foreground">
          En este periodo no llegó ningún pedido por Membego. Cuando un cliente pida o obtenga una oferta desde el marketplace y lo canjee, aquí verás cuánto te produjo y cuánto te costó.
        </p>
      ) : (
        <section aria-label="Resumen" className="rounded-2xl border border-primary/30 bg-primary/5 px-5 py-4 print:border-black print:bg-transparent">
          <p className="text-h3 text-foreground">
            Membego te produjo{' '}
            <strong>
              {entero(r.clientesNuevos.valor)} {plural(r.clientesNuevos.valor, 'cliente nuevo', 'clientes nuevos')}
            </strong>
            , <strong>{entero(r.pedidos.valor)} {plural(r.pedidos.valor, 'pedido', 'pedidos')}</strong> y <strong>{dinero(r.ventas.valor)}</strong> en ventas.
          </p>
          <p className="mt-1 text-small text-muted-foreground">
            Te costó {dinero(r.comisiones.valor)}
            {toma !== null ? ` (${toma} % de lo vendido)` : ''}
            {r.retorno.valor !== null ? `: por cada ${dinero(1)} pagado a Membego, ${dinero(r.retorno.valor)} en ventas.` : '.'}
          </p>
        </section>
      )}

      <section>
        <SectionHeader title="Lo que produjo" description="Pedidos Membego completados en el periodo." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-2">
          <KpiReporte label="Ventas" kpi={r.ventas} formato={dinero} definicion="Lo que valieron los pedidos Membego completados en el periodo, sin impuestos." />
          <KpiReporte label="Pedidos" kpi={r.pedidos} formato={entero} definicion="Pedidos del marketplace completados (cerrados con el QR) en el periodo." />
          <KpiReporte label="Ticket promedio" kpi={r.ticket} formato={dinero} definicion="Ventas ÷ pedidos." />
          <KpiReporte label="Clientes" kpi={r.clientes} formato={entero} definicion="Personas distintas con al menos un pedido completado en el periodo." />
          <KpiReporte label="Clientes nuevos" kpi={r.clientesNuevos} formato={entero} definicion="Clientes que nunca habían completado un pedido contigo (por el marketplace, la caja o Supply) antes de este periodo." />
          <KpiReporte label="Comisiones pagadas" kpi={r.comisiones} formato={dinero} invertido definicion="Lo que Membego te cobró por los pedidos de este periodo (CPA o porcentaje). Las comisiones revertidas por reembolso no cuentan." />
        </div>
      </section>

      <section>
        <SectionHeader title="Lo que te costó" description="Comisiones frente a lo vendido." />
        <div className="grid gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
          <Celda
            label="Ventas por cada peso pagado"
            valor={r.retorno.valor === null ? 'Sin dato' : dinero(r.retorno.valor)}
            nota={r.retorno.valor === null ? 'No pagaste comisiones en el periodo' : `Ventas ÷ comisiones${r.retorno.anterior !== null ? ` · antes ${dinero(r.retorno.anterior)}` : ''}`}
          />
          <Celda
            label="Costo por cliente nuevo"
            valor={r.costoPorClienteNuevo.valor === null ? 'Sin dato' : dinero(r.costoPorClienteNuevo.valor)}
            nota={r.costoPorClienteNuevo.valor === null ? 'No llegaron clientes nuevos' : `Comisiones ÷ clientes nuevos${r.costoPorClienteNuevo.anterior !== null ? ` · antes ${dinero(r.costoPorClienteNuevo.anterior)}` : ''}`}
          />
          <Celda
            label="Reembolsados"
            valor={`${entero(r.reembolsos.pedidos)} · ${dinero(r.reembolsos.monto)}`}
            nota="Pedidos devueltos en el periodo; su venta y su comisión ya no cuentan"
          />
        </div>
      </section>

      <PanelGrafico
        titulo="Las ventas de Membego, día a día"
        pregunta="¿Cuándo llegan los pedidos?"
        periodo={periodo}
        grafico={<GraficoTendencia datos={serie.map((p) => ({ dia: p.dia, valor: p.ventas }))} etiqueta="Ventas" formato={fDinero} />}
        tabla={
          <TablaReporte
            titulo="Ventas por día"
            columnas={[
              { clave: 'dia', titulo: 'Día' },
              { clave: 'pedidos', titulo: 'Pedidos', alinearDerecha: true },
              { clave: 'ventas', titulo: 'Ventas', alinearDerecha: true },
            ]}
            filas={serie.filter((p) => p.pedidos > 0).map((p) => ({ __clave: p.clave, dia: p.dia, pedidos: entero(p.pedidos), ventas: dinero(p.ventas) }))}
            vacio="Sin pedidos completados en el periodo."
          />
        }
      />

      <PanelGrafico
        titulo="Cómo llegaron"
        pregunta="¿Por dónde te encontraron los clientes?"
        periodo={periodo}
        nota="Reparte las VENTAS por el canal que quedó anotado en cada pedido. «Ofertas con presupuesto» son los cupones que se canjearon."
        grafico={<GraficoDistribucion datos={canales} formato={fDinero} total={r.ventas.valor} />}
        tabla={
          <TablaReporte
            titulo="Ventas por canal"
            columnas={[
              { clave: 'canal', titulo: 'Canal' },
              { clave: 'pedidos', titulo: 'Pedidos', alinearDerecha: true },
              { clave: 'ventas', titulo: 'Ventas', alinearDerecha: true },
            ]}
            filas={r.porCanal.map((c) => ({ __clave: c.canal, canal: ETIQUETA_CANAL_ANALITICA[c.canal], pedidos: entero(c.pedidos), ventas: dinero(c.ventas) }))}
            vacio="Sin pedidos completados en el periodo."
          />
        }
      />

      <section>
        <SectionHeader title="Qué pasó con los pedidos" description="Los pedidos que se crearon en el periodo y cómo van." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
          <Celda label="Creados" valor={entero(r.embudo.creados)} nota="Pedidos que llegaron" />
          <Celda label="Completados" valor={entero(r.embudo.completados)} nota="Cerrados con el QR" />
          <Celda label="Cancelados o reembolsados" valor={entero(r.embudo.cancelados)} nota="Se cayeron" />
          <Celda label="Siguen abiertos" valor={entero(r.embudo.abiertos)} nota={r.embudo.tasaDeCierre === null ? 'Sin pedidos' : `Tasa de cierre ${r.embudo.tasaDeCierre} %`} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Un pedido creado al final del periodo todavía puede completarse: la tasa de cierre de los días recientes se queda corta.</p>
      </section>

      <section>
        <SectionHeader
          title="Cada oferta"
          description="Las ofertas con presupuesto que los clientes obtuvieron en el periodo."
          action={
            <Link href="/admin/deals" className="print:hidden text-small font-semibold text-primary underline">
              Ver mis ofertas
            </Link>
          }
        />
        <TablaReporte
          titulo="Rendimiento de las ofertas"
          columnas={[
            { clave: 'oferta', titulo: 'Oferta' },
            { clave: 'obtenidas', titulo: 'Obtenidas', alinearDerecha: true },
            { clave: 'canjeadas', titulo: 'Canjeadas', alinearDerecha: true },
            { clave: 'conversion', titulo: 'Conversión', alinearDerecha: true },
            { clave: 'ventas', titulo: 'Ventas', alinearDerecha: true },
            { clave: 'cuota', titulo: 'Cuota pagada', alinearDerecha: true },
            { clave: 'retorno', titulo: 'Ventas por peso', alinearDerecha: true },
          ]}
          filas={r.ofertas.map((o) => ({
            __clave: o.id,
            oferta: (
              <Link href={`/admin/deals/${o.id}`} className="underline-offset-2 hover:underline">
                {o.titulo} <span className="text-muted-foreground">· {ETIQUETA_ESTADO_OFERTA[o.estado as keyof typeof ETIQUETA_ESTADO_OFERTA] ?? o.estado}</span>
              </Link>
            ),
            obtenidas: entero(o.obtenidas),
            canjeadas: entero(o.canjeadas),
            conversion: o.conversion === null ? '—' : `${o.conversion} %`,
            ventas: dinero(o.ventas),
            cuota: dinero(o.cuota),
            retorno: o.retorno === null ? '—' : dinero(o.retorno),
          }))}
          vacio="En este periodo nadie obtuvo una oferta."
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Ventas = lo que pagaron los clientes por las ofertas ya canjeadas (con el descuento). Cuota = lo que Membego cobró por esos canjes. Una oferta obtenida y aún no canjeada todavía no tiene ventas ni cuota.
        </p>
      </section>
    </ReporteImprimible>
  )
}
