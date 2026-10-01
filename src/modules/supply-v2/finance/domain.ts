import type {
  SupplyV2InvoiceStatus,
  SupplyV2ObligationStatus,
  SupplyV2PayableRecognition,
  SupplyV2SupplierPaymentStatus,
} from '@prisma/client'
import { Prisma } from '@prisma/client'
import { decimal, redondear2, type Decimal } from '../core/dinero'
import type { Transiciones } from '../core/estados'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 4 · reglas PURAS de finanzas del proveedor.
 *
 * Sin Prisma ni base de datos: todo lo que decide cuánto se debe, cuánto se
 * puede aplicar y en qué estado queda cada cosa vive aquí y se prueba solo.
 * Todo dinero es `Prisma.Decimal` (§52); los números de JavaScript entran
 * como entradas y salen como texto ya redondeado.
 */

export const CERO = new Prisma.Decimal(0)

export function dinero(n: number | string | Decimal | null | undefined): Decimal {
  if (n == null || n === '') return CERO
  return redondear2(decimal(n))
}

// ── Factura (§7–§9) ──────────────────────────────────────────────────────────

export interface LineaFacturaEntrada {
  purchaseOrderLineId?: string | null
  catalogItemId?: string | null
  description?: string | null
  quantity: number
  unitCost: number | string | Decimal
}

export interface TotalesFactura {
  subtotal: Decimal
  taxRate: Decimal
  taxes: Decimal
  total: Decimal
  lineas: { subtotal: Decimal; taxes: Decimal; total: Decimal }[]
}

/**
 * Totales de una factura: impuesto por línea (para que las líneas sumen el
 * total) y suma. `taxRate` es porcentaje 0–100. Lanza si algo no cuadra.
 */
export function calcularTotalesFactura(lineas: readonly LineaFacturaEntrada[], taxRate: number | string = 0): TotalesFactura {
  if (lineas.length === 0) throw new Error('Una factura sin líneas no factura nada.')
  const tasa = decimal(taxRate)
  if (!tasa.isFinite() || tasa.isNegative() || tasa.greaterThan(100)) {
    throw new Error('El porcentaje de impuestos tiene que estar entre 0 y 100.')
  }
  const porLinea = lineas.map((l) => {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new Error('La cantidad de cada línea tiene que ser un entero positivo.')
    let costo: Decimal
    try {
      costo = decimal(l.unitCost)
    } catch {
      throw new Error('El costo unitario no es un número.')
    }
    if (!costo.isFinite() || costo.isNegative()) throw new Error('El costo unitario no puede ser negativo.')
    const subtotal = redondear2(costo.times(l.quantity))
    const taxes = redondear2(subtotal.times(tasa).dividedBy(100))
    return { subtotal, taxes, total: subtotal.plus(taxes) }
  })
  const subtotal = porLinea.reduce((t, l) => t.plus(l.subtotal), CERO)
  const taxes = porLinea.reduce((t, l) => t.plus(l.taxes), CERO)
  return { subtotal, taxRate: tasa, taxes, total: subtotal.plus(taxes), lineas: porLinea }
}

export interface LineaOrdenParaFacturar {
  id: string
  quantity: number
  /** Ya facturado en otras facturas vivas (no canceladas). */
  invoicedQuantity: number
  descriptionSnapshot: string
}

/** Mensaje de error o `null`: una factura no factura más de lo comprado (§9). */
export function validarLineasContraOrden(
  lineas: readonly LineaFacturaEntrada[],
  ordenLineas: readonly LineaOrdenParaFacturar[]
): string | null {
  const porId = new Map(ordenLineas.map((l) => [l.id, l]))
  const acumulado = new Map<string, number>()
  for (const l of lineas) {
    if (!l.purchaseOrderLineId) return 'Cada línea de una factura contra una orden tiene que apuntar a una línea de esa orden.'
    const o = porId.get(l.purchaseOrderLineId)
    if (!o) return 'Una línea de la factura no pertenece a esta orden de compra.'
    const ya = acumulado.get(o.id) ?? 0
    const pendiente = o.quantity - o.invoicedQuantity - ya
    if (l.quantity > pendiente) {
      return `${o.descriptionSnapshot}: solo quedan ${Math.max(0, pendiente).toLocaleString('es-DO')} unidades por facturar y se intentan facturar ${l.quantity.toLocaleString('es-DO')}.`
    }
    acumulado.set(o.id, ya + l.quantity)
  }
  return null
}

