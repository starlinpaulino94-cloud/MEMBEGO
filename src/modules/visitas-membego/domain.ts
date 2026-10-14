import type { AncillaryCommissionStatus, AncillaryEvidenceLevel, AncillarySaleStatus, MembegoVisitStatus, VisitDisputeStatus } from '@prisma/client'
import { decimal, redondear2, type Decimal, type Monto } from '@/lib/commerce-primitives/dinero'
import { repartirComision, validarPorcentajeComision } from '@/lib/commerce-primitives/comision'
import type { Transiciones } from '@/lib/commerce-primitives/estados'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · VISITA ATRIBUIDA · reglas puras (§22–§38).
 *
 * Sin Prisma. Todo lo que decide dinero vive aquí y se prueba sin base:
 *
 *   · la POLÍTICA de ventas adicionales que se congela al abrir la visita
 *     (acuerdo → cuenta Merchant Billing → plataforma);
 *   · la base comisionable de una venta adicional = el subtotal de los EXTRAS
 *     (lo que el cliente pagó de más). La unidad que Membego ya compró NUNCA
 *     entra: no es una línea de la venta, es la redención (§28, §72);
 *   · la comisión = base × tasa, en dos decimales, con el mismo reparto que
 *     usa Supply (`repartirComision`), así 8 % de RD$400 son RD$32;
 *   · cuándo se asienta (al reportar, o al confirmar si el acuerdo lo exige);
 *   · qué asiento corrige una disputa (reverso total o ajuste parcial): nunca
 *     se edita la comisión histórica (§35);
 *   · las transiciones de visita, venta y disputa.
 */

// ── Política (§37) ──────────────────────────────────────────────────────────

export const TASA_EXTRAS_POR_DEFECTO = '8.00'
export const VENTANA_ATRIBUCION_POR_DEFECTO_MIN = 120

export interface PoliticaDeExtras {
  ancillaryCommissionEnabled: boolean
  /** Porcentaje (0–100), dos decimales en texto. */
  ancillaryCommissionRate: string
  attributionWindowMinutes: number
  requiresCustomerConfirmation: boolean
  receiptRequiredAbove: string | null
}

export interface FuentesDePolitica {
  /** La foto de la versión del acuerdo (o el acuerdo vivo) del derecho canjeado. */
  acuerdo?: {
    ancillaryCommissionEnabled?: boolean | null
    ancillaryCommissionRate?: Monto | null
    attributionWindowMinutes?: number | null
    requiresCustomerConfirmation?: boolean | null
    receiptRequiredAbove?: Monto | null
  } | null
  /** La cuenta Merchant Billing de la empresa (su tasa porcentual). */
  cuenta?: { percentageRate: Monto } | null
}

/** Acuerdo > cuenta de la empresa > plataforma (8 %). Siempre devuelve algo válido. */
export function resolverPoliticaDeExtras(f: FuentesDePolitica): PoliticaDeExtras {
  const a = f.acuerdo ?? null
  const tasaAcuerdo = a?.ancillaryCommissionRate != null ? decimal(a.ancillaryCommissionRate) : null
  const tasaCuenta = f.cuenta ? decimal(f.cuenta.percentageRate) : null
  const tasa = tasaAcuerdo ?? tasaCuenta ?? decimal(TASA_EXTRAS_POR_DEFECTO)
  if (validarPorcentajeComision(tasa)) throw new Error('La tasa de comisión de ventas adicionales no es válida.')
  const ventana = a?.attributionWindowMinutes ?? VENTANA_ATRIBUCION_POR_DEFECTO_MIN
  if (!Number.isInteger(ventana) || ventana <= 0) throw new Error('La ventana de atribución tiene que ser un entero positivo de minutos.')
  return {
    ancillaryCommissionEnabled: a?.ancillaryCommissionEnabled ?? true,
    ancillaryCommissionRate: redondear2(tasa).toFixed(2),
    attributionWindowMinutes: ventana,
    requiresCustomerConfirmation: a?.requiresCustomerConfirmation ?? false,
    receiptRequiredAbove: a?.receiptRequiredAbove != null ? redondear2(decimal(a.receiptRequiredAbove)).toFixed(2) : null,
  }
}

/** Hasta cuándo pertenece a la visita una compra (§38). */
export function finDeVentana(openedAt: Date, politica: Pick<PoliticaDeExtras, 'attributionWindowMinutes'>): Date {
  return new Date(openedAt.getTime() + politica.attributionWindowMinutes * 60_000)
}

