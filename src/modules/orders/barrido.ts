import { MOTIVO_SIN_RESPUESTA } from './motivos'
import 'server-only'

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { cancelarPedidoEnTx, type ContextoPedido } from './service'
import { avisarPasoDelPedido } from './avisos'

/**
 * COMMERCE CORE · pedidos — BARRIDO del cron (Fase 3).
 *
 * Un pedido que la empresa no atiende no puede quedarse esperando para siempre:
 * el cliente cree que lo pidió y el stock apartado se quedaría en el aire.
 * Pasados `DIAS_SIN_RESPUESTA` días sin que la empresa lo acepte, el sistema lo
 * CANCELA con un motivo que el cliente ve, y eso libera lo apartado.
 *
 * Solo toca pedidos en espera de la empresa (`AWAITING_MERCHANT`; `CREATED` no
 * dura ni una transacción). Uno aceptado, listo o cerrado no se cancela solo.
 *
 * Idempotente: cancelar un pedido ya cancelado no hace nada. Cada pedido va en
 * su propia transacción: uno que falle no frena a los demás.
 */

/** Cuánto espera un pedido a que la empresa lo acepte antes de cancelarse solo. */
export const DIAS_SIN_RESPUESTA = 7

const MOTIVO = MOTIVO_SIN_RESPUESTA
const SISTEMA: ContextoPedido = { actor: 'SISTEMA', actorId: null }

/** Tope de pedidos por pasada: lo que sobre lo recoge la siguiente. */
const MAX_PEDIDOS = 200

export interface ResultadoBarridoPedidos {
  cancelados: number
  errores: number
}

export async function barridoPedidos(ahora: Date = new Date()): Promise<ResultadoBarridoPedidos> {
  const limite = new Date(ahora.getTime() - DIAS_SIN_RESPUESTA * 86_400_000)
  const filas = await sinEmpresa('barrido de pedidos Membego sin atender (recorre empresa por empresa)', (tx) =>
    tx.membegoOrder.findMany({
      where: { status: 'AWAITING_MERCHANT', createdAt: { lte: limite } },
      select: { id: true, companyId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_PEDIDOS,
    })
  )
  let cancelados = 0
  let errores = 0
  for (const { id, companyId } of filas) {
    try {
      const r = await conEmpresa(companyId, (tx) => cancelarPedidoEnTx(tx, companyId, id, { motivo: MOTIVO }, SISTEMA, ahora))
      if (!r.repetido) {
        cancelados++
        // El cliente y la empresa se enteran de que venció (best-effort, fuera de la transacción).
        await avisarPasoDelPedido(companyId, id, 'CANCELADO', 'SISTEMA')
      }
    } catch (e) {
      errores++
      console.error('[pedidos:barrido]', id, e instanceof Error ? e.message : e)
    }
  }
  return { cancelados, errores }
}
