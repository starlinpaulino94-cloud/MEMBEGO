import { Prisma } from '@prisma/client'
import type { SupplyV2OfferPriceMode } from '@prisma/client'
import { decimal, redondear2, type Monto } from './dinero'

/**
 * MEMBEGO SUPPLY 2.0 · precios de oferta y de compra (§8, §13, §48).
 *
 * PURO y con Decimal. El servidor recalcula siempre: lo que manda el
 * formulario son precios de entrada, nunca descuentos ni totales.
 */

export interface PrecioOferta {
  publicPrice: Prisma.Decimal
  salePrice: Prisma.Decimal
  /** Lo que ahorra el cliente por unidad. */
  discount: Prisma.Decimal
  /** Porcentaje de descuento con un decimal (33.5). */
  discountPercentage: number
}

export function validarPreciosOferta(publicPrice: Monto, salePrice: Monto): string | null {
  let pub: Prisma.Decimal
  let sale: Prisma.Decimal
  try {
    pub = decimal(publicPrice)
    sale = decimal(salePrice)
  } catch {
    return 'Los precios tienen que ser números.'
  }
  if (!pub.isFinite() || pub.isNegative()) return 'El precio público no puede ser negativo.'
  if (!sale.isFinite() || sale.isNegative()) return 'El precio Membego no puede ser negativo.'
  if (sale.greaterThan(pub)) return 'El precio Membego no puede ser mayor que el precio público.'
  return null
}

export function calcularPrecioOferta(publicPrice: Monto, salePrice: Monto): PrecioOferta {
  const error = validarPreciosOferta(publicPrice, salePrice)
  if (error) throw new Error(error)
  const pub = redondear2(decimal(publicPrice))
  const sale = redondear2(decimal(salePrice))
  const discount = pub.minus(sale)
  const pct = pub.isZero() ? 0 : Number(discount.times(100).dividedBy(pub).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP))
  return { publicPrice: pub, salePrice: sale, discount, discountPercentage: pct }
}

/**
 * Lo que el operador ELIGIÓ al fijar el precio de una oferta.
 *
 * `publicPrice` siempre: es el precio de lista, el ancla de cualquier
 * descuento. Lo que varía es cómo se llega al precio Membego.
 */
export type EntradaPrecioOferta =
  | { mode: 'FIXED'; publicPrice: Monto; salePrice: Monto }
  | { mode: 'PERCENTAGE'; publicPrice: Monto; percentage: Monto }
  | { mode: 'FREE'; publicPrice: Monto }

export interface PrecioResuelto extends PrecioOferta {
  mode: SupplyV2OfferPriceMode
  /** Solo `PERCENTAGE`: lo que se escribió, para poder volver a mostrarlo. */
  percentage: Prisma.Decimal | null
}

/**
 * Resuelve el precio de una oferta en cualquiera de los tres modos.
 *
 * ÚNICO sitio donde se traduce «lo que dijo el operador» a «lo que se cobra»,
 * y termina llamando a `calcularPrecioOferta`, así que la invariante
 * `salePrice <= publicPrice` se comprueba una sola vez para los tres modos.
 *
 * `salePrice` se materializa SIEMPRE, también en PERCENTAGE y en FREE: el
 * checkout, los snapshots de línea y el read-model dependen de él. El modo
 * guarda la intención; `salePrice`, el importe.
 *
 * REDONDEO: se redondea el DESCUENTO y luego se resta, igual que
 * `financiacion.ts`. Si se redondeara el resultado, una oferta al 35 % y un
 * beneficio del 35 % sobre la misma base podrían diferir un centavo, y ese
 * centavo aparecería como un descuadre en la liquidación al proveedor.
 */
export function resolverPrecioOferta(e: EntradaPrecioOferta): PrecioResuelto {
  const pub = redondear2(decimal(e.publicPrice))
  if (!pub.isFinite() || pub.isNegative()) throw new Error('El precio público no puede ser negativo.')

  if (e.mode === 'FREE') {
    return { ...calcularPrecioOferta(pub, 0), mode: 'FREE', percentage: null }
  }
  if (e.mode === 'FIXED') {
    return { ...calcularPrecioOferta(pub, e.salePrice), mode: 'FIXED', percentage: null }
  }

  let pct: Prisma.Decimal
  try {
    pct = decimal(e.percentage)
  } catch {
    return (() => {
      throw new Error('El porcentaje tiene que ser un número.')
    })()
  }
  if (!pct.isFinite() || pct.lessThanOrEqualTo(0)) throw new Error('Un porcentaje de descuento tiene que ser mayor que cero.')
  if (pct.greaterThan(100)) throw new Error('Un porcentaje no puede superar 100.')
  const descuento = redondear2(pub.times(pct).dividedBy(100))
  return { ...calcularPrecioOferta(pub, pub.minus(descuento)), mode: 'PERCENTAGE', percentage: pct }
}

