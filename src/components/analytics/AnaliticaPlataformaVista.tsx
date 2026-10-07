import Link from 'next/link'
import { formatMoney } from '@/lib/format'
import { plural } from '@/lib/plural'
import { formatoDinero } from '@/modules/reportes/formato'
import type { Rango } from '@/modules/reportes/rango'
import { serieParaGrafico } from '@/modules/reportes/serie'
import { ETIQUETA_CANAL_ANALITICA } from '@/modules/analytics/domain'
import type { PanoramaDePlataforma } from '@/modules/analytics/queries'
import { ETIQUETA_ESTADO_OFERTA } from '@/modules/deals/domain'
import { ETIQUETA_ORIGEN } from '@/modules/orders/formato'
import type { ResumenFinanzas } from '@/modules/supply-v2/finance/queries'
import { KpiReporte } from '@/components/reportes/KpiReporte'
import { PanelGrafico } from '@/components/reportes/graficos/PanelGrafico'
import { GraficoTendencia } from '@/components/reportes/graficos/GraficoTendencia'
import { GraficoDistribucion } from '@/components/reportes/graficos/GraficoDistribucion'
import { ReporteImprimible, TablaReporte } from '@/components/ui/reporte-imprimible'
import { SectionHeader } from '@/components/ui/section-header'

const num = (n: number) => new Intl.NumberFormat('es-DO').format(n)
const dinero = (n: number) => formatMoney(n, null)
const pct = (n: number | null) => (n === null ? '—' : `${n} %`)

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
 * ANALÍTICA DE LA PLATAFORMA (superadmin).
 *
 * Dos mundos que NO se mezclan en una cifra:
 *  · arriba, el COMERCIO de las empresas — pedidos Membego, comisiones de Merchant Billing y ofertas;
 *  · al final y aparte, SUPPLY ECONOMICS (Membego → proveedores), que sale de su propio módulo.
 * Las empresas de práctica no cuentan en ninguna cifra.
 */
