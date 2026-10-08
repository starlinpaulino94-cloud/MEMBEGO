import type { MembegoAttributionChannel } from '@prisma/client'
import { variacion } from '@/modules/reportes/rango'

/**
 * ANALÍTICA DE MEMBEGO · núcleo puro (Fase 6). Sin Prisma ni React: se prueba con números.
 *
 * Qué se mide y qué NO se mide:
 *
 *  · **GMV** = lo que valieron los pedidos Membego COMPLETADOS en el periodo (el `total` del
 *    pedido, sin impuestos), fechados por el día en que se completaron. Un pedido reembolsado deja
 *    de ser GMV; se enseña aparte.
 *  · **Comisión** = lo que Merchant Billing cobró (CONFIRMED) por esos mismos pedidos. Las
 *    comisiones revertidas no cuentan. Los pedidos de Supply NUNCA comisionan, así que ni su GMV ni
 *    sus comisiones entran en la toma (take rate): se enseñan aparte, por origen.
 *  · **Toma (take rate)** = comisión ÷ GMV de los pedidos comisionables.
 *  · **Retorno** = ventas por cada peso pagado a Membego (GMV ÷ comisión).
 *  · **Cliente nuevo** = quien no había completado (ni se le había reembolsado) antes ningún pedido Membego con
 *    esa empresa, de CUALQUIER origen: marketplace, caja o Supply. Es la misma regla que usan las ofertas «solo
 *    clientes nuevos». Es «nuevo para Membego en esa empresa», no «nunca visitó el negocio»: alguien pudo haber
 *    comprado antes sin pasar por Membego.
 *
 * Las cifras son para LEER, no para contabilizar: el libro de Merchant Billing y los pedidos son la
 * fuente de verdad. Aquí el dinero viaja como `number` (suficiente para mostrar dos decimales).
 */

/** Una cifra con su comparación; misma forma que `KpiValor` de los reportes. */
export interface Kpi {
  valor: number
  anterior: number
  /** Porcentaje contra el periodo anterior; `null` si antes no hubo nada. */
  variacion: number | null
}

export function kpi(valor: number, anterior: number): Kpi {
  return { valor, anterior, variacion: variacion(valor, anterior) }
}

const redondear = (n: number, d: number) => {
  const f = 10 ** d
  return Math.round((n + Number.EPSILON) * f) / f
}

/** Pasa a número un valor de la base (Decimal, bigint, string o number); lo no numérico es 0. */
export function aNumero(v: unknown): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(String(v))
  return Number.isFinite(n) ? n : 0
}

/** Ticket promedio: ventas ÷ pedidos. 0 si no hubo pedidos (no «sin dato»: una barra en cero se lee igual). */
export function ticketPromedio(gmv: number, pedidos: number): number {
  return pedidos > 0 ? redondear(gmv / pedidos, 2) : 0
}

/** Toma: comisión ÷ GMV comisionable, en %, con dos decimales. `null` si no hubo ventas. */
export function tomaDeComision(comision: number, gmvComisionable: number): number | null {
  if (!(gmvComisionable > 0)) return null
  return redondear((comision / gmvComisionable) * 100, 2)
}

/** Ventas por cada peso pagado a Membego. `null` si no se pagó nada (dividir por cero no es «infinito»). */
export function retornoSobreCuota(ventas: number, comision: number): number | null {
  if (!(comision > 0)) return null
  return redondear(ventas / comision, 1)
}

/** `parte` de `total` en %, con un decimal. `null` si no hay total. */
export function porcentaje(parte: number, total: number): number | null {
  if (!(total > 0)) return null
  return redondear((parte / total) * 100, 1)
}

/** Costo de conseguir un cliente nuevo: comisión pagada ÷ clientes nuevos. `null` si no hubo ninguno. */
export function costoPorClienteNuevo(comision: number, nuevos: number): number | null {
  if (!(nuevos > 0)) return null
  return redondear(comision / nuevos, 2)
}

// ── Etiquetas ────────────────────────────────────────────────────────────────

export const ETIQUETA_CANAL_ANALITICA: Readonly<Record<MembegoAttributionChannel | 'SIN_ATRIBUCION', string>> = {
  MARKETPLACE_BROWSE: 'Navegando el marketplace',
  MARKETPLACE_SEARCH: 'Buscando en el marketplace',
  PROMOTION_CLAIM: 'Ofertas con presupuesto',
  CAMPAIGN: 'Campañas',
  REFERRAL: 'Referidos',
  QR_SCAN: 'QR escaneado',
  SUPPLY_OFFER: 'Ofertas MembeGo (Supply)',
  DIRECT: 'Directo',
  SIN_ATRIBUCION: 'Sin atribución',
}

// ── Filas que devuelven las consultas ────────────────────────────────────────

export interface FilaPorCanal {
  canal: MembegoAttributionChannel | 'SIN_ATRIBUCION'
  pedidos: number
  ventas: number
}

export interface PuntoDeVentas {
  /** `AAAA-MM-DD` en la zona de quien mira. */
  dia: string
  pedidos: number
  ventas: number
}

export interface FilaDeOfertaAnalitica {
  id: string
  titulo: string
  estado: string
  obtenidas: number
  canjeadas: number
  /** % de lo obtenido que ya se canjeó. */
  conversion: number | null
  /** Lo que pagaron los clientes por los pedidos canjeados (ya con el descuento). */
  ventas: number
  ahorro: number
  /** La cuota de Membego cobrada por esos canjes. */
  cuota: number
  /** Ventas por cada peso de cuota. */
  retorno: number | null
}

export interface EmbudoDePedidos {
  creados: number
  completados: number
  cancelados: number
  /** Siguen vivos (ni completados ni cancelados ni reembolsados). */
  abiertos: number
  /** % de los pedidos creados que se completaron. */
  tasaDeCierre: number | null
}

export function embudo(creados: number, completados: number, cancelados: number, reembolsados: number): EmbudoDePedidos {
  const abiertos = Math.max(0, creados - completados - cancelados - reembolsados)
  return { creados, completados, cancelados: cancelados + reembolsados, abiertos, tasaDeCierre: porcentaje(completados, creados) }
}

/** Rellena los días sin ventas con ceros, para que la gráfica no se salte días. */
export function completarSerie(dias: readonly string[], filas: readonly PuntoDeVentas[]): PuntoDeVentas[] {
  const porDia = new Map(filas.map((f) => [f.dia, f]))
  return dias.map((dia) => porDia.get(dia) ?? { dia, pedidos: 0, ventas: 0 })
}
