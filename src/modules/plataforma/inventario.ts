import type { NextResponse } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { ajustarEnTx, recibirEnTx, type ResultadoMovimiento } from '@/modules/inventory/service'
import { avisarStockBajo } from '@/modules/inventory/avisos'
import { errorApi } from '@/modules/plataforma/errores'
import { movimientoDTO, nivelDTO, clasificarErrorDeInventario, type MovimientoDTO, type NivelDTO } from './inventario-dto'

/**
 * PLATAFORMA · inventario — lógica de las rutas `/inventory/*` (INV-5e). Las rutas solo autentican y responden; lo que decide algo vive
 * aquí o en el servicio del inventario, que es el MISMO que usa el panel: la API no tiene un segundo camino hacia las existencias.
 *
 * REGLAS:
 *  · Mismo cierre que el catálogo: sin la capacidad CATALOGO_UNIFICADO la empresa contesta `NOT_FOUND`.
 *  · Escribir (`inventory:manage`) es solo de la clave de la propia empresa y exige `Idempotency-Key`: un reintento tras un timeout no
 *    puede sumar dos veces. La clave viaja al servicio, que ya sabe distinguir un reintento (misma operación) de un abuso (otra).
 *  · Cada movimiento queda atribuido a la clave: su referencia es `API` + el id de la clave, y la bitácora lleva el agente `platform-api`.
 *  · Sin costos, ni de entrada ni de salida (ver `inventario-dto`).
 */

export function inventarioNoHabilitado(requestId: string): NextResponse {
  return errorApi('NOT_FOUND', requestId, { message: 'The unified catalog is not enabled for this company.', reason: 'catalog_not_enabled' })
}

export function soloClaveDeEmpresaParaInventario(requestId: string): NextResponse {
  return errorApi('INSUFFICIENT_SCOPE', requestId, {
    requiredScope: 'inventory:manage',
    reason: 'company_api_key_required',
    message: 'Moving stock requires a company API key, not a satellite credential.',
  })
}

export function respuestaDeErrorDeInventario(e: unknown, requestId: string): NextResponse | null {
  const c = clasificarErrorDeInventario(e)
  return c ? errorApi(c.codigo, requestId, { message: c.message, reason: c.reason }) : null
}

// ── Lecturas ─────────────────────────────────────────────────────────────────

type Cursor = { cursor: { id: string }; skip: number } | Record<string, never>

export async function listarNiveles(companyId: string, o: { take: number; cursor: Cursor; branchId?: string; variantId?: string }): Promise<NivelDTO[]> {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.inventoryLevel.findMany({
      where: { companyId, ...(o.branchId ? { locationId: o.branchId } : {}), ...(o.variantId ? { catalogVariantId: o.variantId } : {}) },
      select: {
        id: true,
        onHand: true,
        reserved: true,
        damaged: true,
        lowStockThreshold: true,
        locationId: true,
        location: { select: { nombre: true } },
        variant: { select: { id: true, sku: true, name: true, item: { select: { name: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: o.take,
      ...o.cursor,
    })
  )
  return filas.map(nivelDTO)
}

export async function listarMovimientos(companyId: string, o: { take: number; cursor: Cursor; branchId?: string; variantId?: string }): Promise<MovimientoDTO[]> {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.inventoryMovement.findMany({
      where: { companyId, ...(o.branchId || o.variantId ? { level: { ...(o.branchId ? { locationId: o.branchId } : {}), ...(o.variantId ? { catalogVariantId: o.variantId } : {}) } } : {}) },
      select: {
        id: true,
        type: true,
        sourceBucket: true,
        destinationBucket: true,
        quantity: true,
        previousOnHand: true,
        newOnHand: true,
        reasonCode: true,
        reason: true,
        referenceType: true,
        referenceId: true,
        createdAt: true,
        level: { select: { catalogVariantId: true, locationId: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: o.take,
      ...o.cursor,
    })
  )
  return filas.map(movimientoDTO)
}

// ── Escrituras ───────────────────────────────────────────────────────────────

const ctxAuditoria = { actorId: null, ipAddress: null, userAgent: 'platform-api' } as const

export interface ResultadoApi {
  level: { available: number; onHand: number; reserved: number; damaged: number }
  movementId: string
  /** true si era un reintento de una operación que ya se había hecho. */
  repeated: boolean
}

const aResultado = (r: ResultadoMovimiento): ResultadoApi => ({
  level: { available: r.saldo.disponible, onHand: r.saldo.onHand, reserved: r.saldo.reserved, damaged: r.saldo.damaged },
  movementId: r.movimientoId,
  repeated: r.repetido,
})

const detalle = (nota: string | null, prefijo: string) => (nota && nota.trim() !== '' ? nota : `API ${prefijo}`)

export async function registrarEntradaPorApi(
  companyId: string,
  clave: { id: string; prefijo: string },
  idempotencyKey: string,
  e: { varianteId: string; sucursalId: string; cantidad: unknown; nota: string | null; lotes: unknown }
): Promise<ResultadoApi> {
  const r = await conEmpresa(companyId, (tx) =>
    recibirEnTx(
      tx,
      companyId,
      { varianteId: e.varianteId, sucursalId: e.sucursalId, cantidad: e.cantidad as number, motivo: detalle(e.nota, clave.prefijo), referencia: { tipo: 'API', id: clave.id }, idempotencyKey, lotes: e.lotes },
      ctxAuditoria
    )
  )
  return aResultado(r)
}

export async function registrarAjustePorApi(
  companyId: string,
  clave: { id: string; prefijo: string },
  idempotencyKey: string,
  e: { varianteId: string; sucursalId: string; cambio: unknown; motivoCodigo: string; nota: string | null; lotes: unknown; lotesSalida: unknown }
): Promise<ResultadoApi> {
  const r = await conEmpresa(companyId, (tx) =>
    ajustarEnTx(
      tx,
      companyId,
      {
        varianteId: e.varianteId,
        sucursalId: e.sucursalId,
        cambio: e.cambio as number,
        motivoCodigo: e.motivoCodigo,
        exigirMotivoCodificado: true,
        // Sin valor por defecto: «Otro» exige que la persona explique, y un texto puesto por nosotros lo dejaría pasar vacío.
        motivo: e.nota,
        referencia: { tipo: 'API', id: clave.id },
        idempotencyKey,
        lotes: e.lotes,
        lotesSalida: e.lotesSalida,
      },
      ctxAuditoria
    )
  )
  if (!r.repetido && typeof e.cambio === 'number' && e.cambio < 0) await avisarStockBajo(companyId, [e.varianteId])
  return aResultado(r)
}