export function AnaliticaPlataformaVista({
  p,
  supply,
  rango,
  generadoEn,
  eyebrow,
  controles,
}: {
  p: PanoramaDePlataforma
  /** Supply Economics, del mes en curso; `null` si no se pudo leer. */
  supply: ResumenFinanzas | null
  rango: Rango
  generadoEn: string
  eyebrow?: React.ReactNode
  controles?: React.ReactNode
}) {
  const fDinero = formatoDinero(null)
  const periodo = `${rango.desdeDia} a ${rango.hastaDia}`
  const serie = serieParaGrafico(p.serie, rango.granularidad)
  const canales = p.porCanal.slice(0, 6).map((c) => ({ nombre: ETIQUETA_CANAL_ANALITICA[c.canal], valor: c.ventas }))
  const cola = p.porCanal.slice(6).reduce((t, c) => t + c.ventas, 0)
  if (cola > 0) canales.push({ nombre: 'Los demás canales', valor: cola })

  return (
    <ReporteImprimible
      titulo="Analítica de Membego"
      subtitulo={`${rango.etiqueta} · ${periodo} (${plural(rango.dias, 'día', 'días')}) · vs. ${rango.etiquetaComparacion.toLowerCase()} · sin empresas de práctica`}
      generadoEn={generadoEn}
      controles={controles}
      pie={
        <>
          GMV = lo que valieron los pedidos Membego completados en el periodo (sin impuestos), de todos los orígenes. La toma (take rate) es
          comisión ÷ GMV de los pedidos que sí comisionan (hoy solo el marketplace): los pedidos de Supply nunca comisionan y no entran en
          ella. Supply Economics se mide con su propio reloj y su propio libro; no se suma al GMV de arriba.
        </>
      }
    >
      {eyebrow && <div className="print:hidden">{eyebrow}</div>}

      <section>
        <SectionHeader title="El comercio" description="Pedidos Membego completados en el periodo, todas las empresas." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-2">
          <KpiReporte label="GMV" kpi={p.gmv} formato={dinero} definicion="Lo que valieron los pedidos Membego completados en el periodo, de todos los orígenes (marketplace, Supply…)." />
          <KpiReporte label="Pedidos" kpi={p.pedidos} formato={num} definicion="Pedidos completados en el periodo." />
          <KpiReporte label="Ticket promedio" kpi={p.ticket} formato={dinero} definicion="GMV ÷ pedidos." />
          <KpiReporte label="Empresas activas" kpi={p.empresasActivas} formato={num} definicion="Empresas con al menos un pedido completado en el periodo." />
          <KpiReporte label="Comisiones cobradas" kpi={p.comisiones} formato={dinero} definicion="Comisiones confirmadas de Merchant Billing por los pedidos del periodo (las revertidas no cuentan)." />
          <Celda
            label="Toma (take rate)"
            valor={pct(p.toma.valor)}
            nota={p.toma.valor === null ? 'Sin ventas comisionables en el periodo' : `Comisiones ÷ GMV comisionable (${dinero(p.gmvComisionable.valor)})${p.toma.anterior !== null ? ` · antes ${p.toma.anterior} %` : ''}`}
          />
        </div>
      </section>

      <PanelGrafico
        titulo="El GMV, día a día"
        pregunta="¿Cómo va el comercio?"
        periodo={periodo}
        grafico={<GraficoTendencia datos={serie.map((x) => ({ dia: x.dia, valor: x.ventas }))} etiqueta="GMV" formato={fDinero} />}
        tabla={
          <TablaReporte
            titulo="GMV por día"
            columnas={[
              { clave: 'dia', titulo: 'Día' },
              { clave: 'pedidos', titulo: 'Pedidos', alinearDerecha: true },
              { clave: 'gmv', titulo: 'GMV', alinearDerecha: true },
            ]}
            filas={serie.filter((x) => x.pedidos > 0).map((x) => ({ __clave: x.clave, dia: x.dia, pedidos: num(x.pedidos), gmv: dinero(x.ventas) }))}
            vacio="Sin pedidos completados en el periodo."
          />
        }
      />

      <section>
        <SectionHeader title="Por origen" description="De dónde vino cada pedido. Solo el marketplace comisiona." />
        <TablaReporte
          titulo="Pedidos por origen"
          columnas={[
            { clave: 'origen', titulo: 'Origen' },
            { clave: 'pedidos', titulo: 'Pedidos', alinearDerecha: true },
            { clave: 'gmv', titulo: 'GMV', alinearDerecha: true },
            { clave: 'comisiones', titulo: 'Comisiones', alinearDerecha: true },
          ]}
          filas={p.porOrigen.map((o) => ({ __clave: o.origen, origen: ETIQUETA_ORIGEN[o.origen] ?? o.origen, pedidos: num(o.pedidos), gmv: dinero(o.ventas), comisiones: dinero(o.comisiones) }))}
          vacio="Sin pedidos completados en el periodo."
        />
      </section>

      <PanelGrafico
        titulo="Cómo llegan los pedidos"
        pregunta="¿Qué canales traen ventas?"
        periodo={periodo}
        grafico={<GraficoDistribucion datos={canales} formato={fDinero} total={p.gmv.valor} />}
        tabla={
          <TablaReporte
            titulo="GMV por canal de atribución"
            columnas={[
              { clave: 'canal', titulo: 'Canal' },
              { clave: 'pedidos', titulo: 'Pedidos', alinearDerecha: true },
              { clave: 'gmv', titulo: 'GMV', alinearDerecha: true },
            ]}
            filas={p.porCanal.map((c) => ({ __clave: c.canal, canal: ETIQUETA_CANAL_ANALITICA[c.canal], pedidos: num(c.pedidos), gmv: dinero(c.ventas) }))}
            vacio="Sin pedidos completados en el periodo."
          />
        }
      />

      <section>
        <SectionHeader title="Empresas con más ventas" description="Las quince con más GMV en el periodo." action={<Link href="/superadmin/facturacion" className="print:hidden text-small font-semibold text-primary underline">Cobros a empresas</Link>} />
        <TablaReporte
          titulo="Ventas por empresa"
          columnas={[
            { clave: 'empresa', titulo: 'Empresa' },
            { clave: 'pedidos', titulo: 'Pedidos', alinearDerecha: true },
            { clave: 'gmv', titulo: 'GMV', alinearDerecha: true },
            { clave: 'comisiones', titulo: 'Comisiones', alinearDerecha: true },
            { clave: 'toma', titulo: 'Toma', alinearDerecha: true },
          ]}
          filas={p.topEmpresas.map((e) => ({
            __clave: e.id,
            empresa: (
              <Link href={`/superadmin/facturacion/${e.id}`} className="underline-offset-2 hover:underline">
                {e.nombre}
              </Link>
            ),
            pedidos: num(e.pedidos),
            gmv: dinero(e.ventas),
            comisiones: dinero(e.comisiones),
            toma: pct(e.toma),
          }))}
          vacio="Ninguna empresa completó pedidos en el periodo."
        />
      </section>

      <section>
        <SectionHeader title="Qué pasa con los pedidos" description="Los pedidos creados en el periodo y cómo van." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
          <Celda label="Creados" valor={num(p.embudo.creados)} nota="Pedidos que llegaron" />
          <Celda label="Completados" valor={num(p.embudo.completados)} nota={p.embudo.tasaDeCierre === null ? 'Sin pedidos' : `Tasa de cierre ${p.embudo.tasaDeCierre} %`} />
          <Celda label="Cancelados o reembolsados" valor={num(p.embudo.cancelados)} nota="Se cayeron" />
          <Celda label="Reembolsados en el periodo" valor={`${num(p.reembolsos.pedidos)} · ${dinero(p.reembolsos.monto)}`} nota="Su GMV y su comisión ya no cuentan" />
        </div>
      </section>

      <section>
        <SectionHeader title="Ofertas con presupuesto" description="Obtenidas en el periodo." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 print:grid-cols-5 print:gap-2">
          <Celda label="Activas ahora" valor={num(p.ofertas.activas)} nota="Foto de hoy" />
          <Celda label="Obtenidas" valor={num(p.ofertas.obtenidas)} nota="Cupones reclamados" />
          <Celda label="Canjeadas" valor={num(p.ofertas.canjeadas)} nota={pct(p.ofertas.obtenidas > 0 ? Math.round((p.ofertas.canjeadas / p.ofertas.obtenidas) * 1000) / 10 : null) + ' de lo obtenido'} />
          <Celda label="Ventas por canjes" valor={dinero(p.ofertas.ventas)} nota="Con el descuento aplicado" />
          <Celda label="Cuotas cobradas" valor={dinero(p.ofertas.cuota)} nota="Lo que se cobró por esos canjes" />
        </div>
        <div className="mt-3">
          <TablaReporte
            titulo="Las ofertas con más ventas"
            columnas={[
              { clave: 'oferta', titulo: 'Oferta' },
              { clave: 'empresa', titulo: 'Empresa' },
              { clave: 'obtenidas', titulo: 'Obtenidas', alinearDerecha: true },
              { clave: 'canjeadas', titulo: 'Canjeadas', alinearDerecha: true },
              { clave: 'ventas', titulo: 'Ventas', alinearDerecha: true },
              { clave: 'cuota', titulo: 'Cuota', alinearDerecha: true },
            ]}
            filas={p.ofertas.top.map((o) => ({
              __clave: o.id,
              oferta: `${o.titulo} · ${ETIQUETA_ESTADO_OFERTA[o.estado as keyof typeof ETIQUETA_ESTADO_OFERTA] ?? o.estado}`,
              empresa: o.empresa,
              obtenidas: num(o.obtenidas),
              canjeadas: num(o.canjeadas),
              ventas: dinero(o.ventas),
              cuota: dinero(o.cuota),
            }))}
            vacio="En este periodo nadie obtuvo una oferta."
          />
        </div>
      </section>

      <section>
        <SectionHeader title="Salud de los cobros" description="Cuentas de Merchant Billing por estado (foto de hoy)." action={<Link href="/superadmin/facturacion" className="print:hidden text-small font-semibold text-primary underline">Ver cuentas</Link>} />
        <div className="grid gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
          <Celda label="Al día" valor={num(p.cuentas.activas)} nota="Cuentas activas" />
          <Celda label="En gracia" valor={num(p.cuentas.enGracia)} nota="Pasaron su límite de crédito" />
          <Celda label="Suspendidas" valor={num(p.cuentas.suspendidas)} nota="No pueden crear ni publicar ofertas" />
        </div>
      </section>

      <section>
        <SectionHeader title="Descubrimiento" description="Búsquedas en el mapa «cerca de mí»." />
        <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2 print:gap-2">
          <Celda label="Búsquedas" valor={num(p.busquedas.total)} nota="En el periodo" />
          <Celda label="Sin resultados" valor={num(p.busquedas.sinResultados)} nota={p.busquedas.total > 0 ? `${Math.round((p.busquedas.sinResultados / p.busquedas.total) * 1000) / 10} % de las búsquedas` : 'Sin búsquedas'} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Los clics y las conversiones del marketplace todavía no se registran: solo se mide la búsqueda del mapa.</p>
      </section>

      <section className="rounded-2xl border border-border bg-muted/30 p-5 print:border-black">
        <SectionHeader
          title="Supply Economics (Membego → proveedores)"
          description="Otro libro y otro reloj: lo que Membego compra, vende y liquida a sus proveedores. Mes en curso."
          action={<Link href="/superadmin/supply/finanzas" className="print:hidden text-small font-semibold text-primary underline">Finanzas de Supply</Link>}
        />
        {supply ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
              <Celda label="GMV de Supply" valor={dinero(Number(supply.gmv))} nota="Ventas de ofertas adquiridas, este mes" />
              <Celda label="Margen bruto" valor={dinero(Number(supply.grossMargin))} nota={supply.marginPct === null ? 'Sin ventas' : `${supply.marginPct} % del ingreso`} />
              <Celda label="Unidades canjeadas" valor={`${num(supply.unitsRedeemed)} de ${num(supply.unitsSold)}`} nota={`Vencidas sin canjear: ${num(supply.unitsExpired)}${supply.breakageRate === null ? '' : ` (${supply.breakageRate} %)`}`} />
              <Celda label="Por pagar a proveedores" valor={dinero(Number(supply.cxpTotal))} nota={`${num(supply.facturasPendientes)} ${plural(supply.facturasPendientes, 'factura pendiente', 'facturas pendientes')}`} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Las compras de Supply también aparecen arriba como pedidos de origen «Supply», pero esas cifras no se suman a éstas: aquí se mide el costo y el margen del inventario que Membego compra a sus proveedores, que los pedidos no conocen.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No se pudo leer Supply Economics. Los demás números de esta página no dependen de él.</p>
        )}
      </section>
    </ReporteImprimible>
  )
}
