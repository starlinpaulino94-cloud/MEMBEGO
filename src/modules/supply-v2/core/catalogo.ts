import type {
  SupplyV2EntitlementStatus,
  SupplyV2IncidentType,
  SupplyV2VoucherStatus,
  SupplyV2CustomerOrderStatus,
  SupplyV2OfferStatus,
  SupplyV2PaymentMethod,
  SupplyV2PaymentStatus,
  SupplyV2AgreementStatus,
  SupplyV2AgreementType,
  SupplyV2CatalogItemType,
  SupplyV2LotStatus,
  SupplyV2PaymentMode,
  SupplyV2PurchaseOrderStatus,
  SupplyV2SupplierSource,
  SupplyV2SupplierStatus,
  SupplyV2Unit,
} from '@prisma/client'

/**
 * MEMBEGO SUPPLY 2.0 · etiquetas y catálogos de la interfaz.
 *
 * Los enums de la base hablan inglés (son el contrato técnico); la pantalla
 * habla español. Aquí vive la traducción, en un solo sitio.
 */

export const SUPPLIER_SOURCE_LABELS: Record<SupplyV2SupplierSource, string> = {
  REGISTERED_COMPANY: 'Empresa en Membego',
  EXTERNAL: 'Proveedor externo',
}

export const SUPPLIER_STATUS_LABELS: Record<SupplyV2SupplierStatus, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
  BLOCKED: 'Bloqueado',
}

export const CATALOG_ITEM_TYPE_LABELS: Record<SupplyV2CatalogItemType, string> = {
  PRODUCT: 'Producto',
  SERVICE: 'Servicio',
  EXPERIENCE: 'Experiencia',
  CAPACITY: 'Capacidad',
}

export const UNIT_LABELS: Record<SupplyV2Unit, string> = {
  UNIT: 'Unidad',
  SERVICE: 'Servicio',
  PERSON: 'Persona',
  HOUR: 'Hora',
  DAY: 'Día',
  TICKET: 'Boleto',
  CUSTOM: 'Otra',
}

export const AGREEMENT_TYPE_LABELS: Record<SupplyV2AgreementType, string> = {
  PREPAID_PURCHASE: 'Compra anticipada',
  OPEN_DEPOSIT: 'Depósito abierto',
  PAY_LATER: 'Pagar después',
  COMMISSION: 'Comisión',
  HYBRID: 'Híbrido',
}

export const AGREEMENT_TYPE_EXPLICACION: Record<SupplyV2AgreementType, string> = {
  PREPAID_PURCHASE: 'Membego compra unidades por adelantado a un costo negociado.',
  OPEN_DEPOSIT: 'Membego deposita un monto a cuenta de compras futuras.',
  PAY_LATER: 'Membego compra ahora y paga en el plazo acordado.',
  COMMISSION: 'Membego vende lo del proveedor y retiene una comisión.',
  HYBRID: 'Combinación de las anteriores.',
}

/** Los únicos tipos que el Slice 1 construye de verdad (§10). */
export const AGREEMENT_TYPES_SLICE1: readonly SupplyV2AgreementType[] = ['PREPAID_PURCHASE', 'PAY_LATER']
/** Slice 5 añade la venta a comisión (§7): el proveedor sigue siendo dueño del inventario. */
export const AGREEMENT_TYPES_SLICE5: readonly SupplyV2AgreementType[] = ['PREPAID_PURCHASE', 'PAY_LATER', 'COMMISSION']

export const AGREEMENT_STATUS_LABELS: Record<SupplyV2AgreementStatus, string> = {
  DRAFT: 'Borrador',
  PENDING_APPROVAL: 'Pendiente de aprobación',
  ACTIVE: 'Vigente',
  SUSPENDED: 'Suspendido',
  EXPIRED: 'Vencido',
  TERMINATED: 'Terminado',
}

export const PO_STATUS_LABELS: Record<SupplyV2PurchaseOrderStatus, string> = {
  DRAFT: 'Borrador',
  PENDING_APPROVAL: 'Pendiente de aprobación',
  APPROVED: 'Aprobada',
  PARTIALLY_PAID: 'Parcialmente pagada',
  PAID: 'Pagada',
  PARTIALLY_RECEIVED: 'Parcialmente recibida',
  RECEIVED: 'Recibida',
  CANCELLED: 'Cancelada',
  CLOSED: 'Cerrada',
}

export const PO_STATUS_TONE: Record<
  SupplyV2PurchaseOrderStatus,
  'neutral' | 'warning' | 'info' | 'success' | 'danger'
> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  PARTIALLY_PAID: 'info',
  PAID: 'info',
  PARTIALLY_RECEIVED: 'info',
  RECEIVED: 'success',
  CANCELLED: 'danger',
  CLOSED: 'neutral',
}

export const PAYMENT_MODE_LABELS: Record<SupplyV2PaymentMode, string> = {
  PREPAID: 'Pago anticipado',
  PARTIAL: 'Pago parcial',
  PAY_LATER: 'Pagar después',
}

/** Formas de pago que el Slice 1 ofrece (§32, paso 5). */
export const PAYMENT_MODES_SLICE1: readonly SupplyV2PaymentMode[] = ['PREPAID', 'PAY_LATER']

export const LOT_STATUS_LABELS: Record<SupplyV2LotStatus, string> = {
  ACTIVE: 'Activo',
  EXHAUSTED: 'Agotado',
  EXPIRED: 'Vencido',
  CANCELLED: 'Cancelado',
  CLOSED: 'Cerrado',
}

