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
  /** `true` si se acabó el tiempo con trabajo todavía pendiente (la próxima pasada sigue donde quedó). */
  quedaTrabajo: boolean
}

const POR_LOTE = 200
/** Cuánto trabajar en una pasada. El cron admite 60 s: se deja margen para terminar el lote en curso. */
const PRESUPUESTO_MS = 40_000
const SISTEMA = { actor: 'SISTEMA' as const, actorId: null }

/**
 * Procesa lotes hasta vaciar lo pendiente o agotar el presupuesto de tiempo. Lo que falla se anota y no se reintenta en
 * la misma pasada (si no, un cupón que siempre falla taparía a los demás para siempre). Antes había un tope de 200 por
 * día: con más vencimientos que eso, el exceso seguía reservando presupuesto y la oferta quedaba agotada sin estarlo.
 */
export async function barridoDeOfertas(
  ahora: Date = new Date(),
  opciones: { presupuestoMs?: number; reloj?: () => number; porLote?: number } = {}
): Promise<ResultadoBarridoDeOfertas> {
  const reloj = opciones.reloj ?? (() => Date.now())
  const limite = reloj() + (opciones.presupuestoMs ?? PRESUPUESTO_MS)
  const porLote = opciones.porLote ?? POR_LOTE
  const r: ResultadoBarridoDeOfertas = { reclamosVencidos: 0, ofertasTerminadas: 0, errores: 0, quedaTrabajo: false }

  const fallidosPedidos = new Set<string>()
  for (;;) {
    if (reloj() >= limite) {
      r.quedaTrabajo = true
      break
    }
    const lote = await sinEmpresa('barrido de ofertas: reclamos vencidos (recorre empresa por empresa)', (tx) =>
      tx.dealClaim.findMany({
        where: { status: 'CLAIMED', expiresAt: { lte: ahora }, ...(fallidosPedidos.size > 0 ? { orderId: { notIn: [...fallidosPedidos] } } : {}) },
        select: { orderId: true, companyId: true },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: porLote,
      })
    )
    if (lote.length === 0) break
    for (const { orderId, companyId } of lote) {
      if (reloj() >= limite) break
      try {
        await conEmpresa(companyId, (tx) => cancelarPedidoEnTx(tx, companyId, orderId, { motivo: 'El cupón de la oferta venció sin canjearse.' }, SISTEMA, ahora))
        r.reclamosVencidos++
      } catch (e) {
        r.errores++
        fallidosPedidos.add(orderId)
        console.error('[ofertas] vencer reclamo', orderId, e instanceof Error ? e.message : e)
      }
    }
  }

  const fallidasOfertas = new Set<string>()
  for (;;) {
    if (reloj() >= limite) {
      r.quedaTrabajo = true
      break
    }
    const lote = await sinEmpresa('barrido de ofertas: ofertas cuya vigencia terminó (recorre empresa por empresa)', (tx) =>
      tx.deal.findMany({
        where: { status: { in: ['ACTIVE', 'PAUSED', 'BUDGET_EXHAUSTED'] }, endsAt: { lte: ahora }, ...(fallidasOfertas.size > 0 ? { id: { notIn: [...fallidasOfertas] } } : {}) },
        select: { id: true, companyId: true },
        orderBy: [{ endsAt: 'asc' }, { id: 'asc' }],
        take: porLote,
      })
    )
    if (lote.length === 0) break
    for (const { id, companyId } of lote) {
      if (reloj() >= limite) break
      try {
        const x = await conEmpresa(companyId, (tx) => terminarOfertaEnTx(tx, companyId, id, { actorId: null }, ahora))
        if (x.cambio) r.ofertasTerminadas++
        else fallidasOfertas.add(id) // ya estaba terminada: que no vuelva a salir en la misma pasada
      } catch (e) {
        r.errores++
        fallidasOfertas.add(id)
        console.error('[ofertas] terminar oferta', id, e instanceof Error ? e.message : e)
      }
    }
  }
  return r
}
