'use server'

import { revalidatePath } from 'next/cache'
import { createRateLimiter } from '@/lib/rate-limit'
import { sinEmpresa } from '@/lib/tenant'
import { exigirCliente, exigirPermisoSupplyV2, exigirProveedorSupplyV2, FUNCION_PORTAL } from '@/modules/supply-v2/permisos'
import { comoError, contextoDeAuditoria, refrescarSupplyV2, texto, type EstadoAccion } from '@/modules/supply-v2/actions-util'
import { MENSAJES_RECHAZO } from '@/modules/supply-v2/redemption/domain'
import { RUTA_PORTAL_CONFIGURACION, RUTA_PORTAL_ESCANER, RUTA_PORTAL_PROVEEDOR, RUTA_PORTAL_VENTAS_ADICIONALES, RUTA_VISITAS, RUTA_VISITAS_CLIENTE } from '@/modules/supply-v2/core/catalogo'
import { MAX_LINEAS_POR_VENTA, type LineaDeExtraEntrada } from './domain'
import { guardarExtraEnTx } from './extras'
import {
  cerrarVisitaEnTx,
  confirmarVisitaComoClienteEnTx,
  disputarVisitaComoClienteEnTx,
  marcarDisputaEnRevisionEnTx,
  registrarVentaAdicionalEnTx,
  resolverDisputaEnTx,
  reversarVentaAdicionalEnTx,
  verificarPagoDeVentaAdicionalEnTx,
  type ResolucionDeDisputa,
  type VentaAdicionalRegistrada,
} from './service'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · server actions de la visita atribuida
 * (§24–§36, §55).
 *
 * El PROVEEDOR registra extras y cierra la visita con la función
 * `ventas_adicionales` del portal; su empresa sale de la sesión, nunca del
 * formulario. Los precios de catálogo los RELEE el servidor dentro de la
 * transacción: lo que mande el navegador para un ítem del catálogo se
 * ignora (§55). El CLIENTE confirma o disputa solo SUS visitas. El
 * SUPERADMIN revisa disputas y registra evidencia externa con permiso de
 * plataforma.
 */

const limiteExtras = createRateLimiter({ name: 'visitas-extras', interval: 60_000, maxRequests: 40 })
const limiteCliente = createRateLimiter({ name: 'visitas-cliente', interval: 60_000, maxRequests: 20 })

function refrescarPortal(...ids: string[]): void {
  revalidatePath(RUTA_PORTAL_PROVEEDOR)
  revalidatePath(RUTA_PORTAL_ESCANER)
  revalidatePath(RUTA_PORTAL_VENTAS_ADICIONALES)
  for (const id of ids) revalidatePath(`${RUTA_PORTAL_VENTAS_ADICIONALES}/${id}`)
}

function refrescarCliente(visitId?: string): void {
  revalidatePath(RUTA_VISITAS_CLIENTE)
  if (visitId) revalidatePath(`${RUTA_VISITAS_CLIENTE}/${visitId}`)
}

/**
 * Las líneas llegan como JSON en `lineas`: `[{ supplyCatalogItemId, quantity }]`
 * o `[{ description, quantity, unitPrice }]` (línea personalizada). Se
 * sanean aquí; el dominio decide qué vale.
 */
function leerLineas(fd: FormData): LineaDeExtraEntrada[] | { error: string } {
  let crudo: unknown
  try {
    crudo = JSON.parse(String(fd.get('lineas') ?? '[]'))
  } catch {
    return { error: 'Las líneas de la venta no se pudieron leer.' }
  }
  if (!Array.isArray(crudo)) return { error: 'Las líneas de la venta no se pudieron leer.' }
  if (crudo.length > MAX_LINEAS_POR_VENTA) return { error: `Una venta admite hasta ${MAX_LINEAS_POR_VENTA} líneas.` }
  const lineas: LineaDeExtraEntrada[] = []
  for (const l of crudo) {
    if (!l || typeof l !== 'object') return { error: 'Hay una línea inválida.' }
    const o = l as Record<string, unknown>
    const quantity = Math.trunc(Number(o.quantity))
    if (typeof o.supplyCatalogItemId === 'string' && o.supplyCatalogItemId) {
      lineas.push({ supplyCatalogItemId: o.supplyCatalogItemId.slice(0, 60), quantity })
    } else {
      lineas.push({ description: String(o.description ?? '').trim().slice(0, 160), quantity, unitPrice: String(o.unitPrice ?? '').trim().slice(0, 20) })
    }
  }
  return lineas
}

// ── Proveedor: registrar extras y cerrar la visita (§25–§27) ────────────────

