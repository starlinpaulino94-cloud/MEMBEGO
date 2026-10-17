/**
 * PLATAFORMA · inventario — proyección y lectura de cuerpos para la API v1 (INV-5e). Pura: sin Prisma, sin red.
 *
 * Lista blanca de campos, como el resto de DTOs de la API. Esta superficie NO expone costos: ni el costo promedio ni el unitario de un
 * movimiento salen por aquí, ni siquiera hacia la clave de la propia empresa. Es el mismo trato que la función «costos» del panel, que no
 * se concede por defecto a quien solo mueve existencias; dar costos por la API pediría su propio scope y no se ha pedido.
 */

import { InventarioError } from '@/modules/inventory/errores'

export interface NivelDTO {
  /** El saldo (variante × sucursal). Es el cursor de la paginación. */
  id: string
  variantId: string
  sku: string
  itemName: string
  variantName: string
  branchId: string
  branchName: string
  onHand: number
  reserved: number
  damaged: number
  /** Lo que se puede vender ahora: `onHand − reserved`. */
  available: number
  lowStockThreshold: number
}

export interface MovimientoDTO {
  id: string
  variantId: string
  branchId: string
  type: string
  sourceBucket: string | null
  destinationBucket: string | null
  quantity: number
  previousOnHand: number
  newOnHand: number
  reasonCode: string | null
  reason: string | null
  reference: { type: string; id: string } | null
  createdAt: string
}

interface FilaNivel {
  id: string
  onHand: number
  reserved: number
  damaged: number
  lowStockThreshold: number
  locationId: string
  location: { nombre: string }
  variant: { id: string; sku: string; name: string; item: { name: string } }
}

export function nivelDTO(f: FilaNivel): NivelDTO {
  return {
    id: f.id,
    variantId: f.variant.id,
    sku: f.variant.sku,
    itemName: f.variant.item.name,
    variantName: f.variant.name,
    branchId: f.locationId,
    branchName: f.location.nombre,
    onHand: f.onHand,
    reserved: f.reserved,
    damaged: f.damaged,
    available: f.onHand - f.reserved,
    lowStockThreshold: f.lowStockThreshold,
  }
}

interface FilaMovimiento {
  id: string
  type: string
  sourceBucket: string | null
  destinationBucket: string | null
  quantity: number
  previousOnHand: number
  newOnHand: number
  reasonCode: string | null
  reason: string | null
  referenceType: string | null
  referenceId: string | null
  createdAt: Date
  level: { catalogVariantId: string; locationId: string }
}

export function movimientoDTO(f: FilaMovimiento): MovimientoDTO {
  return {
    id: f.id,
    variantId: f.level.catalogVariantId,
    branchId: f.level.locationId,
    type: f.type,
    sourceBucket: f.sourceBucket,
    destinationBucket: f.destinationBucket,
    quantity: f.quantity,
    previousOnHand: f.previousOnHand,
    newOnHand: f.newOnHand,
    reasonCode: f.reasonCode,
    reason: f.reason,
    reference: f.referenceType && f.referenceId ? { type: f.referenceType, id: f.referenceId } : null,
    createdAt: f.createdAt.toISOString(),
  }
}

// ── Escrituras ───────────────────────────────────────────────────────────────

/** Cabecera `Idempotency-Key` → clave de los movimientos. Con prefijo, para no chocar con las claves que pone el propio sistema. */
export const PREFIJO_CLAVE_API = 'api:'
const MAX_CLAVE_API = 100

export function claveDeCabecera(valor: string | null): { ok: true; clave: string } | { ok: false } {
  const v = valor?.trim() ?? ''
  if (v === '' || v.length > MAX_CLAVE_API || !/^[\x21-\x7e]+$/.test(v)) return { ok: false }
  return { ok: true, clave: `${PREFIJO_CLAVE_API}${v}` }
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const texto = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** `[{ code, expiresOn?, quantity }]` → lo que recibe el servicio, `[{ codigo, vencimiento, cantidad }]`. Lo que no cuadra se pasa tal cual para que el servicio lo rechace. */
export function lotesDeCuerpo(v: unknown): unknown {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v)) return v
  return v.map((l) => (esObjeto(l) ? { codigo: l.code, vencimiento: l.expiresOn ?? null, cantidad: l.quantity } : l))
}

/** `[{ lotId, quantity }]` → `[{ loteId, cantidad }]`. */
export function lotesDeSalidaDeCuerpo(v: unknown): unknown {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v)) return v
  return v.map((l) => (esObjeto(l) ? { loteId: l.lotId, cantidad: l.quantity } : l))
}

export interface CuerpoMovimiento {
  varianteId: string
  sucursalId: string
  nota: string | null
  lotes: unknown
  lotesSalida: unknown
}

function base(c: unknown): (CuerpoMovimiento & { crudo: Record<string, unknown> }) | null {
  if (!esObjeto(c)) return null
  const varianteId = texto(c.variantId)?.trim()
  const sucursalId = texto(c.branchId)?.trim()
  if (!varianteId || !sucursalId) return null
  return { varianteId, sucursalId, nota: texto(c.note), lotes: lotesDeCuerpo(c.lots), lotesSalida: lotesDeSalidaDeCuerpo(c.lotsOut), crudo: c }
}

/** `POST /inventory/receipts` → `{ variantId, branchId, quantity, note?, lots? }`. Sin costo: esta API no los lee. */
export function entradaDeCuerpo(c: unknown): (CuerpoMovimiento & { cantidad: unknown }) | null {
  const b = base(c)
  if (!b || 'cost' in b.crudo) return null
  return { varianteId: b.varianteId, sucursalId: b.sucursalId, nota: b.nota, lotes: b.lotes, lotesSalida: undefined, cantidad: b.crudo.quantity }
}

/** `POST /inventory/adjustments` → `{ variantId, branchId, change, reasonCode, note?, lots?, lotsOut? }`. El código de motivo es obligatorio. */
export function ajusteDeCuerpo(c: unknown): (CuerpoMovimiento & { cambio: unknown; motivoCodigo: string }) | null {
  const b = base(c)
  const motivoCodigo = b ? texto(b.crudo.reasonCode)?.trim() : null
  if (!b || !motivoCodigo) return null
  return { varianteId: b.varianteId, sucursalId: b.sucursalId, nota: b.nota, lotes: b.lotes, lotesSalida: b.lotesSalida, cambio: b.crudo.change, motivoCodigo }
}

/** Código de error del dominio → qué contesta la API. Todo lo que no se reconoce es de nosotros (500). */
export function clasificarErrorDeInventario(e: unknown): { codigo: 'NOT_FOUND' | 'INVALID_REQUEST'; reason: string; message: string } | null {
  if (!(e instanceof InventarioError)) return null
  if (e.codigo === 'VARIANTE_NO_ENCONTRADA' || e.codigo === 'SUCURSAL_NO_ENCONTRADA') return { codigo: 'NOT_FOUND', reason: e.codigo.toLowerCase(), message: e.message }
  if (e.codigo === 'CLAVE_REUTILIZADA') return { codigo: 'INVALID_REQUEST', reason: 'idempotency_key_reused', message: 'That Idempotency-Key was already used for a different operation.' }
  return { codigo: 'INVALID_REQUEST', reason: e.codigo === 'STOCK_INSUFICIENTE' ? 'insufficient_stock' : e.codigo.toLowerCase(), message: e.message }
}
