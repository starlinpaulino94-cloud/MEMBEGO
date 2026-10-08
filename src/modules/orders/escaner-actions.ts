'use server'

/**
 * COMMERCE CORE · pedidos — cerrar un pedido con su QR desde el escáner (Fase 3).
 *
 * Es la ÚNICA puerta por la que un pedido pasa a COMPLETED: el cierre exige el
 * QR vigente de un pedido LISTO. Autoriza con los mismos roles que el resto del
 * escáner y exige que el pedido sea de la empresa del empleado (un
 * SUPERADMIN puede cerrar el de cualquiera). La empresa y el actor salen de la
 * sesión y de la base; el navegador solo aporta el token escaneado.
 */

import { revalidatePath } from 'next/cache'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { formSubmitLimiter } from '@/lib/rate-limit'
import { SCANNER_ROLES } from '@/types'
import { InventarioError } from '@/modules/inventory/errores'
import { registrarOperacion } from '@/modules/observabilidad/eventos'
import { PedidoError } from './errores'
import { completarPorQrEnTx, type ContextoPedido } from './service'
import { puedeOperarEnEmpresa } from '@/lib/auth/empresa-de-la-sesion'

export type ResultadoCierre = { ok: true; code: string; nivel: string } | { ok: false; error: string }

export async function completarPedidoPorQr(token: string): Promise<ResultadoCierre> {
  let pedidoDelQr: { companyId: string; pedidoId: string } | null = null
  try {
    const user = await getUser()
    if (!user || !SCANNER_ROLES.includes(user.metadata.role)) return { ok: false, error: 'No tienes permisos para cerrar pedidos.' }
    if (!(await formSubmitLimiter(user.metadata.dbUserId || 'anonymous'))) return { ok: false, error: 'Demasiados intentos. Espera un momento.' }
    const limpio = typeof token === 'string' ? token.trim() : ''
    if (limpio === '' || limpio.length > 200) return { ok: false, error: 'El código QR no es válido.' }

    // La empresa del pedido sale de la base (el token es único), no del navegador.
    const p = await sinEmpresa('escáner: empresa del pedido de un QR', (tx) => tx.membegoOrder.findUnique({ where: { qrToken: limpio }, select: { id: true, companyId: true } }))
    if (!p) return { ok: false, error: 'Ese código QR no corresponde a ningún pedido.' }
    if (!puedeOperarEnEmpresa(user, p.companyId)) {
      return { ok: false, error: 'Este pedido pertenece a otra empresa.' }
    }

    const meta = await getRequestMeta()
    const ctx: ContextoPedido = { actor: 'EMPRESA', actorId: user.metadata.dbUserId ?? null, ...meta }
    pedidoDelQr = { companyId: p.companyId, pedidoId: p.id }
    const r = await conEmpresa(p.companyId, (tx) => completarPorQrEnTx(tx, p.companyId, limpio, ctx))
    registrarOperacion({ dominio: 'pedido', accion: 'pedido_completado', ...pedidoDelQr })
    revalidatePath('/admin/pedidos-membego', 'layout')
    revalidatePath('/cliente/pedidos', 'layout')
    return { ok: true, code: r.code, nivel: r.nivel }
  } catch (e) {
    if (pedidoDelQr) registrarOperacion({ dominio: 'pedido', accion: 'pedido_completado', ...pedidoDelQr, error: e })
    if (e instanceof PedidoError || e instanceof InventarioError) return { ok: false, error: e.message }
    console.error('[pedidos-escaner]', e instanceof Error ? e.message : e)
    return { ok: false, error: 'No se pudo cerrar el pedido. Intenta de nuevo.' }
  }
}