export async function registrarVentaAdicionalAction(_prev: EstadoAccion<VentaAdicionalRegistrada>, fd: FormData): Promise<EstadoAccion<VentaAdicionalRegistrada>> {
  try {
    const p = await exigirProveedorSupplyV2(FUNCION_PORTAL.ventas_adicionales)
    if (!(await limiteExtras(p.id))) return { error: MENSAJES_RECHAZO.RATE_LIMITED }
    const ctx = await contextoDeAuditoria(p)
    const visitId = texto(fd, 'visitId', 60)
    const idempotencyKey = texto(fd, 'idempotencyKey', 80)
    if (!visitId || !idempotencyKey) return { error: 'Falta la visita o la clave de la venta.' }
    const lineas = leerLineas(fd)
    if ('error' in lineas) return { error: lineas.error }
    const r = await sinEmpresa('Visitas: el proveedor registra una venta adicional', (tx) =>
      registrarVentaAdicionalEnTx(tx, { visitId, operador: { userId: p.id, companyId: p.companyId, supplierId: p.supplierId }, lineas, idempotencyKey }, ctx)
    )
    refrescarPortal(visitId)
    refrescarCliente(visitId)
    return { success: r.repetida ? 'Esta venta ya estaba registrada.' : `Venta ${r.number} registrada.`, id: r.id, data: r }
  } catch (e) {
    return comoError(e, 'registrarVentaAdicional')
  }
}

export type VisitaCerrada = { id: string; number: string; repetida: boolean; ancillaryTotal: string }

export async function cerrarVisitaAction(_prev: EstadoAccion<VisitaCerrada>, fd: FormData): Promise<EstadoAccion<VisitaCerrada>> {
  try {
    const p = await exigirProveedorSupplyV2(FUNCION_PORTAL.escanear)
    const ctx = await contextoDeAuditoria(p)
    const visitId = texto(fd, 'visitId', 60)
    if (!visitId) return { error: 'Falta la visita.' }
    const r = await sinEmpresa('Visitas: el proveedor cierra la visita', (tx) =>
      cerrarVisitaEnTx(tx, { visitId, operador: { userId: p.id, companyId: p.companyId, supplierId: p.supplierId } }, ctx)
    )
    refrescarPortal(visitId)
    refrescarCliente(visitId)
    return { success: r.repetida ? 'La visita ya estaba cerrada.' : `Visita ${r.number} cerrada.`, id: r.id, data: r }
  } catch (e) {
    return comoError(e, 'cerrarVisita')
  }
}

export async function reversarVentaAdicionalAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const p = await exigirProveedorSupplyV2(FUNCION_PORTAL.ventas_adicionales)
    const ctx = await contextoDeAuditoria(p)
    const saleId = texto(fd, 'saleId', 60)
    const motivo = texto(fd, 'motivo', 500)
    if (!saleId) return { error: 'Falta la venta.' }
    if (!motivo) return { error: 'Escribe el motivo de la anulación.' }
    const r = await sinEmpresa('Visitas: el proveedor anula una venta adicional', (tx) =>
      reversarVentaAdicionalEnTx(tx, { saleId, operador: { userId: p.id, companyId: p.companyId, supplierId: p.supplierId }, motivo }, ctx)
    )
    refrescarPortal(texto(fd, 'visitId', 60))
    refrescarCliente(texto(fd, 'visitId', 60) || undefined)
    refrescarSupplyV2('visitas')
    return { success: r.repetida ? 'Esa venta ya estaba anulada.' : 'Venta adicional anulada; si tenía comisión, se reversó en tu cuenta.', id: r.id }
  } catch (e) {
    return comoError(e, 'reversarVentaAdicional')
  }
}

// ── Proveedor: el mini catálogo de extras (§26) ─────────────────────────────

export async function guardarExtraAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const p = await exigirProveedorSupplyV2(FUNCION_PORTAL.configuracion)
    const ctx = await contextoDeAuditoria(p)
    const id = texto(fd, 'id', 60) || null
    const name = texto(fd, 'name', 160)
    const price = texto(fd, 'price', 20)
    // El checkbox no viaja si está sin marcar: solo cuenta cuando el formulario lo traía.
    const activo = fd.has('activoPresente') ? fd.get('activo') === 'on' : true
    const r = await sinEmpresa('Visitas: el proveedor guarda un extra', (tx) => guardarExtraEnTx(tx, { supplierId: p.supplierId, companyId: p.companyId, id, name, price, activo }, ctx))
    revalidatePath(RUTA_PORTAL_CONFIGURACION)
    revalidatePath(RUTA_PORTAL_ESCANER)
    return { success: r.creado ? 'Extra añadido a tu mini catálogo.' : 'Extra actualizado.', id: r.id }
  } catch (e) {
    return comoError(e, 'guardarExtra')
  }
}

// ── Cliente: confirmar o reportar (§33–§34) ─────────────────────────────────

export async function confirmarVisitaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const cliente = await exigirCliente()
    if (!(await limiteCliente(cliente.id))) return { error: MENSAJES_RECHAZO.RATE_LIMITED }
    const ctx = await contextoDeAuditoria(cliente)
    const visitId = texto(fd, 'visitId', 60)
    const total = texto(fd, 'total', 20)
    if (!visitId) return { error: 'Falta la visita.' }
    const r = await sinEmpresa('Visitas: el cliente confirma su consumo', (tx) => confirmarVisitaComoClienteEnTx(tx, { visitId, customerUserId: cliente.id, totalVisto: total || 0 }, ctx))
    refrescarCliente(visitId)
    return { success: r.repetida ? 'Ya habías confirmado esta visita.' : 'Gracias por confirmar.', id: r.id }
  } catch (e) {
    return comoError(e, 'confirmarVisita')
  }
}

