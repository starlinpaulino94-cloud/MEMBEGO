import { formatMoney, type RegionalPrefs } from '@/lib/format'
import { plural } from '@/lib/plural'
import type { Rango } from '@/modules/reportes/rango'
import type { FilaRegalo, ReporteRegalos } from '@/modules/reportes/regalos'
import { KpiReporte } from '@/components/reportes/KpiReporte'
import { PanelGrafico } from '@/components/reportes/graficos/PanelGrafico'
import { GraficoTendencia } from '@/components/reportes/graficos/GraficoTendencia'
import { GraficoRanking } from '@/components/reportes/graficos/GraficoRanking'
import { ReporteImprimible } from '@/components/ui/reporte-imprimible'
import { SectionHeader } from '@/components/ui/section-header'
import { StatusBanner } from '@/components/ui/status-banner'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * CÓDIGOS Y REGALOS.
 *
 * Dos productos distintos en una pantalla, y por eso van en secciones
 * separadas: un regalo lo tiene que ACEPTAR alguien —puede rechazarse o
 * vencerse—, y una gift card es dinero que ya entró y que el negocio todavía
 * debe. Mezclarlos daría un total que no significa nada.
 *
 * El saldo vivo va rotulado como pasivo a propósito: es la cifra que más fácil
 * se lee mal. Ese dinero ya se cobró, pero el servicio no se ha dado; sumarlo a
 * los ingresos del mes lo contaría dos veces.
 */