export const MONEDAS_SUPPLY_V2 = ['DOP', 'USD', 'EUR'] as const

export const BASE_SUPPLY_V2 = '/superadmin/supply-v2'

// ── Slice 2 ─────────────────────────────────────────────────────────────────

export const OFFER_STATUS_LABELS: Record<SupplyV2OfferStatus, string> = {
  DRAFT: 'Borrador',
  SCHEDULED: 'Programada',
  ACTIVE: 'Activa',
  PAUSED: 'Pausada',
  SOLD_OUT: 'Agotada',
  ENDED: 'Finalizada',
  CANCELLED: 'Cancelada',
}

export const OFFER_STATUS_TONE: Record<SupplyV2OfferStatus, 'neutral' | 'warning' | 'info' | 'success' | 'danger'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  ACTIVE: 'success',
  PAUSED: 'warning',
  SOLD_OUT: 'info',
  ENDED: 'neutral',
  CANCELLED: 'danger',
}

export const CUSTOMER_ORDER_STATUS_LABELS: Record<SupplyV2CustomerOrderStatus, string> = {
  PENDING: 'Pendiente de pago',
  AWAITING_PAYMENT: 'Pago en revisión',
  PAID: 'Pagada',
  CANCELLED: 'Cancelada',
  EXPIRED: 'Expirada',
  REFUNDED: 'Reembolsada',
}

export const CUSTOMER_ORDER_STATUS_TONE: Record<SupplyV2CustomerOrderStatus, 'neutral' | 'warning' | 'info' | 'success' | 'danger'> = {
  PENDING: 'warning',
  AWAITING_PAYMENT: 'info',
  PAID: 'success',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
  REFUNDED: 'danger',
}

export const PAYMENT_STATUS_LABELS: Record<SupplyV2PaymentStatus, string> = {
  COVERED_BY_BENEFIT: 'Cubierto por un beneficio (sin pago bancario)',
  UNPAID: 'Sin pagar',
  SUBMITTED: 'Pago avisado',
  CONFIRMED: 'Confirmado',
  REJECTED: 'Rechazado',
}

export const PAYMENT_METHOD_LABELS: Record<SupplyV2PaymentMethod, string> = {
  TRANSFER: 'Transferencia',
  DEPOSIT: 'Depósito',
  CASH: 'Efectivo',
  MANUAL: 'Manual',
}

/** Formas de pago que el cliente puede declarar en el Slice 2. */
export const PAYMENT_METHODS_CLIENTE: readonly SupplyV2PaymentMethod[] = ['TRANSFER', 'DEPOSIT']

export const RUTA_OFERTAS_PUBLICAS = '/promociones/membego'
export const RUTA_COMPRAS_CLIENTE = '/cliente/compras'

// ── Slice 3 ─────────────────────────────────────────────────────────────────

export const ENTITLEMENT_STATUS_LABELS: Record<SupplyV2EntitlementStatus, string> = {
  ACTIVE: 'Disponible',
  REDEEMED: 'Utilizado',
  EXPIRED: 'Vencido',
  CANCELLED: 'Cancelado',
}

export const ENTITLEMENT_STATUS_TONE: Record<SupplyV2EntitlementStatus, 'neutral' | 'warning' | 'info' | 'success' | 'danger'> = {
  ACTIVE: 'success',
  REDEEMED: 'info',
  EXPIRED: 'neutral',
  CANCELLED: 'danger',
}

export const VOUCHER_STATUS_LABELS: Record<SupplyV2VoucherStatus, string> = {
  ACTIVE: 'Activo',
  REDEEMED: 'Utilizado',
  EXPIRED: 'Vencido',
  CANCELLED: 'Cancelado',
  REVOKED: 'Revocado',
}

export const INCIDENT_TYPE_LABELS: Record<SupplyV2IncidentType, string> = {
  INVALID_QR: 'QR inválido',
  PRODUCT_UNAVAILABLE: 'Producto no disponible',
  WRONG_CUSTOMER: 'Cliente incorrecto',
  WRONG_BRANCH: 'Sucursal incorrecta',
  OTHER: 'Otro',
}

export const RUTA_PORTAL_PROVEEDOR = '/admin/supply-v2'
export const RUTA_REDENCIONES = `${BASE_SUPPLY_V2}/redenciones`

// ── Slice 4 · finanzas y economía ───────────────────────────────────────────

import type {
  SupplyV2ApplicationType,
  SupplyV2DepositMovementType,
  SupplyV2DepositStatus,
  SupplyV2EconomicEventType,
  SupplyV2InvoiceStatus,
  SupplyV2ObligationStatus,
  SupplyV2PayableRecognition,
  SupplyV2RecognitionBasis,
  SupplyV2ReconciliationStatus,
  SupplyV2SupplierPaymentMethod,
  SupplyV2SupplierPaymentStatus,
} from '@prisma/client'

type Tono = 'neutral' | 'warning' | 'info' | 'success' | 'danger'

export const RUTA_FINANZAS = `${BASE_SUPPLY_V2}/finanzas`
export const RUTA_ECONOMIA = `${BASE_SUPPLY_V2}/economia`

export const PAYABLE_RECOGNITION_LABELS: Record<SupplyV2PayableRecognition, string> = {
  ON_INVOICE: 'Al aprobar la factura',
  ON_RECEIPT: 'Al recibir la mercancía',
  ON_REDEMPTION: 'Al entregar al cliente',
}