/** Lo que un formulario manda sobre el precio, en cualquiera de los tres modos. */
export interface DatosPrecio {
  publicPrice: Monto
  /** Solo se usa en `FIXED`. En PERCENTAGE y FREE lo calcula el servidor. */
  salePrice?: Monto | null
  priceMode?: SupplyV2OfferPriceMode | null
  priceModePercentage?: Monto | null
}

/**
 * Pasa de «lo que mandó el formulario» a un precio resuelto.
 *
 * Existe para que las TRES puertas por las que entra un precio —oferta de
 * supply, oferta a comisión y edición— compartan la traducción. Antes cada una
 * llamaba a `calcularPrecioOferta` con dos montos; si cada una interpretara el
 * modo por su cuenta, el día que una se olvidara del porcentaje cobraría el
 * precio de lista sin avisar.
 *
 * Sin modo = `FIXED`: es lo que han hecho siempre las ofertas que ya existen.
 */
export function resolverPrecioDeDatos(d: DatosPrecio): PrecioResuelto {
  const mode = d.priceMode ?? 'FIXED'
  if (mode === 'FREE') return resolverPrecioOferta({ mode: 'FREE', publicPrice: d.publicPrice })
  if (mode === 'PERCENTAGE') {
    if (d.priceModePercentage == null || d.priceModePercentage === '') {
      throw new Error('Una oferta por porcentaje necesita el porcentaje.')
    }
    return resolverPrecioOferta({ mode: 'PERCENTAGE', publicPrice: d.publicPrice, percentage: d.priceModePercentage })
  }
  if (d.salePrice == null || d.salePrice === '') throw new Error('Una oferta de precio fijo necesita el precio Membego.')
  return resolverPrecioOferta({ mode: 'FIXED', publicPrice: d.publicPrice, salePrice: d.salePrice })
}

/** Valida `DatosPrecio` sin lanzar. Devuelve el mensaje o `null`. */
export function validarDatosPrecio(d: DatosPrecio): string | null {
  const mode = d.priceMode ?? 'FIXED'
  const porModo = validarModoPrecio(mode, d.priceModePercentage)
  if (porModo) return porModo
  try {
    resolverPrecioDeDatos(d)
  } catch (e) {
    return e instanceof Error ? e.message : 'El precio no es válido.'
  }
  return null
}

/**
 * Valida la coherencia entre modo y porcentaje ANTES de tocar la base. Devuelve
 * el mensaje o `null`. Es la misma regla que los CHECK de la migración: aquí
 * para dar un mensaje decente, allí para que no entre por otra puerta.
 */
export function validarModoPrecio(mode: SupplyV2OfferPriceMode, percentage: Monto | null | undefined): string | null {
  const traePct = percentage != null && percentage !== ''
  if (mode === 'PERCENTAGE' && !traePct) return 'Una oferta por porcentaje necesita el porcentaje.'
  if (mode !== 'PERCENTAGE' && traePct) return 'El porcentaje solo se guarda en una oferta por porcentaje.'
  if (!traePct) return null
  let pct: Prisma.Decimal
  try {
    pct = decimal(percentage)
  } catch {
    return 'El porcentaje tiene que ser un número.'
  }
  if (!pct.isFinite() || pct.lessThanOrEqualTo(0)) return 'Un porcentaje de descuento tiene que ser mayor que cero.'
  if (pct.greaterThan(100)) return 'Un porcentaje no puede superar 100.'
  return null
}

/** Margen estimado por unidad = precio Membego − costo estimado (§13). */
export function margenEstimado(salePrice: number | string, costoEstimado: number | string): Prisma.Decimal {
  return redondear2(decimal(salePrice).minus(decimal(costoEstimado)))
}

export interface LineaCliente {
  quantity: number
  publicUnitPrice: Prisma.Decimal
  saleUnitPrice: Prisma.Decimal
  /** precio público × cantidad */
  subtotal: Prisma.Decimal
  /** ahorro total */
  discount: Prisma.Decimal
  /** precio Membego × cantidad = lo que paga el cliente */
  total: Prisma.Decimal
}

export function calcularLineaCliente(publicUnitPrice: number | string | Prisma.Decimal, saleUnitPrice: number | string | Prisma.Decimal, quantity: number): LineaCliente {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('La cantidad tiene que ser un entero positivo.')
  const pub = redondear2(decimal(publicUnitPrice))
  const sale = redondear2(decimal(saleUnitPrice))
  if (sale.greaterThan(pub)) throw new Error('El precio Membego no puede ser mayor que el precio público.')
  const subtotal = pub.times(quantity)
  const total = sale.times(quantity)
  return { quantity, publicUnitPrice: pub, saleUnitPrice: sale, subtotal, discount: subtotal.minus(total), total }
}

/** El monto visto en el banco cuadra con lo esperado (tolerancia de un centavo). */
export function montoCuadra(visto: number | string | Prisma.Decimal, esperado: number | string | Prisma.Decimal): boolean {
  try {
    return decimal(visto).minus(decimal(esperado)).abs().lessThan('0.01')
  } catch {
    return false
  }
}