export async function disputarVisitaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const cliente = await exigirCliente()
    if (!(await limiteCliente(cliente.id))) return { error: MENSAJES_RECHAZO.RATE_LIMITED }
    const ctx = await contextoDeAuditoria(cliente)
    const visitId = texto(fd, 'visitId', 60)
    const saleId = texto(fd, 'saleId', 60) || null
    const claim = texto(fd, 'claim', 1000)
    const claimedTotal = texto(fd, 'claimedTotal', 20) || null
    if (!visitId) return { error: 'Falta la visita.' }
    const r = await sinEmpresa('Visitas: el cliente reporta un problema', (tx) => disputarVisitaComoClienteEnTx(tx, { visitId, customerUserId: cliente.id, saleId, claim, claimedTotal }, ctx))
    refrescarCliente(visitId)
    refrescarSupplyV2('visitas', `visitas/${visitId}`)
    return { success: r.repetida ? 'Ya tenemos tu reporte; lo estamos revisando.' : 'Recibimos tu reporte. Membego lo revisará con el negocio.', id: r.id }
  } catch (e) {
    return comoError(e, 'disputarVisita')
  }
}

// ── Superadmin: disputas y evidencia externa (§32, §35) ─────────────────────

const RESOLUCIONES: readonly ResolucionDeDisputa[] = ['RESOLVED_MERCHANT', 'RESOLVED_CUSTOMER', 'DISMISSED']

export async function marcarDisputaEnRevisionAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_REDEMPTION_REVERSE')
    const ctx = await contextoDeAuditoria(actor)
    const disputeId = texto(fd, 'disputeId', 60)
    if (!disputeId) return { error: 'Falta la disputa.' }
    await sinEmpresa('Visitas: la plataforma toma una disputa', (tx) => marcarDisputaEnRevisionEnTx(tx, disputeId, ctx))
    refrescarSupplyV2('visitas', `visitas/${texto(fd, 'visitId', 60)}`)
    return { success: 'Disputa en revisión.' }
  } catch (e) {
    return comoError(e, 'marcarDisputaEnRevision')
  }
}

export async function resolverDisputaAction(_prev: EstadoAccion<{ resultado: string; delta: string }>, fd: FormData): Promise<EstadoAccion<{ resultado: string; delta: string }>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_REDEMPTION_REVERSE')
    const ctx = await contextoDeAuditoria(actor)
    const disputeId = texto(fd, 'disputeId', 60)
    const resolucion = texto(fd, 'resolucion', 30) as ResolucionDeDisputa
    const notas = texto(fd, 'notas', 2000)
    const baseReconocida = texto(fd, 'baseReconocida', 20) || null
    if (!disputeId) return { error: 'Falta la disputa.' }
    if (!RESOLUCIONES.includes(resolucion)) return { error: 'Elige cómo se resuelve.' }
    const r = await sinEmpresa('Visitas: la plataforma resuelve una disputa', (tx) => resolverDisputaEnTx(tx, { disputeId, resolucion, notas, baseReconocida }, ctx))
    const visitId = texto(fd, 'visitId', 60)
    refrescarSupplyV2('visitas', `visitas/${visitId}`)
    refrescarCliente(visitId || undefined)
    revalidatePath(RUTA_VISITAS)
    const detalle = r.resultado === 'REVERSO' ? ' Comisión reversada.' : r.resultado === 'AJUSTE' ? ` Comisión ajustada en RD$${r.delta}.` : ''
    return { success: r.repetida ? 'La disputa ya estaba resuelta.' : `Disputa resuelta.${detalle}`, id: r.id, data: { resultado: r.resultado, delta: r.delta } }
  } catch (e) {
    return comoError(e, 'resolverDisputa')
  }
}

export async function verificarPagoDeVentaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_RECONCILE')
    const ctx = await contextoDeAuditoria(actor)
    const saleId = texto(fd, 'saleId', 60)
    const referencia = texto(fd, 'referencia', 120)
    const nivel = texto(fd, 'nivel', 30) === 'FISCALLY_RECONCILED' ? 'FISCALLY_RECONCILED' : 'PAYMENT_VERIFIED'
    if (!saleId) return { error: 'Falta la venta.' }
    if (!referencia) return { error: 'Escribe la referencia externa (comprobante, conciliación).' }
    const r = await sinEmpresa('Visitas: la plataforma registra evidencia externa', (tx) => verificarPagoDeVentaAdicionalEnTx(tx, { saleId, referencia, nivel }, ctx))
    refrescarSupplyV2('visitas', `visitas/${texto(fd, 'visitId', 60)}`)
    return { success: r.repetida ? 'Esa venta ya tenía evidencia externa.' : 'Evidencia externa registrada.', id: r.id }
  } catch (e) {
    return comoError(e, 'verificarPagoDeVenta')
  }
}
