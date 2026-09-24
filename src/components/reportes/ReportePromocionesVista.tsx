import { formatMoney, type RegionalPrefs } from '@/lib/format'
import { formatoEntero } from '@/modules/reportes/formato'
import { plural } from '@/lib/plural'
import type { Rango } from '@/modules/reportes/rango'
import { serieParaGrafico } from '@/modules/reportes/serie'
import type { FilaPromocion, ReportePromociones } from '@/modules/reportes/promociones'
import { TablaReporte as Tabla } from '@/components/reportes/TablaReporte'
import { num, porcentaje } from '@/modules/reportes/tabla'
import { KpiReporte } from '@/components/reportes/KpiReporte'
import { PanelGrafico } from '@/components/reportes/graficos/PanelGrafico'
import { GraficoTendencia } from '@/components/reportes/graficos/GraficoTendencia'
import { GraficoRanking } from '@/components/reportes/graficos/GraficoRanking'
import { ReporteImprimible } from '@/components/ui/reporte-imprimible'
import { SectionHeader } from '@/components/ui/section-header'
import { StatusBanner } from '@/components/ui/status-banner'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * PROMOCIONES.
 *
 * El orden sigue el ciclo de la promoción, porque es el orden en el que se
 * pierde la gente: se adquiere → se entrega → se usa. Las tres cifras van
 * juntas arriba y con su reloj declarado, que es lo que evita la lectura
 * equivocada de siempre: «se vendieron 40 y solo se usaron 12» cuando esas 12
 * son de promociones entregadas el mes pasado.
 *
 * Lo que espera una decisión del negocio —comprobantes por validar— va con
 * aspecto de alarma y NO se compara contra el periodo anterior: es una foto de
 * ahora mismo, y compararla sería inventar una variación.
 */
