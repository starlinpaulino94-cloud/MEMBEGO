import type {
  MembegoAttributionChannel,
  MembegoOrderStatus,
  MembegoPaymentEvidenceSource,
  MembegoPaymentMethod,
  MembegoVerificationLevel,
  Prisma,
} from '@prisma/client'
import { type Monto, decimal, mismoMonto, redondear2 } from '@/lib/commerce-primitives/dinero'
import { type Transiciones, puedeTransicionar as puedeTransicionarTabla } from '@/lib/commerce-primitives/estados'

/**
 * COMMERCE CORE · pedidos Membego — el dominio PURO (Fase 3).
 *
 * Sin Prisma ni base de datos: decide qué estado puede seguir a cuál, cuánto
 * suma un pedido y qué nivel de verificación tiene según la evidencia que hay.
 * Lo que escribe en la base es `service.ts`.
 *
 * Las tablas de aquí tienen su gemela en la base (disparador
 * `membego_orders_reglas` y CHECKs de la migración `20261042_membego_orders`);
 * las pruebas contra PostgreSQL recorren todas las combinaciones para que no se
 * separen.
 */

// ── Máquina de estados ───────────────────────────────────────────────────────

export const ESTADOS: readonly MembegoOrderStatus[] = [
  'CREATED',
  'AWAITING_MERCHANT',
  'IN_PROGRESS',
  'READY',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
]

/**
 * Una transición que no esté aquí NO OCURRE. El pedido nace CREATED; el
 * servicio lo pasa enseguida a AWAITING_MERCHANT (la empresa tiene que aceptarlo).
 * La empresa puede saltarse IN_PROGRESS cuando no hay nada que preparar (un
 * voucher): AWAITING_MERCHANT → READY.
 */