export const PAYABLE_RECOGNITION_EXPLICACION: Record<SupplyV2PayableRecognition, string> = {
  ON_INVOICE: 'La deuda con el proveedor nace cuando Membego aprueba su factura. Lo normal en compra anticipada.',
  ON_RECEIPT: 'La deuda nace con cada recepción; la factura posterior se enlaza sin duplicarla.',
  ON_REDEMPTION: 'La deuda nace con cada entrega al cliente (pagar después, por unidad consumida).',
}

export const INVOICE_STATUS_LABELS: Record<SupplyV2InvoiceStatus, string> = {
  DRAFT: 'Borrador',
  PENDING_APPROVAL: 'Pendiente de aprobación',
  APPROVED: 'Aprobada',
  PARTIALLY_PAID: 'Parcialmente pagada',
  PAID: 'Pagada',
  CANCELLED: 'Cancelada',
  CREDITED: 'Con nota de crédito',
}

export const INVOICE_STATUS_TONE: Record<SupplyV2InvoiceStatus, Tono> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  PARTIALLY_PAID: 'info',
  PAID: 'success',
  CANCELLED: 'danger',
  CREDITED: 'neutral',
}

export const DEPOSIT_STATUS_LABELS: Record<SupplyV2DepositStatus, string> = {
  ACTIVE: 'Activo',
  EXHAUSTED: 'Agotado',
  CANCELLED: 'Cancelado',
  REFUNDED: 'Reembolsado',
}

export const DEPOSIT_STATUS_TONE: Record<SupplyV2DepositStatus, Tono> = {
  ACTIVE: 'success',
  EXHAUSTED: 'neutral',
  CANCELLED: 'danger',
  REFUNDED: 'info',
}

export const DEPOSIT_MOVEMENT_LABELS: Record<SupplyV2DepositMovementType, string> = {
  DEPOSIT_CREATED: 'Depósito creado',
  DEPOSIT_APPLIED: 'Aplicado',
  DEPOSIT_RELEASED: 'Liberado (reversa)',
  DEPOSIT_REFUNDED: 'Reembolsado',
  ADJUSTMENT: 'Ajuste',
}

export const SUPPLIER_PAYMENT_METHOD_LABELS: Record<SupplyV2SupplierPaymentMethod, string> = {
  BANK_TRANSFER: 'Transferencia',
  CASH: 'Efectivo',
  DEPOSIT: 'Depósito (asiento)',
  OTHER: 'Otro',
}

export const SUPPLIER_PAYMENT_STATUS_LABELS: Record<SupplyV2SupplierPaymentStatus, string> = {
  PENDING: 'Pendiente de confirmar',
  CONFIRMED: 'Confirmado',
  CANCELLED: 'Cancelado',
}

export const SUPPLIER_PAYMENT_STATUS_TONE: Record<SupplyV2SupplierPaymentStatus, Tono> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  CANCELLED: 'danger',
}

export const APPLICATION_TYPE_LABELS: Record<SupplyV2ApplicationType, string> = {
  PAYMENT_TO_INVOICE: 'Pago a factura',
  DEPOSIT_TO_INVOICE: 'Depósito a factura',
  PAYMENT_TO_OBLIGATION: 'Pago a obligación',
  DEPOSIT_TO_OBLIGATION: 'Depósito a obligación',
  PAYMENT_TO_DEPOSIT: 'Pago que financia un depósito',
  REVERSAL: 'Reversa',
}

export const OBLIGATION_STATUS_LABELS: Record<SupplyV2ObligationStatus, string> = {
  OPEN: 'Pendiente',
  PARTIALLY_PAID: 'Parcialmente pagada',
  PAID: 'Pagada',
  CANCELLED: 'Cancelada',
}

export const OBLIGATION_STATUS_TONE: Record<SupplyV2ObligationStatus, Tono> = {
  OPEN: 'warning',
  PARTIALLY_PAID: 'info',
  PAID: 'success',
  CANCELLED: 'danger',
}

export const RECOGNITION_BASIS_LABELS: Record<SupplyV2RecognitionBasis, string> = {
  PO_APPROVAL: 'Aprobación de la compra',
  RECEIPT: 'Recepción',
  REDEMPTION: 'Entrega al cliente',
  INVOICE: 'Factura',
  MANUAL: 'Manual',
}

export const RECONCILIATION_STATUS_LABELS: Record<SupplyV2ReconciliationStatus, string> = {
  OPEN: 'Abierta',
  MATCHED: 'Cuadra',
  DISCREPANCY: 'Con diferencia',
  RESOLVED: 'Resuelta',
}

export const RECONCILIATION_STATUS_TONE: Record<SupplyV2ReconciliationStatus, Tono> = {
  OPEN: 'neutral',
  MATCHED: 'success',
  DISCREPANCY: 'warning',
  RESOLVED: 'info',
}

export const ECONOMIC_EVENT_LABELS: Record<SupplyV2EconomicEventType, string> = {
  SALE_REVENUE: 'Venta (ingreso y costo)',
  REDEMPTION_COST: 'Costo al entregar',
  EXPIRATION_COST: 'Supply vencido sin vender',
  BREAKAGE: 'Derecho vencido sin usar',
  REVERSAL: 'Reversa',
  ADJUSTMENT: 'Ajuste',
  COMMISSION_REVENUE: 'Venta a comisión (ingreso = comisión)',
  MEMBEGO_SUBSIDY: 'Subsidio de Membego (costo promocional)',
}

// ── Slice 5 · comisión + liquidaciones ──────────────────────────────────────

