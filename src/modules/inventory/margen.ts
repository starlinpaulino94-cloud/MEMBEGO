import { formatearMonto, type Costo } from './costos'

/**
 * COMMERCE CORE · inventario — INV-4c: el margen real. PURO: sin base de datos ni servidor.
 *
 * QUÉ ES. Para lo que se vendió en un periodo: lo que se cobró por ello (el precio de la línea del pedido, menos su descuento)
 * contra lo que costó (el costo promedio que el ledger CONGELÓ en el movimiento de venta, INV-3a). Margen = ingresos − costo;
 * margen % = margen / ingresos. Es el margen REAL porque usa el costo de aquel instante, no el de hoy.
 *
 * QUÉ SE CUENTA COMO INGRESO. El precio de cada línea del pedido menos su descuento, SIN impuestos y SIN el ajuste del pedido
 * (que no se reparte entre líneas). Solo cuentan los pedidos COMPLETADOS: lo vendido en un pedido que luego se reembolsó no se
 * sostuvo, y sale del margen (se enseña aparte).
 *
 * LO QUE NO SE CONOCE NO SE INVENTA. Una unidad vendida sin costo conocido no entra al margen —ni con costo cero, que inflaría
 * el margen al 100 %—: se cuenta aparte, con lo que se cobró por ella. Igual con lo vendido en otra moneda (el costo no tiene
 * moneda: es el de la empresa) y con lo vendido sin un pedido que diga a cuánto.
 */

// ── Orden y filtros ──────────────────────────────────────────────────────────

export type OrdenMargen = 'margen' | 'peor' | 'porcentaje' | 'ingresos' | 'unidades'

export const ORDENES_MARGEN: readonly OrdenMargen[] = ['margen', 'peor', 'porcentaje', 'ingresos', 'unidades']

export const ORDEN_MARGEN_POR_DEFECTO: OrdenMargen = 'margen'

export const ETIQUETA_ORDEN_MARGEN: Record<OrdenMargen, string> = {
  margen: 'Más margen primero',
  peor: 'Menos margen primero (lo que se vende por debajo del costo)',
  porcentaje: 'Mejor porcentaje primero',
  ingresos: 'Más ingresos primero',
  unidades: 'Más unidades primero',
}

export function esOrdenMargen(v: unknown): v is OrdenMargen {
  return typeof v === 'string' && (ORDENES_MARGEN as readonly string[]).includes(v)
}

/** Los filtros del informe. Las fechas son días LOCALES de la empresa, ambos incluidos (por defecto, los últimos 30). */
export interface FiltrosMargen {
  desde?: string
  hasta?: string
  sucursalId?: string
  q?: string
  orden: OrdenMargen
  pagina: number
}

// ── A qué clase pertenece una venta ──────────────────────────────────────────

/** `MARGEN` entra al cálculo; las demás se enseñan aparte y por qué no entran. */
export type ClaseDeVenta = 'MARGEN' | 'REEMBOLSADO' | 'OTRA_MONEDA' | 'SIN_INGRESO'

export type ClaseExcluida = Exclude<ClaseDeVenta, 'MARGEN'>

export const CLASES_EXCLUIDAS: readonly ClaseExcluida[] = ['REEMBOLSADO', 'OTRA_MONEDA', 'SIN_INGRESO']

export const ETIQUETA_EXCLUIDA: Record<ClaseExcluida, string> = {
  REEMBOLSADO: 'Pedidos reembolsados',
  OTRA_MONEDA: 'Pedidos en otra moneda',
  SIN_INGRESO: 'Ventas sin pedido',
}

export const EXPLICACION_EXCLUIDA: Record<ClaseExcluida, string> = {
  REEMBOLSADO: 'Se vendieron y luego se reembolsó el pedido: lo cobrado se devolvió, así que no cuentan como venta.',
  OTRA_MONEDA: 'El costo del inventario está en la moneda de la empresa; comparar con un precio en otra moneda sería inventar un margen.',
  SIN_INGRESO: 'Salieron como venta pero no hay un pedido completado que diga a cuánto se vendieron.',
}

export function esClaseDeVenta(v: unknown): v is ClaseDeVenta {
  return v === 'MARGEN' || (typeof v === 'string' && (CLASES_EXCLUIDAS as readonly string[]).includes(v))
}

// ── Cifras ───────────────────────────────────────────────────────────────────

const CERO: Costo = BigInt(0)

/** Lo que suman las ventas de un producto (o de todos): en diezmilésimas, como el resto del dinero del inventario. */
export interface CifrasDeVenta {
  unidades: number
  /** Lo cobrado por TODAS las unidades (con o sin costo conocido). */
  ingresos: Costo
  /** Lo que costaron las unidades que SÍ tienen costo conocido. */
  costo: Costo
  /** Unidades vendidas cuyo costo no se conocía. */
  unidadesSinCosto: number
  /** Lo cobrado por esas unidades sin costo: no entran al margen. */
  ingresosSinCosto: Costo
}