export const TRANSICIONES: Transiciones<MembegoOrderStatus> = {
  CREATED: ['AWAITING_MERCHANT', 'CANCELLED'],
  AWAITING_MERCHANT: ['IN_PROGRESS', 'READY', 'CANCELLED'],
  IN_PROGRESS: ['READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
}

export function puedeTransicionar(desde: MembegoOrderStatus, hasta: MembegoOrderStatus): boolean {
  return puedeTransicionarTabla(TRANSICIONES, desde, hasta)
}

/** Estados de los que no se sale (o cuyo monto ya no se toca). */
export const ESTADOS_CERRADOS: readonly MembegoOrderStatus[] = ['COMPLETED', 'CANCELLED', 'REFUNDED']
/** Estados en los que el pedido todavía puede cancelarse. */
export const ESTADOS_CANCELABLES: readonly MembegoOrderStatus[] = ['CREATED', 'AWAITING_MERCHANT', 'IN_PROGRESS', 'READY']
/** Estados en los que el cliente puede cancelar él mismo: antes de que la empresa acepte. */
export const ESTADOS_CANCELABLES_POR_CLIENTE: readonly MembegoOrderStatus[] = ['CREATED', 'AWAITING_MERCHANT']
/** Estados en los que la empresa puede ajustar el monto. */
export const ESTADOS_AJUSTABLES: readonly MembegoOrderStatus[] = ['AWAITING_MERCHANT', 'IN_PROGRESS', 'READY']
/**
 * Estados en los que el cliente puede confirmar el monto. Antes de que la
 * empresa acepte el monto no es firme; después de cobrar, confirmarlo todavía
 * sirve (sube el nivel de verificación).
 */
export const ESTADOS_CONFIRMABLES: readonly MembegoOrderStatus[] = ['IN_PROGRESS', 'READY', 'COMPLETED']
/** Estados en los que se puede registrar el pago hecho fuera de la plataforma. */
export const ESTADOS_CON_PAGO_REGISTRABLE: readonly MembegoOrderStatus[] = ['READY', 'COMPLETED']

export function esFinal(estado: MembegoOrderStatus): boolean {
  return TRANSICIONES[estado].length === 0
}

// ── Atribución ───────────────────────────────────────────────────────────────

export interface DatosAtribucion {
  channel: MembegoAttributionChannel
  campaignId?: string | null
  promotionId?: string | null
  referralCode?: string | null
  supplyV2OfferId?: string | null
}

export const CANALES: readonly MembegoAttributionChannel[] = [
  'MARKETPLACE_BROWSE',
  'MARKETPLACE_SEARCH',
  'PROMOTION_CLAIM',
  'CAMPAIGN',
  'REFERRAL',
  'QR_SCAN',
  'SUPPLY_OFFER',
  'DIRECT',
]

/**
 * Qué dato identifica a cada canal (null = ninguno). Es la MISMA regla que el
 * CHECK `order_attributions_canal`.
 */
export const DATO_DEL_CANAL: Record<MembegoAttributionChannel, keyof Omit<DatosAtribucion, 'channel'> | null> = {
  MARKETPLACE_BROWSE: null,
  MARKETPLACE_SEARCH: null,
  PROMOTION_CLAIM: 'promotionId',
  CAMPAIGN: 'campaignId',
  REFERRAL: 'referralCode',
  QR_SCAN: null,
  SUPPLY_OFFER: 'supplyV2OfferId',
  DIRECT: null,
}

const ETIQUETA_DATO: Record<keyof Omit<DatosAtribucion, 'channel'>, string> = {
  promotionId: 'la promoción',
  campaignId: 'la campaña',
  referralCode: 'el código de referido',
  supplyV2OfferId: 'la oferta de Supply',
}

/** Devuelve el mensaje de error o `null`. */
export function validarAtribucion(a: DatosAtribucion): string | null {
  if (!CANALES.includes(a.channel)) return 'El canal de atribución no es válido.'
  const requerido = DATO_DEL_CANAL[a.channel]
  if (requerido) {
    const valor = a[requerido]
    if (typeof valor !== 'string' || valor.trim() === '') return `El canal ${a.channel} necesita ${ETIQUETA_DATO[requerido]}.`
  }
  return null
}

// ── Dinero ───────────────────────────────────────────────────────────────────

/**
 * Pedidos que una persona puede tener abiertos a la vez en una misma empresa
 * (esperando, en preparación o listos). Cada pedido aparta inventario hasta que
 * se cierra; sin tope, una cuenta podría apartar todo el stock con pedidos que
 * nunca recoge. Es un freno contra el abuso, no una regla del negocio: lo aplica la
 * acción del cliente, no el servicio (caja y API crean pedidos por su cuenta).
 */
export const MAX_PEDIDOS_ABIERTOS_POR_CLIENTE = 5
export const ESTADOS_ABIERTOS: readonly MembegoOrderStatus[] = ['AWAITING_MERCHANT', 'IN_PROGRESS', 'READY']

export const CANTIDAD_MAXIMA_POR_LINEA = 10_000
export const LINEAS_MAXIMAS = 100
export const MONTO_MAXIMO = 999_999_999.99

export interface LineaEntrada {
  quantity: number
  unitPrice: Monto
  discount?: Monto
}

export interface LineaCalculada {
  quantity: number
  unitPrice: Prisma.Decimal
  discount: Prisma.Decimal
  /** `quantity × unitPrice` antes del descuento (lo que suma `subtotal`). */
  bruto: Prisma.Decimal
  /** `quantity × unitPrice − discount`. */
  lineTotal: Prisma.Decimal
}

export interface TotalesPedido {
  subtotal: Prisma.Decimal
  discount: Prisma.Decimal
  adjustment: Prisma.Decimal
  commissionableBase: Prisma.Decimal
  tax: Prisma.Decimal
  total: Prisma.Decimal
  lineas: LineaCalculada[]
}

function aDecimal(n: Monto | undefined, nombre: string): Prisma.Decimal | string {
  try {
    const d = decimal(n ?? 0)
    if (!d.isFinite()) return `${nombre} no es un número.`
    return d
  } catch {
    return `${nombre} no es un número.`
  }
}

/** Valida una línea. Devuelve el mensaje de error o `null`. */
export function validarLineaPedido(l: LineaEntrada): string | null {
  if (!Number.isInteger(l.quantity) || l.quantity <= 0) return 'La cantidad tiene que ser un entero positivo.'
  if (l.quantity > CANTIDAD_MAXIMA_POR_LINEA) return `La cantidad máxima por línea es ${CANTIDAD_MAXIMA_POR_LINEA}.`
  const precio = aDecimal(l.unitPrice, 'El precio unitario')
  if (typeof precio === 'string') return precio
  if (precio.isNegative()) return 'El precio unitario no puede ser negativo.'
  const descuento = aDecimal(l.discount, 'El descuento')
  if (typeof descuento === 'string') return descuento
  if (descuento.isNegative()) return 'El descuento no puede ser negativo.'
  if (descuento.greaterThan(redondear2(precio.times(l.quantity)))) return 'El descuento no puede superar el valor de la línea.'
  return null
}

/**
 * Subtotal, descuento, ajuste, base comisionable, impuestos y total.
 *
 *   subtotal           = Σ cantidad × precio
 *   discount           = Σ descuentos de línea
 *   commissionableBase = subtotal − discount + adjustment      (≥ 0)
 *   total              = commissionableBase + tax
 *
 * LANZA `Error` si algo no es válido (un pedido sin líneas, un monto negativo…).
 * Es la MISMA aritmética que los CHECK de `membego_orders`.
 */
export function calcularPedido(
  lineas: readonly LineaEntrada[],
  opciones: { adjustment?: Monto; tax?: Monto } = {}
): TotalesPedido {
  if (lineas.length === 0) throw new Error('Un pedido sin líneas no pide nada.')
  if (lineas.length > LINEAS_MAXIMAS) throw new Error(`Un pedido admite como máximo ${LINEAS_MAXIMAS} líneas.`)
  for (const l of lineas) {
    const error = validarLineaPedido(l)
    if (error) throw new Error(error)
  }

  const calculadas: LineaCalculada[] = lineas.map((l) => {
    const unitPrice = redondear2(decimal(l.unitPrice))
    const discount = redondear2(decimal(l.discount ?? 0))
    const bruto = redondear2(unitPrice.times(l.quantity))
    return { quantity: l.quantity, unitPrice, discount, bruto, lineTotal: bruto.minus(discount) }
  })

  const subtotal = calculadas.reduce((t, l) => t.plus(l.bruto), decimal(0))
  const discount = calculadas.reduce((t, l) => t.plus(l.discount), decimal(0))

  const ajuste = aDecimal(opciones.adjustment, 'El ajuste')
  if (typeof ajuste === 'string') throw new Error(ajuste)
  const impuesto = aDecimal(opciones.tax, 'El impuesto')
  if (typeof impuesto === 'string') throw new Error(impuesto)
  if (impuesto.isNegative()) throw new Error('El impuesto no puede ser negativo.')

  const adjustment = redondear2(ajuste)
  const tax = redondear2(impuesto)
  const commissionableBase = subtotal.minus(discount).plus(adjustment)
  if (commissionableBase.isNegative()) throw new Error('El ajuste no puede dejar el pedido en negativo.')
  const total = commissionableBase.plus(tax)
  if (total.greaterThan(MONTO_MAXIMO)) throw new Error('El monto del pedido excede el máximo permitido.')

  return { subtotal, discount, adjustment, commissionableBase, tax, total, lineas: calculadas }
}

export const MOTIVO_MAXIMO = 300

/** Motivo de un ajuste, una cancelación o un reembolso: obligatorio y acotado. */
export function normalizarMotivoPedido(m: unknown): { ok: true; valor: string } | { ok: false; error: string } {
  if (typeof m !== 'string' || m.trim() === '') return { ok: false, error: 'Indica el motivo.' }
  const t = m.trim()
  if (t.length > MOTIVO_MAXIMO) return { ok: false, error: `El motivo admite como máximo ${MOTIVO_MAXIMO} caracteres.` }
  return { ok: true, valor: t }
}

export const NOTA_MAXIMA = 500

/** Nota libre del cliente: opcional, acotada. */
export function normalizarNota(n: unknown): { ok: true; valor: string | null } | { ok: false; error: string } {
  if (n === undefined || n === null) return { ok: true, valor: null }
  if (typeof n !== 'string') return { ok: false, error: 'La nota no es válida.' }
  const t = n.trim()
  if (t === '') return { ok: true, valor: null }
  if (t.length > NOTA_MAXIMA) return { ok: false, error: `La nota admite como máximo ${NOTA_MAXIMA} caracteres.` }
  return { ok: true, valor: t }
}

// ── Nivel de verificación ────────────────────────────────────────────────────

/**
 * De menos a más evidencia. ESTE orden manda (no el del enum en la base, donde
 * `EXTERNAL_PAYMENT_REPORTED` se añadió al final por cómo PostgreSQL amplía un enum).
 */
export const NIVELES: readonly MembegoVerificationLevel[] = [
  'ATTRIBUTED',
  'REDEEMED',
  'CUSTOMER_VERIFIED',
  'EXTERNAL_PAYMENT_REPORTED',
  'PAYMENT_VERIFIED',
  'FISCALLY_RECONCILED',
]

export function rangoDeNivel(n: MembegoVerificationLevel): number {
  return NIVELES.indexOf(n)
}

/**
 * Quién respalda una constancia de pago. `MERCHANT_REPORTED` es lo que la
 * empresa registra (caja, panel): su palabra. Las demás son fuentes EXTERNAS a
 * la empresa que Membego puede cotejar, y solo las escribe el sistema o el
 * superadmin con la referencia del hecho (`verificarPagoExternamenteEnTx`).
 */
export const FUENTES_DE_PAGO: readonly MembegoPaymentEvidenceSource[] = ['MERCHANT_REPORTED', 'GATEWAY_VERIFIED', 'BANK_RECONCILED', 'PROVIDER_VERIFIED']
export const FUENTES_EXTERNAS: readonly MembegoPaymentEvidenceSource[] = ['GATEWAY_VERIFIED', 'BANK_RECONCILED', 'PROVIDER_VERIFIED']

export interface PagoRegistrado {
  method: MembegoPaymentMethod
  amount: Monto
  reference: string | null
  /** Sin fuente (código anterior a la distinción) se trata como reportado por la empresa. */
  source?: MembegoPaymentEvidenceSource | null
}

export interface EvidenciaDePedido {
  status: MembegoOrderStatus
  total: Monto
  /** La confirmación del cliente, si existe. */
  confirmacion: { confirmedTotal: Monto } | null
  /** El pago registrado, si existe. */
  pago: PagoRegistrado | null
}

/**
 * Métodos cuyo registro, con referencia, cuenta como pago REPORTADO (y, si lo
 * respalda una fuente externa, verificado). El efectivo y «otro» dejan constancia
 * pero ni siquiera reportan: sin un comprobante que alguien más pueda cotejar,
 * es la palabra de la empresa sin nada detrás.
 */
export const METODOS_VERIFICABLES: readonly MembegoPaymentMethod[] = ['CARD', 'TRANSFER', 'MEMBEGO_CHECKOUT']

/** ¿Es una confirmación vigente? Solo si confirma el monto ACTUAL del pedido. */
export function confirmacionVigente(total: Monto, confirmacion: { confirmedTotal: Monto } | null): boolean {
  return confirmacion !== null && mismoMonto(confirmacion.confirmedTotal, total)
}

/**
 * ¿Es un pago REPORTADO? Método verificable, referencia, y el monto del pedido.
 * Es lo que un empleado puede afirmar desde la caja; no dice quién lo respalda.
 */
export function pagoReportado(total: Monto, pago: EvidenciaDePedido['pago']): boolean {
  if (!pago) return false
  if (!METODOS_VERIFICABLES.includes(pago.method)) return false
  if (typeof pago.reference !== 'string' || pago.reference.trim() === '') return false
  return mismoMonto(pago.amount, total)
}

/**
 * ¿Es un pago VERIFICADO? Un pago reportado que además respalda una fuente externa
 * a la empresa (pasarela firmada, conciliación bancaria, proveedor). Una referencia
 * tecleada en caja NO verifica: la verificación llega de fuera, nunca de la misma
 * empresa que cobra.
 */
export function pagoVerificado(total: Monto, pago: EvidenciaDePedido['pago']): boolean {
  if (!pagoReportado(total, pago)) return false
  return FUENTES_EXTERNAS.includes(pago?.source ?? 'MERCHANT_REPORTED')
}

/**
 * El nivel de verificación que corresponde a la evidencia que hay. Es una
 * CADENA: cada nivel exige el anterior.
 *
 *   ATTRIBUTED                 el pedido existe y tiene origen.
 *   REDEEMED                   el QR cerró la operación (COMPLETED).
 *   CUSTOMER_VERIFIED          + el cliente confirmó el monto vigente.
 *   EXTERNAL_PAYMENT_REPORTED  + la empresa registró un pago por ese monto con
 *                                método verificable y referencia (su palabra).
 *   PAYMENT_VERIFIED           + una fuente externa confirmó ese pago.
 *   FISCALLY_RECONCILED        no se deriva aquí: lo fijará una fase posterior
 *                              con el comprobante fiscal.
 *
 * Un pedido que no está COMPLETED (o ya reembolsado tras completarse) no pasa
 * de ATTRIBUTED: la evidencia cuenta cuando el servicio se prestó.
 */
export function nivelDeVerificacion(e: EvidenciaDePedido): MembegoVerificationLevel {
  if (e.status !== 'COMPLETED' && e.status !== 'REFUNDED') return 'ATTRIBUTED'
  if (!confirmacionVigente(e.total, e.confirmacion)) return 'REDEEMED'
  if (!pagoReportado(e.total, e.pago)) return 'CUSTOMER_VERIFIED'
  if (!pagoVerificado(e.total, e.pago)) return 'EXTERNAL_PAYMENT_REPORTED'
  return 'PAYMENT_VERIFIED'
}

export const REFERENCIA_VERIFICACION_MAXIMA = 120

/**
 * Valida lo que una fuente externa afirma de un pago. Devuelve el mensaje de error o `null`.
 * La referencia del hecho externo es obligatoria: sin ella no hay nada que cotejar ni
 * clave con la que no repetir la verificación.
 */
export function validarVerificacionExterna(v: { source: MembegoPaymentEvidenceSource; verificationRef?: unknown; method: MembegoPaymentMethod; amount: Monto; reference?: string | null }): string | null {
  if (!FUENTES_EXTERNAS.includes(v.source)) return 'La fuente de la verificación no es externa.'
  if (typeof v.verificationRef !== 'string' || v.verificationRef.trim() === '') return 'La verificación necesita la referencia del hecho externo.'
  if (v.verificationRef.trim().length > REFERENCIA_VERIFICACION_MAXIMA) return `La referencia de la verificación admite como máximo ${REFERENCIA_VERIFICACION_MAXIMA} caracteres.`
  if (!METODOS_VERIFICABLES.includes(v.method)) return 'Solo se verifica un pago con tarjeta, transferencia o checkout.'
  return validarPago({ method: v.method, amount: v.amount, reference: v.reference })
}

// ── Pago registrado ──────────────────────────────────────────────────────────

export const REFERENCIA_PAGO_MAXIMA = 80

/** Valida el pago registrado. Devuelve el mensaje de error o `null`. */
export function validarPago(p: { method: MembegoPaymentMethod; amount: Monto; reference?: string | null }): string | null {
  const monto = aDecimal(p.amount, 'El monto del pago')
  if (typeof monto === 'string') return monto
  if (monto.isNegative()) return 'El monto del pago no puede ser negativo.'
  if (monto.greaterThan(MONTO_MAXIMO)) return 'El monto del pago excede el máximo permitido.'
  if (p.reference != null && p.reference.trim().length > REFERENCIA_PAGO_MAXIMA) {
    return `La referencia admite como máximo ${REFERENCIA_PAGO_MAXIMA} caracteres.`
  }
  return null
}

// ── QR ───────────────────────────────────────────────────────────────────────

/**
 * Días que vive el QR de un pedido listo. Corto a propósito: el cliente lo
 * enseña al recoger, no a lo largo de un año como el de una membresía. Si
 * vence, el cliente (o la empresa) pide uno nuevo y el anterior deja de valer.
 */
export const DIAS_VIGENCIA_QR_PEDIDO = 7

export function vencimientoQrPedido(desde: Date): Date {
  const d = new Date(desde)
  d.setDate(d.getDate() + DIAS_VIGENCIA_QR_PEDIDO)
  return d
}

export function qrDePedidoVencido(qrExpiresAt: Date | null, ahora: Date): boolean {
  return qrExpiresAt === null || qrExpiresAt.getTime() <= ahora.getTime()
}
