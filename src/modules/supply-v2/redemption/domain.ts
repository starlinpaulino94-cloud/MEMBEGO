import { randomBytes } from 'crypto'
import type { SupplyV2EntitlementStatus, SupplyV2VoucherStatus } from '@prisma/client'

/**
 * MEMBEGO SUPPLY · SLICE 3 · reglas PURAS de voucher, QR y canje.
 *
 * Sin Prisma. Aquí se decide qué credencial vale, qué sesión QR está viva y
 * por qué se rechaza un canje. La base y los candados están en `service.ts`.
 */

// ── Credenciales ─────────────────────────────────────────────────────────────

/** 24 bytes = 192 bits, por encima del mínimo de 128 (§8). Base64url: cabe en un QR pequeño. */
export const BYTES_NONCE = 24
export const BYTES_CODIGO_VOUCHER = 32

export function nuevoNonce(): string {
  return randomBytes(BYTES_NONCE).toString('base64url')
}

export function nuevoCodigoVoucher(): string {
  return randomBytes(BYTES_CODIGO_VOUCHER).toString('base64url')
}

/** Lo que un escáner o un teclado puede mandar: base64url de 24 bytes exactos. */
export const FORMATO_NONCE = /^[A-Za-z0-9_-]{32}$/

export function nonceConFormatoValido(s: string): boolean {
  return FORMATO_NONCE.test(s)
}

/** Limpia lo leído (espacios, un prefijo de URL) sin «arreglar» credenciales. */
export function normalizarCodigoLeido(crudo: string): string {
  const s = crudo.trim()
  const m = /([A-Za-z0-9_-]{32})$/.exec(s)
  return m ? m[1]! : s.slice(0, 64)
}

// ── Sesión QR: estado derivado (§44) ─────────────────────────────────────────

export type EstadoSesionQr = 'ACTIVE' | 'EXPIRED' | 'CONSUMED'

export function estadoSesionQr(s: { expiresAt: Date; consumedAt: Date | null }, ahora = new Date()): EstadoSesionQr {
  if (s.consumedAt) return 'CONSUMED'
  return s.expiresAt.getTime() <= ahora.getTime() ? 'EXPIRED' : 'ACTIVE'
}

export function segundosRestantes(expiresAt: Date, ahora = new Date()): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - ahora.getTime()) / 1000))
}

// ── ¿Puede este derecho generar un voucher / un QR? (§6, §10) ────────────────

export interface DerechoParaVoucher {
  status: SupplyV2EntitlementStatus
  expiresAt: Date | null
  customerId: string
}

export function motivoSinVoucher(d: DerechoParaVoucher, customerId: string, ahora = new Date()): CodigoRechazo | null {
  if (d.customerId !== customerId) return 'NOT_OWNER'
  if (d.status === 'REDEEMED') return 'ALREADY_REDEEMED'
  if (d.status === 'CANCELLED') return 'ENTITLEMENT_CANCELLED'
  if (d.status === 'EXPIRED') return 'ENTITLEMENT_EXPIRED'
  if (d.expiresAt && d.expiresAt.getTime() <= ahora.getTime()) return 'ENTITLEMENT_EXPIRED'
  return null
}

// ── Validación del canje (§16, §17, §23) ─────────────────────────────────────

export type CodigoRechazo =
  | 'INVALID_QR'
  | 'QR_EXPIRED'
  | 'QR_CONSUMED'
  | 'ALREADY_REDEEMED'
  | 'VOUCHER_EXPIRED'
  | 'VOUCHER_INACTIVE'
  | 'ENTITLEMENT_EXPIRED'
  | 'ENTITLEMENT_CANCELLED'
  | 'ENTITLEMENT_INACTIVE'
  | 'WRONG_SUPPLIER'
  | 'SUPPLIER_INACTIVE'
  | 'WRONG_BRANCH'
  | 'BRANCH_REQUIRED'
  | 'NOT_OWNER'
  | 'LEDGER_INCONSISTENT'
  | 'RATE_LIMITED'

/** Mensajes para quien escanea (§67). Sin trazas, sin ids. */
export const MENSAJES_RECHAZO: Record<CodigoRechazo, string> = {
  INVALID_QR: 'Código no válido.',
  QR_EXPIRED: 'Este código expiró. Pide al cliente generar uno nuevo.',
  QR_CONSUMED: 'Este código ya se usó. Pide al cliente generar uno nuevo.',
  ALREADY_REDEEMED: 'Este beneficio ya fue utilizado.',
  VOUCHER_EXPIRED: 'Este beneficio venció.',
  VOUCHER_INACTIVE: 'Este beneficio no está activo.',
  ENTITLEMENT_EXPIRED: 'Este beneficio venció.',
  ENTITLEMENT_CANCELLED: 'Este beneficio fue cancelado.',
  ENTITLEMENT_INACTIVE: 'Este beneficio no está activo.',
  WRONG_SUPPLIER: 'Este beneficio pertenece a otro comercio.',
  SUPPLIER_INACTIVE: 'El comercio no está activo en Membego Supply.',
  WRONG_BRANCH: 'Este beneficio no puede usarse en esta sucursal.',
  BRANCH_REQUIRED: 'Elige la sucursal donde estás entregando.',
  NOT_OWNER: 'Este beneficio no es tuyo.',
  LEDGER_INCONSISTENT: 'No se puede entregar: el inventario de este beneficio no cuadra. Avisa a Membego.',
  RATE_LIMITED: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
}