export function dentroDeVentana(openedAt: Date, politica: Pick<PoliticaDeExtras, 'attributionWindowMinutes'>, ahora: Date): boolean {
  return ahora.getTime() <= finDeVentana(openedAt, politica).getTime()
}

// ── Líneas y totales de una venta adicional (§24–§26, §55) ──────────────────

export interface LineaDeExtraEntrada {
  /** Del mini catálogo (el precio lo relee el servidor) … */
  supplyCatalogItemId?: string | null
  /** … o personalizada: descripción y precio del operador. */
  description?: string | null
  quantity: number
  /** Solo en la línea personalizada. En una de catálogo se IGNORA (§55). */
  unitPrice?: Monto | null
}

export interface ItemDelMiniCatalogo {
  id: string
  name: string
  publicPrice: Monto | null
  sellableAsExtra: boolean
  status: string
}

export interface LineaDeExtraResuelta {
  kind: 'CATALOG_ITEM' | 'CUSTOM_REPORTED_LINE'
  supplyCatalogItemId: string | null
  description: string
  quantity: number
  unitPrice: Decimal
  lineTotal: Decimal
  priceSource: 'CATALOG' | 'OPERATOR'
}

export const MAX_LINEAS_POR_VENTA = 30
export const TOPE_VENTA_ADICIONAL = decimal('1000000')

/**
 * Resuelve las líneas CONTRA EL CATÁLOGO (nunca contra lo que mandó el
 * navegador): una línea de catálogo toma el precio del ítem; una personalizada
 * queda marcada como tal. Devuelve el error, o las líneas.
 */
export function resolverLineasDeExtra(
  entrada: readonly LineaDeExtraEntrada[],
  catalogo: readonly ItemDelMiniCatalogo[]
): { error: string } | { lineas: LineaDeExtraResuelta[]; subtotal: Decimal; hasCustomLines: boolean } {
  if (entrada.length === 0) return { error: 'Agrega al menos una compra adicional.' }
  if (entrada.length > MAX_LINEAS_POR_VENTA) return { error: `Como máximo ${MAX_LINEAS_POR_VENTA} líneas por venta.` }
  const porId = new Map(catalogo.map((i) => [i.id, i]))
  const lineas: LineaDeExtraResuelta[] = []
  let hasCustomLines = false
  for (const l of entrada) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0 || l.quantity > 999) return { error: 'La cantidad tiene que ser un entero entre 1 y 999.' }
    if (l.supplyCatalogItemId) {
      const item = porId.get(l.supplyCatalogItemId)
      if (!item) return { error: 'Ese extra no es de tu catálogo.' }
      if (!item.sellableAsExtra || item.status !== 'ACTIVE') return { error: `«${item.name}» no está activo como extra.` }
      if (item.publicPrice == null) return { error: `«${item.name}» no tiene precio: ponle uno en Configuración.` }
      const unitPrice = redondear2(decimal(item.publicPrice))
      if (unitPrice.isNegative()) return { error: `«${item.name}» tiene un precio negativo.` }
      lineas.push({ kind: 'CATALOG_ITEM', supplyCatalogItemId: item.id, description: item.name, quantity: l.quantity, unitPrice, lineTotal: redondear2(unitPrice.times(l.quantity)), priceSource: 'CATALOG' })
      continue
    }
    const description = (l.description ?? '').trim()
    if (!description) return { error: 'Una compra personalizada necesita descripción.' }
    if (description.length > 160) return { error: 'La descripción es demasiado larga.' }
    let unitPrice: Decimal
    try {
      unitPrice = redondear2(decimal(l.unitPrice ?? 'x'))
    } catch {
      return { error: `Escribe el precio de «${description}».` }
    }
    if (!unitPrice.isFinite() || unitPrice.isNegative()) return { error: `El precio de «${description}» no es válido.` }
    hasCustomLines = true
    lineas.push({ kind: 'CUSTOM_REPORTED_LINE', supplyCatalogItemId: null, description, quantity: l.quantity, unitPrice, lineTotal: redondear2(unitPrice.times(l.quantity)), priceSource: 'OPERATOR' })
  }
  const subtotal = lineas.reduce<Decimal>((t, l) => t.plus(l.lineTotal), decimal(0))
  if (subtotal.greaterThan(TOPE_VENTA_ADICIONAL)) return { error: 'El total de la venta adicional es demasiado alto.' }
  if (subtotal.isZero() && !hasCustomLines) return { error: 'La venta adicional no puede ser de RD$0.' }
  return { lineas, subtotal: redondear2(subtotal), hasCustomLines }
}

