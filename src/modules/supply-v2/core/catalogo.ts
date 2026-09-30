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