export const TRANSICIONES_FACTURA: Transiciones<SupplyV2InvoiceStatus> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['PARTIALLY_PAID', 'PAID', 'CANCELLED'],
  PARTIALLY_PAID: ['PAID', 'APPROVED'],
  PAID: ['PARTIALLY_PAID', 'APPROVED'],
  CANCELLED: [],
  CREDITED: [],
}

/** Estados en los que se puede aplicar dinero a una factura. */
export const FACTURA_PAGABLE: readonly SupplyV2InvoiceStatus[] = ['APPROVED', 'PARTIALLY_PAID']

/** Estado de una factura APROBADA según lo cubierto. */
export function estadoFacturaSegunSaldo(total: Decimal, amountPaid: Decimal, amountApplied: Decimal): 'APPROVED' | 'PARTIALLY_PAID' | 'PAID' {
  const cubierto = amountPaid.plus(amountApplied)
  if (cubierto.lessThanOrEqualTo(0)) return 'APPROVED'
  if (cubierto.greaterThanOrEqualTo(total)) return 'PAID'
  return 'PARTIALLY_PAID'
}

// ── Aplicaciones (§14–§16, §55–§56) ──────────────────────────────────────────

/**
 * ¿Se puede aplicar `monto` desde un origen con `disponibleOrigen` a un
 * destino con `pendienteDestino`? Nunca más que lo pendiente (política de
 * sobrepago: el excedente se convierte en depósito EXPLÍCITO, §56) ni más
 * que lo disponible.
 */
export function validarAplicacion(d: {
  monto: number | string | Decimal
  disponibleOrigen: Decimal
  pendienteDestino: Decimal
  origen: string
  destino: string
}): string | null {
  let monto: Decimal
  try {
    monto = decimal(d.monto)
  } catch {
    return 'El monto no es un número.'
  }
  if (!monto.isFinite() || monto.lessThanOrEqualTo(0)) return 'El monto a aplicar tiene que ser mayor que cero.'
  if (!monto.equals(redondear2(monto))) return 'El monto no puede tener más de dos decimales.'
  if (monto.greaterThan(d.pendienteDestino)) {
    return `${d.destino} solo tiene ${d.pendienteDestino.toFixed(2)} pendiente y se intentan aplicar ${monto.toFixed(2)}. No se permite sobrepagar: el excedente se registra como depósito aparte.`
  }
  if (monto.greaterThan(d.disponibleOrigen)) {
    return `${d.origen} solo tiene ${d.disponibleOrigen.toFixed(2)} disponible y se intentan aplicar ${monto.toFixed(2)}.`
  }
  return null
}

// ── Depósito (§11–§12) ───────────────────────────────────────────────────────

/** La suma de los movimientos reconstruye el saldo disponible. */
export function saldoDeMovimientos(movimientos: readonly { amount: Decimal | string | number }[]): Decimal {
  return movimientos.reduce((t, m) => t.plus(decimal(m.amount)), CERO)
}

export function estadoDepositoSegunSaldo(available: Decimal, refunded: Decimal, original: Decimal): 'ACTIVE' | 'EXHAUSTED' | 'REFUNDED' {
  if (available.greaterThan(0)) return 'ACTIVE'
  return refunded.greaterThan(0) && refunded.greaterThanOrEqualTo(original) ? 'REFUNDED' : 'EXHAUSTED'
}

// ── Pago (§13, §41) ──────────────────────────────────────────────────────────

export const TRANSICIONES_PAGO_PROVEEDOR: Transiciones<SupplyV2SupplierPaymentStatus> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED'],
  CANCELLED: [],
}

/**
 * Segregación de funciones (§41), en el servidor: quien creó el pago no lo
 * confirma cuando hay más de una persona autorizada. Con una sola persona
 * autorizada no hay a quién pasarle el pago, y se permite.
 */
export function puedeConfirmarPago(pago: { createdById: string }, actorId: string, personasAutorizadas: number): string | null {
  if (personasAutorizadas > 1 && pago.createdById === actorId) {
    return 'Un pago no lo confirma la misma persona que lo registró: pídele a otra persona autorizada que lo confirme.'
  }
  return null
}

