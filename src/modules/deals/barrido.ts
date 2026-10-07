import 'server-only'

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { cancelarPedidoEnTx } from '@/modules/orders/service'
import { terminarOfertaEnTx } from './service'

/**
 * COMMERCE CORE · ofertas con presupuesto — el barrido diario (Fase 5).
 *
 * Dos cosas, empresa por empresa y cada una en su propia transacción (un fallo no frena a las
 * demás; es idempotente):
 *
 *  1. Los reclamos que VENCIERON sin canjearse: se cancela su pedido (lo cierra el sistema, así
 *     que el reclamo queda EXPIRED), lo que libera el stock apartado, el cupo y lo reservado
 *     del presupuesto — esa cuota vuelve a estar disponible para otra persona.
 *  2. Las ofertas cuya vigencia TERMINÓ pasan a COMPLETED. Los cupones ya reclamados siguen
 *     valiendo hasta su propio vencimiento.
 *
 * El canje NO depende de este barrido: un cupón vencido ya se rechaza al escanearlo
 * (`RECLAMO_VENCIDO`); esto solo limpia y devuelve lo reservado.
 */

export interface ResultadoBarridoDeOfertas {
  reclamosVencidos: number
  ofertasTerminadas: number
  errores: number
}

const POR_PASADA = 200
const SISTEMA = { actor: 'SISTEMA' as const, actorId: null }

export async function barridoDeOfertas(ahora: Date = new Date()): Promise<ResultadoBarridoDeOfertas> {
  const r: ResultadoBarridoDeOfertas = { reclamosVencidos: 0, ofertasTerminadas: 0, errores: 0 }

  const vencidos = await sinEmpresa('barrido de ofertas: reclamos vencidos (recorre empresa por empresa)', (tx) =>
    tx.dealClaim.findMany({
      where: { status: 'CLAIMED', expiresAt: { lte: ahora } },
      select: { orderId: true, companyId: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: POR_PASADA,
    })
  )
  for (const { orderId, companyId } of vencidos) {
    try {
      await conEmpresa(companyId, (tx) => cancelarPedidoEnTx(tx, companyId, orderId, { motivo: 'El cupón de la oferta venció sin canjearse.' }, SISTEMA, ahora))
      r.reclamosVencidos++
    } catch (e) {
      r.errores++
      console.error('[ofertas] vencer reclamo', orderId, e instanceof Error ? e.message : e)
    }
  }

  const terminadas = await sinEmpresa('barrido de ofertas: ofertas cuya vigencia terminó (recorre empresa por empresa)', (tx) =>
    tx.deal.findMany({
      where: { status: { in: ['ACTIVE', 'PAUSED', 'BUDGET_EXHAUSTED'] }, endsAt: { lte: ahora } },
      select: { id: true, companyId: true },
      orderBy: [{ endsAt: 'asc' }, { id: 'asc' }],
      take: POR_PASADA,
    })
  )
  for (const { id, companyId } of terminadas) {
    try {
      const x = await conEmpresa(companyId, (tx) => terminarOfertaEnTx(tx, companyId, id, { actorId: null }, ahora))
      if (x.cambio) r.ofertasTerminadas++
    } catch (e) {
      r.errores++
      console.error('[ofertas] terminar oferta', id, e instanceof Error ? e.message : e)
    }
  }
  return r
}