import type {
  SupplyV2AvailabilityMode,
  SupplyV2CommissionReservationStatus,
  SupplyV2FinanceIncidentSeverity,
  SupplyV2FinanceIncidentStatus,
  SupplyV2FinanceIncidentType,
  SupplyV2PaymentIncidentResolution,
  SupplyV2OfferSource,
  SupplyV2ReconciliationKind,
  SupplyV2ResolutionType,
  SupplyV2SettlementFrequency,
  SupplyV2SettlementStatus,
} from '@prisma/client'

export const RUTA_LIQUIDACIONES = `${RUTA_FINANZAS}/liquidaciones`
export const RUTA_INCIDENCIAS_FINANCIERAS = `${RUTA_FINANZAS}/incidencias`
export const RUTA_PORTAL_VENTAS = `${RUTA_PORTAL_PROVEEDOR}/ventas`
export const RUTA_PORTAL_LIQUIDACIONES = `${RUTA_PORTAL_PROVEEDOR}/liquidaciones`
/** Slice 6 (§32): beneficios que afectan a las ofertas del proveedor. */
export const RUTA_PORTAL_BENEFICIOS = `${RUTA_PORTAL_PROVEEDOR}/beneficios`

export const OFFER_SOURCE_LABELS: Record<SupplyV2OfferSource, string> = {
  PREPURCHASED_SUPPLY: 'Supply adquirido',
  COMMISSION: 'Comisión',
}

export const OFFER_SOURCE_EXPLICACION: Record<SupplyV2OfferSource, string> = {
  PREPURCHASED_SUPPLY: 'Membego ya compró las unidades: la oferta aparta supply de un lote.',
  COMMISSION: 'El proveedor sigue siendo dueño del inventario: Membego vende, cobra, retiene su comisión y liquida el neto al entregar.',
}

export const AVAILABILITY_MODE_LABELS: Record<SupplyV2AvailabilityMode, string> = {
  UNLIMITED: 'Sin tope',
  FIXED_QUANTITY: 'Cantidad fija',
  CAPACITY: 'Capacidad',
}

export const AVAILABILITY_MODE_EXPLICACION: Record<SupplyV2AvailabilityMode, string> = {
  UNLIMITED: 'El proveedor entrega lo que se venda; no se reserva nada.',
  FIXED_QUANTITY: 'Un tope de unidades (p. ej. 100 excursiones); cada compra reserva las suyas.',
  CAPACITY: 'Capacidad declarada por el proveedor (cupos, mesas, plazas); misma reserva que la cantidad fija.',
}

export const COMMISSION_RESERVATION_STATUS_LABELS: Record<SupplyV2CommissionReservationStatus, string> = {
  ACTIVE: 'Reservada',
  RELEASED: 'Liberada',
  CONSUMED: 'Consumida',
  EXPIRED: 'Expirada',
}

export const SETTLEMENT_STATUS_LABELS: Record<SupplyV2SettlementStatus, string> = {
  DRAFT: 'Borrador',
  PENDING_APPROVAL: 'Pendiente de aprobación',
  APPROVED: 'Aprobada',
  PARTIALLY_PAID: 'Parcialmente pagada',
  PAID: 'Pagada',
  CANCELLED: 'Cancelada',
}

export const SETTLEMENT_STATUS_TONE: Record<SupplyV2SettlementStatus, Tono> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  PARTIALLY_PAID: 'info',
  PAID: 'success',
  CANCELLED: 'danger',
}

export const SETTLEMENT_FREQUENCY_LABELS: Record<SupplyV2SettlementFrequency, string> = {
  DAILY: 'Diaria',
  WEEKLY: 'Semanal',
  BIWEEKLY: 'Quincenal',
  MONTHLY: 'Mensual',
  MANUAL: 'Manual',
}

export const RECONCILIATION_KIND_LABELS: Record<SupplyV2ReconciliationKind, string> = {
  SUPPLY: 'Supply adquirido',
  COMMISSION: 'Ventas a comisión',
}

export const RESOLUTION_TYPE_LABELS: Record<SupplyV2ResolutionType, string> = {
  ACCEPT_INTERNAL: 'Se acepta la cifra de Membego',
  ACCEPT_SUPPLIER: 'Se acepta la cifra del proveedor',
  ADJUSTED: 'Se ajustó con un documento aparte',
  OTHER: 'Otra resolución (explicada en las notas)',
}

export const FINANCE_INCIDENT_TYPE_LABELS: Record<SupplyV2FinanceIncidentType, string> = {
  REDEMPTION_REVERSED_AFTER_PAYMENT: 'Entrega reversada con el neto ya pagado',
  EXTERNAL_PAYMENT_MISMATCH: 'Pago externo que no coincide con Membego',
}

/// Por qué no coincide. Texto y no enum en la base (un motivo nuevo no debe
/// pedir una migración), así que la etiqueta se resuelve con respaldo.
export const PAYMENT_INCIDENT_REASON_LABELS: Record<string, string> = {
  AMOUNT_MISMATCH: 'El importe cobrado no es el de la compra',
  CURRENCY_MISMATCH: 'Se cobró en otra moneda',
  UNKNOWN_ORDER: 'La compra que dice el cobro no existe',
  STATE_CONFLICT: 'Los dos lados dicen cosas incompatibles',
  DUPLICATE_TRANSACTION: 'La misma transacción apareció en otra compra',
}

export function etiquetaDeMotivoDePago(motivo: string | null | undefined): string {
  if (!motivo) return 'Sin motivo registrado'
  return PAYMENT_INCIDENT_REASON_LABELS[motivo] ?? motivo
}

