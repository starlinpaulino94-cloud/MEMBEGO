'use server'

import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import type { SupplyV2IncidentType } from '@prisma/client'
import { createRateLimiter } from '@/lib/rate-limit'
import { getRequestMeta } from '@/lib/server-utils'
import { sinEmpresa } from '@/lib/tenant'
import { exigirCliente, exigirPermisoSupplyV2, exigirProveedorSupplyV2 } from './permisos'
import { comoError, contextoDeAuditoria, refrescarSupplyV2, texto, type EstadoAccion } from './actions-util'
import { RUTA_COMPRAS_CLIENTE, RUTA_PORTAL_PROVEEDOR } from './core/catalogo'
import { MENSAJES_RECHAZO, normalizarCodigoLeido, type RedeemPreview } from './redemption/domain'
import {
  abrirSesionQrEnTx,
  confirmarEntregaEnTx,
  previsualizarCanjeEnTx,
  registrarIncidenciaEnTx,
  reversarRedencionEnTx,
  type EntregaConfirmada,
  type ReversaHecha,
  type SesionQrAbierta,
} from './redemption/service'

/**
 * MEMBEGO SUPPLY · SLICE 3 · server actions de canje.
 *
 * El CLIENTE genera QR solo de sus derechos (la sesión decide quién es, §46).
 * El PROVEEDOR se resuelve desde la empresa de la sesión (§47); la sucursal
 * que manda se verifica contra esa empresa dentro de la transacción (§48).
 * El SUPERADMIN reversa con permiso de plataforma (§45).
 *
 * Límites de tasa (§54) con la infraestructura existente: resolver y
 * confirmar por empleado, generar QR por cliente.
 */

const limiteEscaneo = createRateLimiter({ name: 'supply-v2-scan', interval: 60_000, maxRequests: 30 })
const limiteQr = createRateLimiter({ name: 'supply-v2-qr', interval: 60_000, maxRequests: 10 })

const INCIDENT_TYPES: readonly SupplyV2IncidentType[] = ['INVALID_QR', 'PRODUCT_UNAVAILABLE', 'WRONG_CUSTOMER', 'WRONG_BRANCH', 'OTHER']

function refrescarPortal(): void {
  revalidatePath(RUTA_PORTAL_PROVEEDOR)
  revalidatePath(`${RUTA_PORTAL_PROVEEDOR}/entregas`)
  revalidatePath(`${RUTA_PORTAL_PROVEEDOR}/escaner`)
}

// ── Cliente: «Usar beneficio» (§10–§13) ──────────────────────────────────────

export type QrParaMostrar = Pick<SesionQrAbierta, 'id' | 'nonce' | 'expiresAt'>

export async function usarBeneficioAction(_prev: EstadoAccion<QrParaMostrar>, fd: FormData): Promise<EstadoAccion<QrParaMostrar>> {
  try {
    const cliente = await exigirCliente()
    if (!(await limiteQr(cliente.id))) return { error: MENSAJES_RECHAZO.RATE_LIMITED }
    const ctx = await contextoDeAuditoria(cliente)
    const entitlementId = texto(fd, 'entitlementId', 60)
    const branchId = texto(fd, 'branchId', 60) || null
    const s = await sinEmpresa('Supply: el cliente genera un QR de su beneficio', (tx) =>
      abrirSesionQrEnTx(tx, { entitlementId, customerId: cliente.id, branchId, deviceInfo: ctx.userAgent }, ctx)
    )
    revalidatePath(RUTA_COMPRAS_CLIENTE)
    return { success: 'QR listo.', data: { id: s.id, nonce: s.nonce, expiresAt: s.expiresAt } }
  } catch (e) {
    return comoError(e, 'usarBeneficio')
  }
}

// ── Proveedor: escanear (preview) y confirmar (§15–§19, §22–§26) ────────────

export interface PreviewParaEscaner extends RedeemPreview {
  /** El código tal como se validó, para reenviarlo al confirmar. */
  nonce?: string
}