export interface CanjeParaValidar {
  sesion: { expiresAt: Date; consumedAt: Date | null; branchId: string | null }
  voucher: { status: SupplyV2VoucherStatus; validUntil: Date | null }
  derecho: { status: SupplyV2EntitlementStatus; expiresAt: Date | null; supplierId: string; customerId: string; lotStatus?: string }
  /** Proveedor del derecho. */
  proveedor: { status: string; companyId: string | null }
  /** Quien escanea: su empresa y el proveedor resuelto desde ella. */
  empleado: { supplierId: string; companyId: string }
  /** Sucursal donde se entrega, ya verificada como de la empresa del empleado (o null si no eligió). */
  sucursal: { id: string; companyId: string; activa: boolean } | null
  /** ¿El proveedor tiene sucursales? Si sí, la entrega exige una. */
  proveedorTieneSucursales: boolean
  /** ISSUED del lote: al canjear debe haber al menos 1. `null` en COMISIÓN (Slice 5): no hay lote. */
  lotIssued: number | null
}

/**
 * Orden de comprobación (§16): primero lo que NO depende de quién escanea
 * (sesión, voucher, derecho), luego el comercio y la sucursal. Devuelve el
 * primer motivo o null si todo está bien. No cambia nada.
 */
export function motivoNoCanjeable(c: CanjeParaValidar, ahora = new Date()): CodigoRechazo | null {
  const estadoSesion = estadoSesionQr(c.sesion, ahora)
  if (estadoSesion === 'CONSUMED') return c.derecho.status === 'REDEEMED' ? 'ALREADY_REDEEMED' : 'QR_CONSUMED'
  if (estadoSesion === 'EXPIRED') return 'QR_EXPIRED'

  if (c.derecho.status === 'REDEEMED') return 'ALREADY_REDEEMED'
  if (c.derecho.status === 'EXPIRED') return 'ENTITLEMENT_EXPIRED'
  if (c.derecho.status === 'CANCELLED') return 'ENTITLEMENT_CANCELLED'
  if (c.derecho.status !== 'ACTIVE') return 'ENTITLEMENT_INACTIVE'
  if (c.derecho.expiresAt && c.derecho.expiresAt.getTime() <= ahora.getTime()) return 'ENTITLEMENT_EXPIRED'

  if (c.voucher.status === 'REDEEMED') return 'ALREADY_REDEEMED'
  if (c.voucher.status === 'EXPIRED') return 'VOUCHER_EXPIRED'
  if (c.voucher.status !== 'ACTIVE') return 'VOUCHER_INACTIVE'
  if (c.voucher.validUntil && c.voucher.validUntil.getTime() <= ahora.getTime()) return 'VOUCHER_EXPIRED'

  if (c.derecho.supplierId !== c.empleado.supplierId) return 'WRONG_SUPPLIER'
  if (c.proveedor.companyId !== c.empleado.companyId) return 'WRONG_SUPPLIER'
  if (c.proveedor.status !== 'ACTIVE') return 'SUPPLIER_INACTIVE'

  if (c.proveedorTieneSucursales && !c.sucursal) return 'BRANCH_REQUIRED'
  if (c.sucursal) {
    if (c.sucursal.companyId !== c.empleado.companyId || !c.sucursal.activa) return 'WRONG_BRANCH'
    if (c.sesion.branchId && c.sesion.branchId !== c.sucursal.id) return 'WRONG_BRANCH'
  } else if (c.sesion.branchId) {
    return 'BRANCH_REQUIRED'
  }

  if (c.lotIssued !== null && c.lotIssued < 1) return 'LEDGER_INCONSISTENT'
  return null
}

// ── Lo que ve el empleado (§19, §49, §50) ────────────────────────────────────

export interface RedeemPreview {
  valid: boolean
  reason?: CodigoRechazo
  message?: string
  /** Solo si `valid`. Ninguno de estos campos es un costo interno. */
  sessionId?: string
  entitlementId?: string
  customerName?: string
  productName?: string
  supplierName?: string
  branchName?: string | null
  quantity: number
  /** Lo que el cliente paga al comercio al recoger. Precompra completa: "0.00". */
  customerPaysMerchant: string
  currency?: string
  /** Vencimiento del QR (no del beneficio). */
  expiresAt?: Date
  /** Clave que el escáner reenviará al confirmar (idempotencia, §70). */
  idempotencyKey?: string
}

export function previewRechazado(reason: CodigoRechazo): RedeemPreview {
  return { valid: false, reason, message: MENSAJES_RECHAZO[reason], quantity: 0, customerPaysMerchant: '0.00' }
}
