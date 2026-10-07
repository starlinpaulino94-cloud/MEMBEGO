'use server'

/**
 * COMMERCE CORE · pedidos Membego — acciones del panel de la empresa (Fase 3).
 *
 * Todas detrás de `requireSection('pedidos-membego', <función>)`: la capacidad
 * PEDIDOS_MEMBEGO y los permisos por empleado gobiernan cada mutación. La
 * empresa sale SIEMPRE de la sesión (`resolveCompanyId`), nunca de lo que mande
 * el navegador, y todo corre en `conEmpresa`.
 *
 * Aquí solo están las operaciones que hace la EMPRESA sobre un pedido que ya
 * existe: aceptar, ajustar el monto, marcar listo, registrar el pago, cancelar y
 * reembolsar. Crear el pedido y confirmar el monto son del cliente
 * (`cliente-actions.ts`); cerrarlo con el QR es del escáner.
 *
 * Devuelven un resultado, no lanzan: el mensaje de un `PedidoError` o de un
 * `InventarioError` se enseña tal cual; cualquier otro error se traduce a uno
 * genérico para no filtrar detalles de la base.
 */

import { revalidatePath } from 'next/cache'
import type { MembegoPaymentMethod } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRequestMeta } from '@/lib/server-utils'
import type { SessionUser } from '@/types'
import { InventarioError } from '@/modules/inventory/errores'
import { PedidoError } from './errores'
import {
  aceptarPedidoEnTx,
  ajustarMontoEnTx,
  cancelarPedidoEnTx,
  marcarListoEnTx,
  reembolsarPedidoEnTx,
  registrarPagoEnTx,
  type ContextoPedido,
} from './service'

export type ResultadoPedido<T = unknown> = ({ ok: true } & T) | { ok: false; error: string }

const RUTA = '/admin/pedidos-membego'

const METODOS: readonly MembegoPaymentMethod[] = ['CASH', 'CARD', 'TRANSFER', 'MEMBEGO_CHECKOUT', 'OTHER']

/** Tras cualquier cambio, la lista y el detalle (`layout` cubre las dos). */
function refrescar() {
  revalidatePath(RUTA, 'layout')
}

async function contexto(funcion: 'gestionar' | 'cancelar' | 'reembolsar'): Promise<{ user: SessionUser; companyId: string; ctx: ContextoPedido } | { error: string }> {
  const user = await requireSection('pedidos-membego', funcion)
  if (!user) return { error: 'No autorizado.' }
  const companyId = await resolveCompanyId(user)
  if (!companyId) return { error: 'Selecciona una empresa activa.' }
  const meta = await getRequestMeta()
  return { user, companyId, ctx: { actor: 'EMPRESA', actorId: user.metadata.dbUserId ?? null, ...meta } }
}

function aError(e: unknown): { ok: false; error: string } {
  if (e instanceof PedidoError || e instanceof InventarioError) return { ok: false, error: e.message }
  console.error('[pedidos-membego]', e instanceof Error ? e.message : e)
  return { ok: false, error: 'No se pudo completar la operación. Intenta de nuevo.' }
}

const texto = (v: unknown) => (typeof v === 'string' ? v : '')
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** La empresa acepta el pedido y empieza a atenderlo. */
export async function aceptarPedido(pedidoId: string): Promise<ResultadoPedido<{ repetido: boolean }>> {
  const c = await contexto('gestionar')
  if ('error' in c) return { ok: false, error: c.error }
  try {
    const r = await conEmpresa(c.companyId, (tx) => aceptarPedidoEnTx(tx, c.companyId, texto(pedidoId), c.ctx))
    refrescar()
    return { ok: true, repetido: r.repetido }
  } catch (e) {
    return aError(e)
  }
}

/** Fija el ajuste del monto (+ recargo, − rebaja) con su motivo; el cliente vuelve a confirmar. */
export async function ajustarMontoPedido(entrada: { pedidoId: string; ajuste: number | string; motivo: string }): Promise<ResultadoPedido<{ total: string; repetido: boolean }>> {
  const c = await contexto('gestionar')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) =>
      ajustarMontoEnTx(tx, c.companyId, texto(entrada.pedidoId), { ajuste: entrada.ajuste, motivo: texto(entrada.motivo) }, c.ctx)
    )
    refrescar()
    return { ok: true, total: r.total, repetido: r.repetido }
  } catch (e) {
    return aError(e)
  }
}

/** Marca el pedido listo: se emite el QR con el que el cliente lo recoge. */
export async function marcarPedidoListo(pedidoId: string): Promise<ResultadoPedido<{ repetido: boolean }>> {
  const c = await contexto('gestionar')
  if ('error' in c) return { ok: false, error: c.error }
  try {
    const r = await conEmpresa(c.companyId, (tx) => marcarListoEnTx(tx, c.companyId, texto(pedidoId), c.ctx))
    refrescar()
    return { ok: true, repetido: r.repetido }
  } catch (e) {
    return aError(e)
  }
}

/** Deja constancia de un pago hecho fuera de la plataforma. */
export async function registrarPagoPedido(entrada: {
  pedidoId: string
  metodo: string
  monto: number | string
  referencia?: string | null
  notas?: string | null
}): Promise<ResultadoPedido> {
  const c = await contexto('gestionar')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  const metodo = METODOS.find((m) => m === entrada.metodo)
  if (!metodo) return { ok: false, error: 'Elige un método de pago válido.' }
  try {
    await conEmpresa(c.companyId, (tx) =>
      registrarPagoEnTx(tx, c.companyId, texto(entrada.pedidoId), { method: metodo, amount: entrada.monto, reference: entrada.referencia ?? null, notes: entrada.notas ?? null }, c.ctx)
    )
    refrescar()
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}

/** La empresa cancela el pedido (hasta que se cierre) y libera lo apartado. */
export async function cancelarPedidoComoEmpresa(entrada: { pedidoId: string; motivo: string }): Promise<ResultadoPedido<{ repetido: boolean }>> {
  const c = await contexto('cancelar')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) => cancelarPedidoEnTx(tx, c.companyId, texto(entrada.pedidoId), { motivo: texto(entrada.motivo) }, c.ctx))
    refrescar()
    return { ok: true, repetido: r.repetido }
  } catch (e) {
    return aError(e)
  }
}

/** Reembolsa un pedido completado (deja constancia; el pago fue externo). */
export async function reembolsarPedido(entrada: { pedidoId: string; motivo: string; devolverAlInventario?: boolean }): Promise<ResultadoPedido<{ repetido: boolean }>> {
  const c = await contexto('reembolsar')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) =>
      reembolsarPedidoEnTx(tx, c.companyId, texto(entrada.pedidoId), { motivo: texto(entrada.motivo), devolverAlInventario: entrada.devolverAlInventario === true }, c.ctx)
    )
    refrescar()
    return { ok: true, repetido: r.repetido }
  } catch (e) {
    return aError(e)
  }
}