export const FINANCE_INCIDENT_SEVERITY_LABELS: Record<SupplyV2FinanceIncidentSeverity, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
}

export const PAYMENT_INCIDENT_RESOLUTION_LABELS: Record<SupplyV2PaymentIncidentResolution, string> = {
  ACCEPT_INTERNAL: 'Lo nuestro es correcto',
  ACCEPT_EXTERNAL: 'La evidencia externa es correcta',
  MARK_FALSE_POSITIVE: 'Falso positivo',
  MANUAL_CORRECTION_REQUIRED: 'Necesita una corrección manual',
}

export const FINANCE_INCIDENT_STATUS_LABELS: Record<SupplyV2FinanceIncidentStatus, string> = {
  OPEN: 'Abierta',
  INVESTIGATING: 'En investigación',
  RESOLVED: 'Resuelta',
}

// ── Slice 6 · beneficios económicos ─────────────────────────────────────────

import type { SupplyV2BenefitFunding, SupplyV2BenefitMovementType, SupplyV2BenefitReservationStatus, SupplyV2BenefitScope, SupplyV2BenefitStatus, SupplyV2BenefitValueType, SupplyV2CommissionBase, SupplyV2CustomerBenefitStatus } from '@prisma/client'

export const RUTA_BENEFICIOS = `${BASE_SUPPLY_V2}/beneficios`
export const RUTA_BENEFICIOS_CLIENTE = '/cliente/bonos'

export const BENEFIT_FUNDING_LABELS: Record<SupplyV2BenefitFunding, string> = {
  MEMBEGO: 'Bono financiado por Membego',
  SUPPLIER: 'Descuento financiado por el proveedor',
  SHARED: 'Financiación compartida',
}
export const BENEFIT_FUNDING_EXPLICACION: Record<SupplyV2BenefitFunding, string> = {
  MEMBEGO: 'Membego asume el valor: sale de un presupuesto y es costo promocional. El proveedor cobra su importe contractual completo.',
  SUPPLIER: 'El proveedor rebaja su precio: no es dinero de Membego. Solo en ofertas vendidas a comisión.',
  SHARED: 'Parte la rebaja el proveedor y parte la financia Membego. Solo en ofertas vendidas a comisión.',
}
export const BENEFIT_VALUE_TYPE_LABELS: Record<SupplyV2BenefitValueType, string> = {
  FIXED_AMOUNT: 'Importe fijo',
  PERCENTAGE: 'Porcentaje',
}
export const BENEFIT_SCOPE_LABELS: Record<SupplyV2BenefitScope, string> = {
  SPECIFIC_OFFER: 'Una oferta concreta',
  CATALOG_ITEM: 'Un producto (todas sus ofertas)',
  SUPPLIER: 'Todas las ofertas de un proveedor',
}
export const BENEFIT_STATUS_LABELS: Record<SupplyV2BenefitStatus, string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Activo',
  PAUSED: 'Pausado',
  EXHAUSTED: 'Agotado',
  EXPIRED: 'Vencido',
  CANCELLED: 'Cancelado',
}
export const BENEFIT_STATUS_TONE: Record<SupplyV2BenefitStatus, Tono> = {
  DRAFT: 'neutral',
  ACTIVE: 'success',
  PAUSED: 'warning',
  EXHAUSTED: 'warning',
  EXPIRED: 'neutral',
  CANCELLED: 'danger',
}
export const CUSTOMER_BENEFIT_STATUS_LABELS: Record<SupplyV2CustomerBenefitStatus, string> = {
  AVAILABLE: 'Disponible',
  EXHAUSTED: 'Usado',
  EXPIRED: 'Vencido',
  CANCELLED: 'Cancelado',
}
export const BENEFIT_RESERVATION_STATUS_LABELS: Record<SupplyV2BenefitReservationStatus, string> = {
  ACTIVE: 'Reservado',
  APPLIED: 'Aplicado',
  RELEASED: 'Liberado',
  EXPIRED: 'Expirado',
  REVERSED: 'Reversado',
}
export const BENEFIT_MOVEMENT_LABELS: Record<SupplyV2BenefitMovementType, string> = {
  GRANTED: 'Asignado a un cliente',
  RESERVED: 'Reservado por un checkout',
  APPLIED: 'Aplicado (compra confirmada)',
  RELEASED: 'Liberado (compra cancelada o rechazada)',
  EXPIRED: 'Expirado',
  REVERSED: 'Reversado',
}

export const COMMISSION_BASE_LABELS: Record<SupplyV2CommissionBase, string> = {
  CONTRACTUAL_SALE_VALUE: 'Sobre el valor contractual (precio tras el descuento real del proveedor)',
  CUSTOMER_PAID_AMOUNT: 'Sobre lo que pagó el cliente (tras el subsidio de Membego)',
}