export const CIFRAS_VACIAS: CifrasDeVenta = { unidades: 0, ingresos: CERO, costo: CERO, unidadesSinCosto: 0, ingresosSinCosto: CERO }

export function sumarCifras(a: CifrasDeVenta, b: CifrasDeVenta): CifrasDeVenta {
  return {
    unidades: a.unidades + b.unidades,
    ingresos: a.ingresos + b.ingresos,
    costo: a.costo + b.costo,
    unidadesSinCosto: a.unidadesSinCosto + b.unidadesSinCosto,
    ingresosSinCosto: a.ingresosSinCosto + b.ingresosSinCosto,
  }
}

export interface ResultadoMargen {
  /** Lo cobrado por las unidades CON costo conocido: la base del margen. */
  baseConCosto: Costo
  /** baseConCosto − costo; negativo si se vendió por debajo del costo. */
  margen: Costo
  /** margen / baseConCosto en porcentaje con un decimal; null si no hay base (nada vendido con costo conocido, o todo gratis). */
  margenPct: number | null
}

/**
 * Qué parte de `total` es `parte`, en porcentaje con un decimal, con signo (un margen puede ser negativo) y redondeando la mitad
 * ALEJÁNDOSE de cero (−12,25 % → −12,3 %, igual que +12,25 % → 12,3 %). Con enteros grandes, sin pasar por coma flotante hasta
 * el último paso. null si el total no es positivo: sin base no hay porcentaje, y no se inventa.
 */
export function porcentajeFirmado(parte: Costo, total: Costo): number | null {
  if (total <= CERO) return null
  const dos = BigInt(2)
  const numerador = (parte < CERO ? -parte : parte) * BigInt(2000)
  const decimas = (numerador + total) / (total * dos)
  return Number(parte < CERO ? -decimas : decimas) / 10
}

/** El margen de unas cifras de venta. */
export function calcularMargen(c: CifrasDeVenta): ResultadoMargen {
  const baseConCosto = c.ingresos - c.ingresosSinCosto
  const margen = baseConCosto - c.costo
  return { baseConCosto, margen, margenPct: porcentajeFirmado(margen, baseConCosto) }
}

export interface FilaMargen extends CifrasDeVenta, ResultadoMargen {
  varianteId: string
  producto: string
  sku: string
}

export interface TotalMargen extends CifrasDeVenta, ResultadoMargen {
  /** Cuántos productos distintos se vendieron. */
  productos: number
}

/** La fila de un producto: sus cifras y su margen. */
export function filaDeMargen(base: { varianteId: string; producto: string; sku: string } & CifrasDeVenta): FilaMargen {
  return { ...base, ...calcularMargen(base) }
}

/** El total de un conjunto de cifras (todas las ventas que entran al margen). */
export function totalDeMargen(cifras: CifrasDeVenta, productos: number): TotalMargen {
  return { ...cifras, productos, ...calcularMargen(cifras) }
}

/** Lo vendido que NO entra al margen, por clase: unidades y lo que costó lo que sí tenía costo. */
export interface VentasExcluidas {
  clase: ClaseExcluida
  unidades: number
  costo: Costo
  unidadesSinCosto: number
}

export function excluidasVacias(): VentasExcluidas[] {
  return CLASES_EXCLUIDAS.map((clase) => ({ clase, unidades: 0, costo: CERO, unidadesSinCosto: 0 }))
}

/**
 * Un monto que puede ser negativo (un margen por debajo del costo), para enseñarlo: `formatearMonto` solo conoce montos sin signo.
 * «−» es el signo menos de verdad (U+2212) en pantalla; en un archivo se usa `-` (ver `exportacion.ts`) para que la hoja de cálculo lo sume.
 */
export function formatearMontoFirmado(c: Costo, signoMenos = '\u2212'): string {
  return c < CERO ? `${signoMenos}${formatearMonto(-c)}` : formatearMonto(c)
}

/**
 * Un porcentaje (con un decimal, como lo devuelve `porcentajeFirmado`) para enseñarlo: con el MISMO signo menos de verdad que los
 * montos negativos (`formatearMontoFirmado`), así que un margen negativo se lee igual en dinero y en porcentaje. «—» si no hay base.
 */
export function formatearPorcentaje(n: number | null, signoMenos = '\u2212'): string {
  if (n === null) return '—'
  const texto = Math.abs(n).toLocaleString('es-DO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${n < 0 ? signoMenos : ''}${texto} %`
}