export function ReporteRegalosVista({
  r,
  rango,
  prefs,
  empresa,
  generadoEn,
  hrefRegalos,
  eyebrow,
  controles,
}: {
  r: ReporteRegalos
  rango: Rango
  prefs: RegionalPrefs | null
  empresa: string
  generadoEn: string
  /** Dónde se gestionan, para que la cola de trabajo tenga salida. */
  hrefRegalos?: string
  eyebrow?: React.ReactNode
  controles?: React.ReactNode
}) {
  const entero = (n: number) => new Intl.NumberFormat(prefs?.idioma || 'es-DO').format(n)
  const dinero = (n: number) => formatMoney(n, prefs)
  const periodo = `${rango.desdeDia} a ${rango.hastaDia}`
  const hayMovimiento = r.enviados.valor > 0 || r.aceptados.valor > 0 || r.emitidas.valor > 0

  return (
    <ReporteImprimible
      titulo={`Códigos y regalos · ${empresa}`}
      subtitulo={`${rango.etiqueta} · ${rango.desdeDia} a ${rango.hastaDia} (${plural(rango.dias, 'día', 'días')}) · vs. ${rango.etiquetaComparacion.toLowerCase()}`}
      generadoEn={generadoEn}
      controles={controles}
      pie={
        <>
          Un regalo no se aplica solo: alguien tiene que aceptarlo. Una gift card sí es dinero que
          ya entró, pero el servicio todavía se debe. Son dos cosas distintas y por eso no se
          suman en ninguna cifra de este reporte.
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

      {r.esperando.regalosVencenPronto > 0 && (
        <StatusBanner
          variant="warning"
          title={`${entero(r.esperando.regalosVencenPronto)} ${plural(r.esperando.regalosVencenPronto, 'regalo vence', 'regalos vencen')} esta semana`}
        >
          Nadie los ha aceptado todavía y se van a perder. Es una foto de ahora mismo, no del
          periodo.{' '}
          {hrefRegalos && (
            <a href={hrefRegalos} className="underline">
              Ver los regalos pendientes
            </a>
          )}
        </StatusBanner>
      )}

      <section>
        <SectionHeader
          title="Regalos entre clientes"
          description="Un cliente le paga algo a otro: usos de su propia compra, una promoción o un plan. El receptor tiene que aceptarlo."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
          <KpiReporte
            label="Enviados"
            kpi={r.enviados}
            formato={entero}
            definicion="Regalos creados en el periodo, fechados el día que se enviaron."
            serie={r.serie.map((p) => p.enviados)}
          />
          <KpiReporte
            label="Aceptados"
            kpi={r.aceptados}
            formato={entero}
            definicion="Regalos que el receptor aceptó DENTRO del periodo. Pueden haberse enviado antes."
            serie={r.serie.map((p) => p.aceptados)}
          />
          <Celda
            label="Tasa de aceptación"
            valor={r.tasaAceptacion == null ? 'Sin dato' : `${r.tasaAceptacion} %`}
            nota={
              r.tasaAceptacion == null
                ? 'Ninguno se cerró en el periodo'
                : 'Sobre los que cerraron, sin los retirados'
            }
          />
          <Celda
            label="A quien no tiene cuenta"
            valor={entero(r.aQuienNoTieneCuenta)}
            nota="De los enviados: una puerta de entrada al negocio"
          />
        </div>
      </section>

      {!hayMovimiento ? (
        <EmptyState
          title="Nadie regaló nada en este periodo"
          description="No se envió ningún regalo ni se emitió ninguna gift card en las fechas elegidas. Las secciones de abajo siguen siendo válidas: miran lo que está pendiente ahora mismo."
        />
      ) : (
        <>
          <PanelGrafico
            titulo="Enviados y aceptados, día a día"
            pregunta="¿Los regalos llegan a su destino, o se quedan sin abrir?"
            periodo={periodo}
            nota="Los aceptados van punteados. No son los mismos regalos: lo que se acepta hoy pudo enviarse días atrás."
            grafico={
              <GraficoTendencia
                datos={r.serie.map((p) => ({ dia: p.dia, valor: p.enviados, anterior: p.aceptados }))}
                etiqueta="Enviados"
                etiquetaAnterior="Aceptados"
                formato={entero}
              />
            }
            tabla={
              <Tabla
                encabezados={['Día', 'Enviados', 'Aceptados']}
                filas={r.serie
                  .filter((p) => p.enviados > 0 || p.aceptados > 0)
                  .map((p) => [p.dia, entero(p.enviados), entero(p.aceptados)])}
                vacio="Sin movimiento diario en el periodo."
              />
            }
          />

          <PanelGrafico
            titulo="Qué se regala"
            pregunta="¿Qué forma de regalar usa tu gente?"
            periodo={periodo}
            nota="Por tipo de regalo enviado en el periodo."
            grafico={
              <GraficoRanking
                filas={r.porTipo.map((t) => ({ nombre: t.nombre, valor: t.total }))}
                formato={entero}
              />
            }
            tabla={
              <TablaTotales filas={r.porTipo} columna="Tipo" total={r.enviados.valor} entero={entero} />
            }
          />

          <section>
            <SectionHeader
              title="Cómo acabaron"
              description="Regalos que se RESOLVIERON dentro del periodo, por desenlace. Los retirados por quien los envió cuentan como movimiento, pero no entran en la tasa de aceptación: es una decisión del remitente, no del receptor."
            />
            <TablaTotales
              filas={r.desenlaces}
              columna="Desenlace"
              total={r.desenlaces.reduce((s, d) => s + d.total, 0)}
              entero={entero}
            />
          </section>
        </>
      )}

      <section>
        <SectionHeader
          title="Gift cards"
          description="Monto abierto que el destinatario consume mostrando su código. El dinero entra cuando se confirma el pago."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
          <KpiReporte
            label="Emitidas"
            kpi={r.emitidas}
            formato={entero}
            definicion="Gift cards creadas en el periodo, esperaran o no el pago."
          />
          <KpiReporte
            label="Activadas"
            kpi={r.activadas}
            formato={entero}
            definicion="Gift cards cuyo pago se confirmó en el periodo: su saldo ya se puede consumir."
          />
          {r.vendido ? (
            <KpiReporte
              label="Vendido en gift cards"
              kpi={r.vendido}
              formato={dinero}
              definicion="Monto de las gift cards activadas en el periodo. Es el dinero que entró por esta vía."
            />
          ) : (
            <Celda
              label="Vendido en gift cards"
              valor="Sin permiso"
              nota="Tu cuenta no ve cifras de dinero"
            />
          )}
          <Celda
            label="Esperando el pago"
            valor={entero(r.esperando.giftCardsPorPagar)}
            nota="Foto de hoy: emitidas y sin pagar"
          />
        </div>
      </section>

      {/* El pasivo va en su propio bloque y rotulado: es la cifra que más fácil
          se lee mal de todo el reporte. */}
      <section className="rounded-xl border border-dashed border-border p-5 print:border-black print:p-2">
        <SectionHeader
          title="Saldo vivo — dinero cobrado que todavía debes"
          description="Es un PASIVO, no un ingreso del periodo. Ya se cobró cuando se vendió la gift card; sumarlo a los ingresos del mes lo contaría dos veces. Es una foto de hoy."
        />
        <div className="grid gap-4 sm:grid-cols-3 print:grid-cols-3">
          <Celda label="Gift cards activas" valor={entero(r.saldoVivo.tarjetas)} />
          <Celda
            label="Saldo pendiente de entregar"
            valor={r.saldoVivo.monto == null ? 'Sin permiso' : dinero(r.saldoVivo.monto)}
          />
          <Celda
            label="Consumido acumulado"
            valor={r.consumidoAcumulado == null ? 'Sin permiso' : dinero(r.consumidoAcumulado)}
            nota="Desde siempre: el consumo no guarda fecha"
          />
        </div>
      </section>

      <section className="rounded-xl border border-dashed border-border p-5 print:border-black print:p-2">
        <SectionHeader
          title="Foto de hoy — no depende del periodo"
          description="Lo que está esperando ahora mismo."
        />
        <div className="grid gap-4 sm:grid-cols-3 print:grid-cols-3">
          <Celda label="Regalos sin responder" valor={entero(r.esperando.regalosPendientes)} />
          <Celda
            label="Vencen esta semana"
            valor={entero(r.esperando.regalosVencenPronto)}
            nota="Se pierden si nadie los acepta"
          />
          <Celda label="Gift cards por pagar" valor={entero(r.esperando.giftCardsPorPagar)} />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Quién más regala"
          description="Por regalos ENVIADOS en el periodo, los acepten o no."
        />
        {r.topRemitentes === null ? (
          <p className="text-small text-muted-foreground">
            Esta tabla es una lista de personas identificadas, así que hace falta el permiso de
            ver datos personales. El resto del reporte no cambia.
          </p>
        ) : (
          <Tabla
            encabezados={['Cliente', 'Regalos enviados']}
            filas={r.topRemitentes.map((t) => [t.nombre, entero(t.enviados)])}
            vacio="Nadie envió regalos en el periodo."
          />
        )}
      </section>

      <section className="rounded-xl border border-dashed border-border p-5 print:border-black print:p-2">
        <SectionHeader
          title="Lo que este reporte NO cuenta"
          description="Y por qué. Una cifra sin reloj propio no se puede recortar a un periodo sin inventarle uno."
        />
        <ul className="space-y-1.5 text-small text-muted-foreground">
          <li>
            <span className="text-foreground">Consumos de gift card por periodo</span> — consumir
            baja el saldo sin dejar una fila con su fecha, y la transacción que sí se emite la
            comparten cuatro flujos distintos. Por eso lo consumido va como acumulado.
          </li>
          <li>
            <span className="text-foreground">Cupones</span> — no existen como entidad en el
            sistema: no hay modelo, y los tipos declarados no los escribe nadie. Esta pantalla los
            sustituye con lo que sí existe.
          </li>
        </ul>
      </section>
    </ReporteImprimible>
  )
}

function TablaTotales({
  filas,
  columna,
  total,
  entero,
}: {
  filas: FilaRegalo[]
  columna: string
  total: number
  entero: (n: number) => string
}) {
  return (
    <Tabla
      encabezados={[columna, 'Total', '% del total']}
      filas={filas.map((f) => [
        f.nombre,
        entero(f.total),
        total === 0 ? '—' : `${Math.round((f.total / total) * 100)} %`,
      ])}
      vacio="Sin movimiento en el periodo."
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