// ── Comisión (§27–§28, §35, §72) ────────────────────────────────────────────

export interface ComisionDeExtra {
  base: Decimal
  rate: Decimal
  amount: Decimal
  /** NOT_APPLICABLE si la política no comisiona o la comisión es cero. */
  status: Extract<AncillaryCommissionStatus, 'PENDING' | 'NOT_APPLICABLE'>
}

/**
 * La base es el subtotal de los EXTRAS y nada más. 8 % de RD$400 = RD$32;
 * nunca 8 % de la pizza que Membego ya compró (eso sería doble monetización).
 */
export function calcularComisionDeExtra(subtotal: Monto, politica: Pick<PoliticaDeExtras, 'ancillaryCommissionEnabled' | 'ancillaryCommissionRate'>): ComisionDeExtra {
  const base = redondear2(decimal(subtotal))
  if (!base.isFinite() || base.isNegative()) throw new Error('La base comisionable no puede ser negativa.')
  const rate = decimal(politica.ancillaryCommissionRate)
  if (!politica.ancillaryCommissionEnabled || base.isZero() || rate.isZero()) return { base, rate, amount: decimal(0), status: 'NOT_APPLICABLE' }
  const amount = repartirComision(base, rate).commissionAmount
  return { base, rate, amount, status: amount.greaterThan(0) ? 'PENDING' : 'NOT_APPLICABLE' }
}

/** ¿Se asienta ya la comisión al reportar la venta, o espera la confirmación del cliente? */
export function seAsientaAlReportar(politica: Pick<PoliticaDeExtras, 'requiresCustomerConfirmation'>): boolean {
  return !politica.requiresCustomerConfirmation
}

export const PREFIJO_CLAVE_EXTRA = 'ancillary:'
export const claveDeCargo = (saleId: string) => `${PREFIJO_CLAVE_EXTRA}${saleId}`
export const claveDeReverso = (saleId: string) => `${PREFIJO_CLAVE_EXTRA}${saleId}:reversal`
export const claveDeAjuste = (saleId: string, disputeId: string) => `${PREFIJO_CLAVE_EXTRA}${saleId}:dispute:${disputeId}`

/**
 * Cómo se corrige la comisión de una venta tras resolver una disputa a favor
 * del cliente (§34–§36): la base reconocida es lo que el cliente dijo que
 * pagó (acotada a [0, reportado]). Si queda 0 → REVERSO total; si queda
 * menos → AJUSTE negativo por la diferencia de comisión; si queda igual →
 * nada. Nunca se toca la comisión original.
 */
export function correccionPorDisputa(
  venta: { commissionBase: Monto; commissionRate: Monto; commissionAmount: Monto; commissionStatus: AncillaryCommissionStatus },
  baseReconocida: Monto
): { tipo: 'NADA' | 'REVERSO' | 'AJUSTE'; baseReconocida: Decimal; comisionReconocida: Decimal; delta: Decimal } {
  const reportada = redondear2(decimal(venta.commissionBase))
  let reconocida = redondear2(decimal(baseReconocida))
  if (reconocida.isNegative()) reconocida = decimal(0)
  if (reconocida.greaterThan(reportada)) reconocida = reportada
  const rate = decimal(venta.commissionRate)
  const comisionReconocida = reconocida.isZero() || rate.isZero() ? decimal(0) : repartirComision(reconocida, rate).commissionAmount
  const original = redondear2(decimal(venta.commissionAmount))
  const delta = redondear2(comisionReconocida.minus(original))
  if (venta.commissionStatus !== 'POSTED') return { tipo: 'NADA', baseReconocida: reconocida, comisionReconocida, delta: decimal(0) }
  if (reconocida.isZero()) return { tipo: 'REVERSO', baseReconocida: reconocida, comisionReconocida, delta: original.negated() }
  if (delta.isZero()) return { tipo: 'NADA', baseReconocida: reconocida, comisionReconocida, delta }
  return { tipo: 'AJUSTE', baseReconocida: reconocida, comisionReconocida, delta }
}

// ── Evidencia (§32–§33) ─────────────────────────────────────────────────────

