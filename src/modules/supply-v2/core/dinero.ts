import { Prisma } from '@prisma/client'

/**
 * MEMBEGO SUPPLY 2.0 · dinero.
 *
 * Todo cálculo financiero se hace con `Prisma.Decimal`, nunca con floats de
 * JavaScript como fuente final (§43). Los totales de una orden se recalculan
 * SIEMPRE en el servidor: lo que manda el formulario son entradas, no
 * resultados.
 */

export type Decimal = Prisma.Decimal

export function decimal(n: number | string | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(n)
}

export function redondear2(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
}

export interface LineaTotales {
  quantity: number
  unitCost: number | string | Prisma.Decimal
}

export interface Totales {
  subtotal: Prisma.Decimal
  taxRate: Prisma.Decimal
  taxes: Prisma.Decimal
  total: Prisma.Decimal
  lineas: { subtotal: Prisma.Decimal }[]
}

/** Valida una línea. Devuelve el mensaje de error o `null`. */
export function validarLinea(l: LineaTotales): string | null {
  if (!Number.isInteger(l.quantity) || l.quantity <= 0) {
    return 'La cantidad tiene que ser un entero positivo.'
  }
  let costo: Prisma.Decimal
  try {
    costo = decimal(l.unitCost)
  } catch {
    return 'El costo unitario no es un número.'
  }
  if (!costo.isFinite() || costo.isNegative()) return 'El costo unitario no puede ser negativo.'
  return null
}

/**
 * Subtotal, impuestos y total de una orden. `taxRate` es un porcentaje
 * (0–100) que se aplica sobre el subtotal.
 */
export function calcularTotales(lineas: readonly LineaTotales[], taxRate: number | string = 0): Totales {
  if (lineas.length === 0) throw new Error('Una orden de compra sin líneas no compra nada.')
  for (const l of lineas) {
    const error = validarLinea(l)
    if (error) throw new Error(error)
  }
  const tasa = decimal(taxRate)
  if (!tasa.isFinite() || tasa.isNegative() || tasa.greaterThan(100)) {
    throw new Error('El porcentaje de impuestos tiene que estar entre 0 y 100.')
  }
  const porLinea = lineas.map((l) => ({ subtotal: redondear2(decimal(l.unitCost).times(l.quantity)) }))
  const subtotal = porLinea.reduce((t, l) => t.plus(l.subtotal), decimal(0))
  const taxes = redondear2(subtotal.times(tasa).dividedBy(100))
  return { subtotal, taxRate: tasa, taxes, total: subtotal.plus(taxes), lineas: porLinea }
}

/** Valor adquirido de un conjunto de lotes: unidades × costo congelado. */
export function valorDeLotes(
  lotes: readonly { quantity: number; unitCost: number | string | Prisma.Decimal }[]
): Prisma.Decimal {
  return lotes.reduce((t, l) => t.plus(decimal(l.unitCost).times(l.quantity)), decimal(0))
}

export function aNumero(d: Prisma.Decimal | number | string | null | undefined): number {
  if (d == null) return 0
  return Number(d)
}