/** Lo mismo para aprobar una factura registrada por uno mismo. */
export function puedeAprobarFactura(factura: { createdById: string }, actorId: string, personasAutorizadas: number): string | null {
  if (personasAutorizadas > 1 && factura.createdById === actorId) {
    return 'Una factura no la aprueba la misma persona que la registró.'
  }
  return null
}

// ── Obligación (§17–§19, §39) ────────────────────────────────────────────────

export function estadoObligacionSegunSaldo(gross: Decimal, paid: Decimal): SupplyV2ObligationStatus {
  if (paid.lessThanOrEqualTo(0)) return 'OPEN'
  if (paid.greaterThanOrEqualTo(gross)) return 'PAID'
  return 'PARTIALLY_PAID'
}

export const OBLIGACION_VIVA: readonly SupplyV2ObligationStatus[] = ['OPEN', 'PARTIALLY_PAID']

/** Política financiera congelada en una versión del acuerdo (§20–§21). */
export interface PoliticaFinanciera {
  payableRecognition: SupplyV2PayableRecognition
  allowDepositApplication: boolean
  paymentTermsDays: number | null
  type: string
  /** Slice 6 (§14): base de la comisión cuando interviene un beneficio. Versiones anteriores: valor contractual. */
  commissionBase: 'CONTRACTUAL_SALE_VALUE' | 'CUSTOMER_PAID_AMOUNT'
}

const RECOGNITIONS: readonly SupplyV2PayableRecognition[] = ['ON_RECEIPT', 'ON_INVOICE', 'ON_REDEMPTION']

/**
 * Lee la política de la FOTO de la versión. Las versiones anteriores al
 * Slice 4 no la traen: se interpretan con los valores por defecto (deuda al
 * aprobar la factura, depósito permitido), nunca con el acuerdo actual.
 */
export function politicaDeVersion(snapshot: unknown): PoliticaFinanciera {
  const s = (snapshot ?? {}) as Record<string, unknown>
  const pr = s.payableRecognition
  const terms = s.paymentTermsDays
  return {
    payableRecognition: typeof pr === 'string' && (RECOGNITIONS as readonly string[]).includes(pr) ? (pr as SupplyV2PayableRecognition) : 'ON_INVOICE',
    allowDepositApplication: typeof s.allowDepositApplication === 'boolean' ? s.allowDepositApplication : true,
    paymentTermsDays: typeof terms === 'number' && Number.isInteger(terms) && terms >= 0 ? terms : null,
    type: typeof s.type === 'string' ? s.type : 'PREPAID_PURCHASE',
    commissionBase: s.commissionBase === 'CUSTOMER_PAID_AMOUNT' ? 'CUSTOMER_PAID_AMOUNT' : 'CONTRACTUAL_SALE_VALUE',
  }
}

/** ¿Este hecho (recepción, factura, redención) crea deuda bajo esta política? */
export function creaObligacion(politica: PoliticaFinanciera, hecho: 'RECEIPT' | 'INVOICE' | 'REDEMPTION'): boolean {
  switch (politica.payableRecognition) {
    case 'ON_RECEIPT':
      // La factura NO duplica lo ya reconocido por recepción: se enlaza (ver obligations.ts).
      return hecho === 'RECEIPT'
    case 'ON_INVOICE':
      return hecho === 'INVOICE'
    case 'ON_REDEMPTION':
      return hecho === 'REDEMPTION'
  }
}

export function vencimientoDeObligacion(recognizedAt: Date, paymentTermsDays: number | null): Date | null {
  if (paymentTermsDays == null) return null
  return new Date(recognizedAt.getTime() + paymentTermsDays * 86_400_000)
}

// ── Conciliación (§43–§46) ───────────────────────────────────────────────────

export function diferenciaConciliacion(internal: Decimal, supplier: Decimal | null): { difference: Decimal | null; status: 'OPEN' | 'MATCHED' | 'DISCREPANCY' } {
  if (supplier == null) return { difference: null, status: 'OPEN' }
  const difference = redondear2(internal.minus(supplier))
  return { difference, status: difference.isZero() ? 'MATCHED' : 'DISCREPANCY' }
}

/** Texto para la pantalla cuando el proveedor no cargó su estado de cuenta (§45). */
export const SIN_INFORMACION_DEL_PROVEEDOR = 'Sin información del proveedor'