/** Formato de dinero para las pantallas de finanzas: dos decimales siempre (§52: el texto ya viene redondeado). */
export function dineroSupplyV2(n: string | number | { toString(): string }, moneda = 'DOP'): string {
  const v = Number(typeof n === 'object' ? n.toString() : n)
  // El signo va DELANTE del símbolo: «-RD$228.00», no «RD$-228.00». Las
  // contribuciones de campaña y los saldos pueden ser negativos y se leen a
  // simple vista.
  const signo = v < 0 ? '-' : ''
  return `${signo}${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Math.abs(v).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Slice 7 · campañas, promociones y cupones ───────────────────────────────

import type {
  SupplyV2CampaignAudience,
  SupplyV2CampaignEventType,
  SupplyV2CampaignOrganizer,
  SupplyV2CampaignStatus,
  SupplyV2CouponKind,
  SupplyV2CouponRedemptionStatus,
  SupplyV2CouponStatus,
} from '@prisma/client'

export const RUTA_CAMPANAS = `${BASE_SUPPLY_V2}/campanas`
export const RUTA_CAMPANAS_PUBLICAS = '/promociones/campanas'
export const RUTA_CUPONES_CLIENTE = '/cliente/cupones'
export const RUTA_PORTAL_CAMPANAS = `${RUTA_PORTAL_PROVEEDOR}/campanas`

export const CAMPAIGN_STATUS_LABELS: Record<SupplyV2CampaignStatus, string> = {
  DRAFT: 'Borrador',
  PENDING_APPROVAL: 'En revisión',
  SCHEDULED: 'Programada',
  ACTIVE: 'Activa',
  PAUSED: 'Pausada',
  COMPLETED: 'Terminada',
  CANCELLED: 'Cancelada',
}
export const CAMPAIGN_STATUS_TONE: Record<SupplyV2CampaignStatus, Tono> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  SCHEDULED: 'info',
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
}
export const CAMPAIGN_ORGANIZER_LABELS: Record<SupplyV2CampaignOrganizer, string> = {
  MEMBEGO: 'La organiza Membego',
  SUPPLIER: 'La propone el proveedor',
}
export const CAMPAIGN_AUDIENCE_LABELS: Record<SupplyV2CampaignAudience, string> = {
  ALL: 'Todos los clientes elegibles',
  NEW_CUSTOMERS: 'Clientes nuevos (sin compras todavía)',
  RETURNING_CUSTOMERS: 'Clientes con compras anteriores',
  PAST_CAMPAIGN: 'Clientes que ya usaron una promoción',
  SELECTED: 'Lista de clientes seleccionados',
}
export const CAMPAIGN_AUDIENCE_EXPLICACION: Record<SupplyV2CampaignAudience, string> = {
  ALL: 'Cualquiera que cumpla las condiciones de la oferta.',
  NEW_CUSTOMERS: 'Quien todavía no ha comprado nada en Membego Supply.',
  RETURNING_CUSTOMERS: 'Quien ya compró al menos una vez y pagó.',
  PAST_CAMPAIGN: 'Quien ya aplicó la promoción de alguna campaña.',
  SELECTED: 'Solo los clientes a quienes se les asigne la campaña a mano.',
}
export const COUPON_KIND_LABELS: Record<SupplyV2CouponKind, string> = {
  PUBLIC: 'Público (cualquier cliente elegible)',
  PRIVATE: 'Privado (de un cliente concreto)',
}
export const COUPON_STATUS_LABELS: Record<SupplyV2CouponStatus, string> = {
  ACTIVE: 'Disponible',
  EXHAUSTED: 'Agotado',
  EXPIRED: 'Vencido',
  CANCELLED: 'Cancelado',
}
export const COUPON_STATUS_TONE: Record<SupplyV2CouponStatus, Tono> = {
  ACTIVE: 'success',
  EXHAUSTED: 'info',
  EXPIRED: 'neutral',
  CANCELLED: 'danger',
}
export const COUPON_REDEMPTION_STATUS_LABELS: Record<SupplyV2CouponRedemptionStatus, string> = {
  RESERVED: 'En un checkout en curso',
  APPLIED: 'Aplicado',
  RELEASED: 'Liberado',
  REVERSED: 'Reversado',
}
export const CAMPAIGN_EVENT_LABELS: Record<SupplyV2CampaignEventType, string> = {
  CREATED: 'Creada',
  SUBMITTED: 'Enviada a revisión',
  APPROVED: 'Aprobada',
  REJECTED: 'Devuelta a borrador',
  PUBLISHED: 'Publicada',
  PAUSED: 'Pausada',
  RESUMED: 'Reactivada',
  COMPLETED: 'Terminada',
  CANCELLED: 'Cancelada',
  OFFER_ADDED: 'Oferta añadida',
  OFFER_REMOVED: 'Oferta retirada',
  BENEFIT_ATTACHED: 'Promoción configurada',
  COUPONS_GENERATED: 'Cupones generados',
  AUDIENCE_ASSIGNED: 'Campaña asignada a un cliente',
  BUDGET_WAIVED: 'Autorizada sin presupuesto máximo',
}

/** Tipos de promoción del §6, en el orden en que los enseña el asistente. */
export const TIPOS_DE_PROMOCION = [
  { clave: 'DESCUENTO_FIJO', label: 'Descuento de importe fijo', explicacion: 'Rebaja un importe fijo del precio Membego.' },
  { clave: 'DESCUENTO_PORCENTUAL', label: 'Descuento porcentual', explicacion: 'Rebaja un porcentaje del precio Membego, con tope opcional.' },
  { clave: 'CUPON_FIJO', label: 'Cupón de importe fijo', explicacion: 'Un código que rebaja un importe fijo.' },
  { clave: 'CUPON_PORCENTUAL', label: 'Cupón porcentual', explicacion: 'Un código que rebaja un porcentaje, con tope opcional.' },
  { clave: 'BIENVENIDA', label: 'Oferta de bienvenida', explicacion: 'Para clientes que todavía no han comprado.' },
  { clave: 'TIEMPO_LIMITADO', label: 'Oferta por tiempo limitado', explicacion: 'Vale solo dentro de un horario, además de la vigencia.' },
  { clave: 'BONO_ASIGNADO', label: 'Bono promocional asignado', explicacion: 'Se asigna cliente por cliente, sin código.' },
  { clave: 'COMPARTIDA', label: 'Financiación compartida', explicacion: 'Parte la pone el proveedor y parte Membego.' },
] as const

export type TipoDePromocion = (typeof TIPOS_DE_PROMOCION)[number]['clave']

// ── Slice 8 · fidelización: programas, membresías, puntos y recompensas ─────
//
// El nombre importa: Supply V1 ya tiene en producción «Membresías»,
// «Referidos» y «Recompensas» en sus propios menús. Todo lo del Slice 8 vive
// bajo FIDELIZACIÓN, una palabra que V1 no usa en ninguna pantalla, para que
// nadie confunda dos sistemas que conviven.

import type {
  SupplyV2CustomerMembershipStatus,
  SupplyV2LoyaltyEventType,
  SupplyV2LoyaltyModality,
  SupplyV2LoyaltyOwner,
  SupplyV2LoyaltyProgramStatus,
  SupplyV2MembershipBenefitKind,
  SupplyV2MembershipPlanKind,
  SupplyV2MembershipPlanStatus,
  SupplyV2PointsMovementType,
  SupplyV2ReferralRewardKind,
  SupplyV2ReferralStatus,
  SupplyV2RewardClaimStatus,
  SupplyV2RewardKind,
  SupplyV2RewardStatus,
} from '@prisma/client'

export const RUTA_FIDELIZACION = `${BASE_SUPPLY_V2}/fidelizacion`
export const RUTA_FIDELIZACION_CLIENTE = '/cliente/fidelizacion'
export const RUTA_MEMBRESIAS_PUBLICAS = '/promociones/membresias'
export const RUTA_PORTAL_FIDELIZACION = `${RUTA_PORTAL_PROVEEDOR}/fidelizacion`

export const LOYALTY_PROGRAM_STATUS_LABELS: Record<SupplyV2LoyaltyProgramStatus, string> = {
  DRAFT: 'Borrador',
  PENDING_APPROVAL: 'En revisión',
  ACTIVE: 'Activo',
  PAUSED: 'Pausado',
  COMPLETED: 'Terminado',
  CANCELLED: 'Cancelado',
}
export const LOYALTY_PROGRAM_STATUS_TONE: Record<SupplyV2LoyaltyProgramStatus, Tono> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
}
export const LOYALTY_OWNER_LABELS: Record<SupplyV2LoyaltyOwner, string> = {
  MEMBEGO: 'Lo administra Membego',
  SUPPLIER: 'Lo administra el negocio',
}
export const LOYALTY_MODALITY_LABELS: Record<SupplyV2LoyaltyModality, string> = {
  MEMBERSHIPS: 'Membresías',
  REFERRALS: 'Referidos',
  POINTS: 'Puntos',
  REWARDS: 'Recompensas',
}
export const LOYALTY_MODALITY_EXPLICACION: Record<SupplyV2LoyaltyModality, string> = {
  MEMBERSHIPS: 'Planes que el cliente contrata, gratis o pagando, con beneficios mientras estén vigentes.',
  REFERRALS: 'Cada cliente invita con su código y cobra cuando el invitado hace su primera compra válida.',
  POINTS: 'El cliente acumula puntos con sus compras, según una regla que tú defines.',
  REWARDS: 'Catálogo donde el cliente cambia sus puntos por algo concreto.',
}
export const MEMBERSHIP_PLAN_KIND_LABELS: Record<SupplyV2MembershipPlanKind, string> = {
  FREE: 'Gratuita',
  PAID: 'De pago',
  GRANTED: 'Solo otorgada',
}
export const MEMBERSHIP_PLAN_STATUS_LABELS: Record<SupplyV2MembershipPlanStatus, string> = {
  DRAFT: 'Borrador',
  PUBLISHED: 'Publicado',
  PAUSED: 'Pausado',
  ARCHIVED: 'Archivado',
}
export const MEMBERSHIP_PLAN_STATUS_TONE: Record<SupplyV2MembershipPlanStatus, Tono> = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  PAUSED: 'warning',
  ARCHIVED: 'neutral',
}
export const MEMBERSHIP_STATUS_LABELS: Record<SupplyV2CustomerMembershipStatus, string> = {
  PENDING_PAYMENT: 'Pendiente de pago',
  SCHEDULED: 'Programada',
  ACTIVE: 'Activa',
  SUSPENDED: 'Suspendida',
  EXPIRED: 'Vencida',
  CANCELLED: 'Cancelada',
}
export const MEMBERSHIP_STATUS_TONE: Record<SupplyV2CustomerMembershipStatus, Tono> = {
  PENDING_PAYMENT: 'warning',
  SCHEDULED: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  EXPIRED: 'neutral',
  CANCELLED: 'danger',
}
export const MEMBERSHIP_BENEFIT_KIND_LABELS: Record<SupplyV2MembershipBenefitKind, string> = {
  BENEFIT: 'Un beneficio del catálogo',
  COUPON: 'Un cupón exclusivo',
  POINTS_MULTIPLIER: 'Multiplicador de puntos',
  EARLY_ACCESS: 'Acceso anticipado',
}
export const REWARD_KIND_LABELS: Record<SupplyV2RewardKind, string> = {
  COUPON: 'Un cupón del catálogo',
  BENEFIT: 'Un beneficio',
  FREE_PRODUCT: 'Un producto gratis',
  SERVICE: 'Un servicio',
  PARTIAL_BONUS: 'Un bono parcial',
}
export const REWARD_STATUS_LABELS: Record<SupplyV2RewardStatus, string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Activa',
  PAUSED: 'Pausada',
  EXHAUSTED: 'Agotada',
  EXPIRED: 'Vencida',
  CANCELLED: 'Cancelada',
}
export const REWARD_STATUS_TONE: Record<SupplyV2RewardStatus, Tono> = {
  DRAFT: 'neutral',
  ACTIVE: 'success',
  PAUSED: 'warning',
  EXHAUSTED: 'neutral',
  EXPIRED: 'neutral',
  CANCELLED: 'danger',
}
export const REWARD_CLAIM_STATUS_LABELS: Record<SupplyV2RewardClaimStatus, string> = {
  RESERVED: 'Puntos reservados',
  CLAIMED: 'Reclamada',
  DELIVERED: 'Entregada',
  EXPIRED: 'Vencida',
  CANCELLED: 'Cancelada',
  REVERSED: 'Reversada',
}
export const REWARD_CLAIM_STATUS_TONE: Record<SupplyV2RewardClaimStatus, Tono> = {
  RESERVED: 'info',
  CLAIMED: 'success',
  DELIVERED: 'success',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
  REVERSED: 'danger',
}
export const REFERRAL_STATUS_LABELS: Record<SupplyV2ReferralStatus, string> = {
  LINK_OPENED: 'Abrió el enlace',
  SIGNED_UP: 'Se registró',
  VERIFIED: 'Verificado',
  PURCHASE_ELIGIBLE: 'Compró: con derecho a premio',
  REWARD_PENDING: 'Premio en espera',
  REWARD_APPROVED: 'Premio aprobado',
  REWARD_GRANTED: 'Premio entregado',
  REWARD_VOIDED: 'Premio anulado',
}
export const REFERRAL_STATUS_TONE: Record<SupplyV2ReferralStatus, Tono> = {
  LINK_OPENED: 'neutral',
  SIGNED_UP: 'info',
  VERIFIED: 'info',
  PURCHASE_ELIGIBLE: 'warning',
  REWARD_PENDING: 'warning',
  REWARD_APPROVED: 'info',
  REWARD_GRANTED: 'success',
  REWARD_VOIDED: 'danger',
}
export const REFERRAL_REWARD_KIND_LABELS: Record<SupplyV2ReferralRewardKind, string> = {
  POINTS: 'Puntos',
  BONUS: 'Un bono de Membego',
  COUPON: 'Un cupón',
  SUPPLIER_BENEFIT: 'Un beneficio del negocio',
}
export const POINTS_MOVEMENT_LABELS: Record<SupplyV2PointsMovementType, string> = {
  EARNED: 'Ganados',
  PENDING: 'En espera',
  AVAILABLE: 'Disponibles',
  RESERVED: 'Reservados',
  REDEEMED: 'Canjeados',
  RELEASED: 'Devueltos',
  EXPIRED: 'Vencidos',
  REVERSED: 'Reversados',
  ADMIN_ADJUSTMENT: 'Ajuste manual',
}
export const LOYALTY_EVENT_LABELS: Record<SupplyV2LoyaltyEventType, string> = {
  PROGRAM_CREATED: 'Programa creado',
  PROGRAM_SUBMITTED: 'Enviado a revisión',
  PROGRAM_APPROVED: 'Aprobado',
  PROGRAM_REJECTED: 'Devuelto a borrador',
  PROGRAM_PAUSED: 'Pausado',
  PROGRAM_RESUMED: 'Reactivado',
  PROGRAM_COMPLETED: 'Terminado',
  PROGRAM_CANCELLED: 'Cancelado',
  PLAN_CREATED: 'Plan creado',
  PLAN_UPDATED: 'Plan modificado',
  PLAN_PUBLISHED: 'Plan publicado',
  PLAN_PAUSED: 'Plan pausado',
  PLAN_ARCHIVED: 'Plan archivado',
  MEMBERSHIP_STARTED: 'Membresía contratada',
  MEMBERSHIP_ACTIVATED: 'Membresía activada',
  MEMBERSHIP_RENEWED: 'Membresía renovada',
  MEMBERSHIP_EXPIRED: 'Membresía vencida',
  MEMBERSHIP_CANCELLED: 'Membresía cancelada',
  MEMBERSHIP_SUSPENDED: 'Membresía suspendida',
  MEMBERSHIP_GRANTED: 'Membresía otorgada sin cobro',
  REFERRAL_CODE_CREATED: 'Código de invitación creado',
  REFERRAL_SIGNED_UP: 'Alguien se registró con una invitación',
  REFERRAL_VERIFIED: 'Invitación verificada',
  REFERRAL_ELIGIBLE: 'Un invitado compró',
  REFERRAL_REWARD_APPROVED: 'Premio de referido aprobado',
  REFERRAL_REWARD_GRANTED: 'Premio de referido entregado',
  REFERRAL_REWARD_VOIDED: 'Premio de referido anulado',
  POINTS_EARNED: 'Puntos ganados',
  POINTS_AVAILABLE: 'Puntos liberados',
  POINTS_EXPIRED: 'Puntos vencidos',
  POINTS_ADJUSTED: 'Puntos ajustados a mano',
  REWARD_CREATED: 'Recompensa creada',
  REWARD_PUBLISHED: 'Recompensa aprobada y publicada',
  REWARD_CLAIMED: 'Recompensa reclamada',
  REWARD_DELIVERED: 'Recompensa entregada',
  REWARD_REVERSED: 'Recompensa reversada',
  BUDGET_WAIVED: 'Autorizado sin presupuesto máximo',
}
