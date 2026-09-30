import { Prisma } from '@prisma/client'
import { decimal, redondear2 } from './dinero'

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

export function validarPreciosOferta(publicPrice: number | string, salePrice: number | string): string | null {
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

export function calcularPrecioOferta(publicPrice: number | string, salePrice: number | string): PrecioOferta {
  const error = validarPreciosOferta(publicPrice, salePrice)
  if (error) throw new Error(error)
  const pub = redondear2(decimal(publicPrice))
  const sale = redondear2(decimal(salePrice))
  const discount = pub.minus(sale)
  const pct = pub.isZero() ? 0 : Number(discount.times(100).dividedBy(pub).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP))
  return { publicPrice: pub, salePrice: sale, discount, discountPercentage: pct }
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