export const NIVELES_DE_EVIDENCIA: readonly AncillaryEvidenceLevel[] = ['MERCHANT_REPORTED', 'CUSTOMER_CONFIRMED', 'PAYMENT_VERIFIED', 'FISCALLY_RECONCILED']

export function subeEvidencia(actual: AncillaryEvidenceLevel, nueva: AncillaryEvidenceLevel): boolean {
  return NIVELES_DE_EVIDENCIA.indexOf(nueva) > NIVELES_DE_EVIDENCIA.indexOf(actual)
}

export const EVIDENCE_LABELS: Record<AncillaryEvidenceLevel, string> = {
  MERCHANT_REPORTED: 'Reportado por el negocio',
  CUSTOMER_CONFIRMED: 'Confirmado por el cliente',
  PAYMENT_VERIFIED: 'Pago verificado',
  FISCALLY_RECONCILED: 'Conciliado fiscalmente',
}

// ── Transiciones ────────────────────────────────────────────────────────────

export const TRANSICIONES_VISITA: Transiciones<MembegoVisitStatus> = {
  OPEN: ['CLOSED', 'CANCELLED'],
  CLOSED: [],
  CANCELLED: [],
}

export const TRANSICIONES_VENTA: Transiciones<AncillarySaleStatus> = {
  REPORTED: ['CONFIRMED', 'DISPUTED', 'REVERSED'],
  CONFIRMED: ['DISPUTED', 'REVERSED'],
  DISPUTED: ['REPORTED', 'CONFIRMED', 'ADJUSTED', 'REVERSED'],
  ADJUSTED: ['REVERSED'],
  REVERSED: [],
}

export const TRANSICIONES_DISPUTA: Transiciones<VisitDisputeStatus> = {
  OPEN: ['UNDER_REVIEW', 'RESOLVED_MERCHANT', 'RESOLVED_CUSTOMER', 'DISMISSED'],
  UNDER_REVIEW: ['RESOLVED_MERCHANT', 'RESOLVED_CUSTOMER', 'DISMISSED'],
  RESOLVED_MERCHANT: [],
  RESOLVED_CUSTOMER: [],
  DISMISSED: [],
}

export const VISIT_STATUS_LABELS: Record<MembegoVisitStatus, string> = { OPEN: 'Abierta', CLOSED: 'Cerrada', CANCELLED: 'Cancelada' }
export const SALE_STATUS_LABELS: Record<AncillarySaleStatus, string> = { REPORTED: 'Reportada', CONFIRMED: 'Confirmada', DISPUTED: 'En disputa', ADJUSTED: 'Ajustada', REVERSED: 'Reversada' }
export const DISPUTE_STATUS_LABELS: Record<VisitDisputeStatus, string> = { OPEN: 'Abierta', UNDER_REVIEW: 'En revisión', RESOLVED_MERCHANT: 'A favor del negocio', RESOLVED_CUSTOMER: 'A favor del cliente', DISMISSED: 'Desestimada' }

/** Un estado de venta que todavía puede recibir la confirmación del cliente. */
export const VENTAS_CONFIRMABLES: readonly AncillarySaleStatus[] = ['REPORTED']
/** Estados de venta que cuentan en el total reportado de la visita. */
export const VENTAS_VIVAS: readonly AncillarySaleStatus[] = ['REPORTED', 'CONFIRMED', 'DISPUTED', 'ADJUSTED']

export function sumarVentas(ventas: readonly { status: AncillarySaleStatus; subtotal: Monto; commissionAmount: Monto; commissionStatus: AncillaryCommissionStatus }[]): { ancillaryTotal: Decimal; commissionTotal: Decimal } {
  let ancillaryTotal = decimal(0)
  let commissionTotal = decimal(0)
  for (const v of ventas) {
    if (!VENTAS_VIVAS.includes(v.status)) continue
    ancillaryTotal = ancillaryTotal.plus(decimal(v.subtotal))
    if (v.commissionStatus === 'POSTED') commissionTotal = commissionTotal.plus(decimal(v.commissionAmount))
  }
  return { ancillaryTotal: redondear2(ancillaryTotal), commissionTotal: redondear2(commissionTotal) }
}

/** ¿El total que vio el cliente es el que hay? (Confirmar algo distinto no es confirmar.) */
export function totalCoincide(reportado: Monto, visto: Monto): boolean {
  try {
    return redondear2(decimal(reportado)).equals(redondear2(decimal(visto)))
  } catch {
    return false
  }
}