export async function escanearBeneficioAction(_prev: EstadoAccion<PreviewParaEscaner>, fd: FormData): Promise<EstadoAccion<PreviewParaEscaner>> {
  try {
    const p = await exigirProveedorSupplyV2()
    if (!(await limiteEscaneo(p.id))) return { error: MENSAJES_RECHAZO.RATE_LIMITED }
    const ctx = await contextoDeAuditoria(p)
    const nonce = normalizarCodigoLeido(texto(fd, 'codigo', 200))
    const branchId = texto(fd, 'branchId', 60) || null
    const preview = await sinEmpresa('Supply: el proveedor resuelve un QR', (tx) =>
      previsualizarCanjeEnTx(tx, { nonce, empleado: { userId: p.id, companyId: p.companyId, supplierId: p.supplierId }, branchId }, ctx)
    )
    if (!preview.valid) return { data: preview }
    return { data: { ...preview, nonce, idempotencyKey: randomUUID() } }
  } catch (e) {
    return comoError(e, 'escanearBeneficio')
  }
}

export async function confirmarEntregaAction(_prev: EstadoAccion<EntregaConfirmada>, fd: FormData): Promise<EstadoAccion<EntregaConfirmada>> {
  try {
    const p = await exigirProveedorSupplyV2()
    if (!(await limiteEscaneo(p.id))) return { error: MENSAJES_RECHAZO.RATE_LIMITED }
    const ctx = await contextoDeAuditoria(p)
    const meta = await getRequestMeta()
    const nonce = normalizarCodigoLeido(texto(fd, 'nonce', 200))
    const branchId = texto(fd, 'branchId', 60) || null
    const idempotencyKey = texto(fd, 'idempotencyKey', 80) || null
    const channel = texto(fd, 'channel', 20) === 'MANUAL_CODE' ? 'MANUAL_CODE' : 'QR_SCAN'
    const r = await sinEmpresa('Supply: el proveedor confirma una entrega', (tx) =>
      confirmarEntregaEnTx(tx, { nonce, empleado: { userId: p.id, companyId: p.companyId, supplierId: p.supplierId }, branchId, idempotencyKey, deviceInfo: meta.userAgent, channel }, ctx)
    )
    refrescarPortal()
    refrescarSupplyV2('supply', 'redenciones')
    revalidatePath(RUTA_COMPRAS_CLIENTE)
    return { success: r.repetida ? 'Esta entrega ya estaba confirmada.' : 'Entrega confirmada.', id: r.id, data: r }
  } catch (e) {
    return comoError(e, 'confirmarEntrega')
  }
}

export async function registrarIncidenciaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const p = await exigirProveedorSupplyV2()
    const ctx = await contextoDeAuditoria(p)
    const tipo = texto(fd, 'type', 40) as SupplyV2IncidentType
    if (!INCIDENT_TYPES.includes(tipo)) return { error: 'Elige el tipo de incidencia.' }
    const r = await sinEmpresa('Supply: el proveedor registra una incidencia', (tx) =>
      registrarIncidenciaEnTx(tx, { empleado: { userId: p.id, companyId: p.companyId, supplierId: p.supplierId }, branchId: texto(fd, 'branchId', 60) || null, type: tipo, notes: texto(fd, 'notes', 500) || null, codeSeen: texto(fd, 'codeSeen', 64) || null }, ctx)
    )
    refrescarPortal()
    return { success: 'Incidencia registrada.', id: r.id }
  } catch (e) {
    return comoError(e, 'registrarIncidencia')
  }
}

// ── Superadmin: reversar (§36–§40) ───────────────────────────────────────────

export async function reversarRedencionAction(_prev: EstadoAccion<ReversaHecha>, fd: FormData): Promise<EstadoAccion<ReversaHecha>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_REDEMPTION_REVERSE')
    const ctx = await contextoDeAuditoria(actor)
    const redemptionId = texto(fd, 'redemptionId', 60)
    const motivo = texto(fd, 'motivo', 500)
    if (!motivo) return { error: 'Escribe el motivo de la reversa.' }
    const r = await sinEmpresa('Supply: reversar una redención', (tx) => reversarRedencionEnTx(tx, redemptionId, motivo, ctx))
    refrescarSupplyV2('supply', 'redenciones', `redenciones/${redemptionId}`)
    refrescarPortal()
    revalidatePath(RUTA_COMPRAS_CLIENTE)
    return { success: `Redención ${r.number} reversada: el beneficio vuelve a estar disponible.`, id: r.id, data: r }
  } catch (e) {
    return comoError(e, 'reversarRedencion')
  }
}