export function ReportePromocionesVista({
  r,
  rango,
  prefs,
  empresa,
  generadoEn,
  hrefCompras,
  eyebrow,
  controles,
}: {
  r: ReportePromociones
  rango: Rango
  prefs: RegionalPrefs | null
  empresa: string
  generadoEn: string
  /** Dónde se validan los comprobantes, para que la alarma tenga salida. */
  hrefCompras?: string
  eyebrow?: React.ReactNode
  controles?: React.ReactNode
}) {
  const entero = (n: number) => new Intl.NumberFormat(prefs?.idioma || 'es-DO').format(n)
  const fEntero = formatoEntero(prefs)
  const dinero = (n: number) => formatMoney(n, prefs)

  // La serie se pliega a la granularidad del periodo: un año en días son 365
  // barras y no se lee ninguna. Es una SUMA de los mismos días que ya venían de
  // la base, así que la semana nunca puede discrepar del día.
  const serie = serieParaGrafico(r.serie, rango.granularidad)
  const periodo = `${rango.desdeDia} a ${rango.hastaDia}`
  const hayMovimiento =
    r.adquiridas.valor > 0 || r.entregadas.valor > 0 || r.usadas.valor > 0

  return (
    <ReporteImprimible
      titulo={`Promociones · ${empresa}`}
      subtitulo={`${rango.etiqueta} · ${rango.desdeDia} a ${rango.hastaDia} (${plural(rango.dias, 'día', 'días')}) · vs. ${rango.etiquetaComparacion.toLowerCase()}`}
      generadoEn={generadoEn}
      controles={controles}
      pie={
        <>
          Adquirir, entregar y usar son tres momentos distintos y casi nunca caen el mismo día:
          en un periodo cualquiera se usan promociones entregadas semanas antes. Las tres cifras
          van por separado a propósito.
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

      {r.esperando.enValidacion > 0 && (
        <StatusBanner variant="warning" title={`${entero(r.esperando.enValidacion)} ${plural(r.esperando.enValidacion, 'comprobante espera', 'comprobantes esperan')} tu validación`}>
          Son clientes que ya pagaron y todavía no tienen su beneficio. Es una foto de ahora
          mismo, no del periodo.{' '}
          {hrefCompras && (
            <a href={hrefCompras} className="underline">
              Ver las compras pendientes
            </a>
          )}
        </StatusBanner>
      )}

      <section>
        <SectionHeader
          title="El ciclo, en tres cifras"
          description="Cada una tiene su propio reloj: la adquisición se fecha cuando el cliente la pide, la entrega cuando el beneficio queda disponible, y el uso cuando se canjea en el mostrador."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
          <KpiReporte
            label="Adquiridas"
            kpi={r.adquiridas}
            formato={entero}
            definicion="Compras de promoción creadas en el periodo, sin importar si llegaron a pagarse."
            serie={serie.map((p) => p.adquiridas)}
          />
          <KpiReporte
            label="Entregadas"
            kpi={r.entregadas}
            formato={entero}
            definicion="Compras que quedaron activas con su QR en el periodo, ya validado el pago. Pueden haberse pedido antes."
          />
          <KpiReporte
            label="Usadas en el mostrador"
            kpi={r.usadas}
            formato={entero}
            definicion="Canjes reales validados con QR. No incluye los usos que se regalaron a otra persona."
            serie={serie.map((p) => p.usadas)}
          />
          {r.ingresos ? (
            <KpiReporte
              label="Dinero de promociones"
              kpi={r.ingresos}
              formato={dinero}
              definicion="Pagos confirmados de las promociones ENTREGADAS en el periodo. Se fecha por la entrega porque la compra no guarda fecha de cobro propia."
            />
          ) : (
            <Celda
              label="Dinero de promociones"
              valor="Sin permiso"
              nota="Tu cuenta no ve cifras de dinero"
            />
          )}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3 print:grid-cols-3">
          <Celda
            label="De pedida a entregada"
            valor={r.tasaEntrega == null ? 'Sin dato' : `${r.tasaEntrega} %`}
            nota={
              r.tasaEntrega == null
                ? 'No se pidió ninguna en el periodo'
                : 'Entregadas ÷ adquiridas del periodo'
            }
          />
          <Celda
            label="Entregadas y sin usar"
            valor={entero(r.activasSinUsar)}
            nota="Foto de hoy: beneficios vivos esperando su canje"
          />
          <Celda
            label="Regaladas a otra persona"
            valor={entero(r.regalos)}
            nota="Compras del periodo dirigidas a un tercero"
          />
        </div>
      </section>

      {!hayMovimiento ? (
        <EmptyState
          title="Ninguna promoción se movió en este periodo"
          description="No se adquirió, entregó ni usó ninguna en las fechas elegidas. Las secciones de abajo siguen siendo válidas: miran el catálogo y lo que está esperando ahora mismo."
        />
      ) : (
        <>
          <PanelGrafico
            titulo="Adquisiciones y usos, día a día"
            pregunta="¿Lo que se vende se está llegando a usar, o se queda en el teléfono?"
            periodo={periodo}
            nota="Los usos van punteados. No son los mismos beneficios: lo que se usa hoy pudo entregarse semanas atrás."
            grafico={
              <GraficoTendencia
                datos={serie.map((p) => ({ dia: p.dia, valor: p.adquiridas, anterior: p.usadas }))}
                etiqueta="Adquiridas"
                etiquetaAnterior="Usadas"
                formato={fEntero}
              />
            }
            tabla={
              <Tabla
                encabezados={['Día', 'Adquiridas', 'Usadas']}
                filas={serie
                  .filter((p) => p.adquiridas > 0 || p.usadas > 0)
                  .map((p) => [p.dia, num(p.adquiridas, entero(p.adquiridas)), num(p.usadas, entero(p.usadas))])}
                vacio="Sin movimiento diario en el periodo."
              />
            }
          />

          <PanelGrafico
            titulo="Qué promoción tira más"
            pregunta="¿Cuál se usa de verdad, y no solo se vende?"
            periodo={periodo}
            nota="Ordenadas por usos en el mostrador. Una con muchas adquiridas y pocas usadas se está vendiendo pero no se está canjeando."
            grafico={
              <GraficoRanking
                filas={r.topPromociones
                  .slice(0, 8)
                  .map((p) => ({ nombre: p.titulo, valor: p.usadas }))}
                formato={fEntero}
              />
            }
            tabla={<TablaPromociones filas={r.topPromociones} entero={entero} />}
          />

          <section>
            <SectionHeader
              title="Qué se movió, estado por estado"
              description="Cuántas veces una compra ENTRÓ a cada estado dentro del periodo, según la bitácora de cambios. No es cuántas están así hoy: es cuántas pasaron por ahí."
            />
            <Tabla
              encabezados={['Estado', 'Veces que entró']}
              filas={r.porEstado.map((e) => [e.nombre, num(e.movimientos, entero(e.movimientos))])}
              vacio="Ninguna compra cambió de estado en el periodo."
            />
          </section>
        </>
      )}

      <section className="rounded-xl border border-dashed border-border p-5 print:border-black print:p-2">
        <SectionHeader
          title="Foto de hoy — no depende del periodo"
          description="El catálogo y la cola de trabajo, ahora mismo. No se comparan contra el periodo anterior porque el pasado de una foto de hoy no existe."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
          <Celda label="Publicadas" valor={entero(r.catalogo.publicadas)} />
          <Celda
            label="Comprables"
            valor={entero(r.catalogo.comprables)}
            nota="De las publicadas, con precio"
          />
          <Celda
            label="Vencen esta semana"
            valor={entero(r.catalogo.vencenPronto)}
            nota="Su vigencia termina en 7 días"
          />
          <Celda label="Archivadas" valor={entero(r.catalogo.archivadas)} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 print:grid-cols-2">
          <Celda
            label="Comprobantes por validar"
            valor={entero(r.esperando.enValidacion)}
            nota="Ya pagaron y esperan su beneficio"
          />
          <Celda
            label="Esperando el pago del cliente"
            valor={entero(r.esperando.pendientePago)}
            nota="Pedidas y todavía sin transferir"
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="La vitrina pública"
          description="Vistas y compartidos acumulados DESDE SIEMPRE: estos contadores no guardan fecha, así que no se pueden recortar al periodo. Además llevan un tope por navegador, así que son un suelo y no un conteo exacto."
        />
        <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
          <Celda label="Vistas acumuladas" valor={entero(r.vitrina.vistas)} />
          <Celda label="Compartidos acumulados" valor={entero(r.vitrina.compartidos)} />
        </div>
      </section>

      <section className="rounded-xl border border-dashed border-border p-5 print:border-black print:p-2">
        <SectionHeader
          title="Lo que este reporte NO cuenta"
          description="Y por qué. Una columna que existe pero nadie escribe se leería como un cero del negocio."
        />
        <ul className="space-y-1.5 text-small text-muted-foreground">
          <li>
            <span className="text-foreground">Promocion.canjes</span> — la columna existe y no la
            escribe nadie: vale 0 para todas. Los usos de arriba salen de las transacciones del
            mostrador, que sí se escriben.
          </li>
          <li>
            <span className="text-foreground">Usos regalados</span> — regalar usos a un amigo baja
            el contador de la compra sin ser un canje, así que no entra en «usadas».
          </li>
          <li>
            <span className="text-foreground">maxCanjes y límite por cliente</span> — son
            configuración, no medición: dicen lo que se permite, no lo que pasó.
          </li>
        </ul>
      </section>
    </ReporteImprimible>
  )
}

function TablaPromociones({
  filas,
  entero,
}: {
  filas: FilaPromocion[]
  entero: (n: number) => string
}) {
  return (
    <Tabla
      encabezados={['Promoción', 'Adquiridas', 'Usadas', 'Usadas ÷ adquiridas']}
      filas={filas.map((f) => [
        f.titulo,
        num(f.adquiridas, entero(f.adquiridas)),
        num(f.usadas, entero(f.usadas)),
        // Sin adquisiciones en el periodo no es «0 %»: son usos de beneficios
        // entregados antes, que es justo lo normal en una promoción.
        porcentaje(f.usadas, f.adquiridas),
      ])}
      vacio="Ninguna promoción tuvo movimiento en el periodo."
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
