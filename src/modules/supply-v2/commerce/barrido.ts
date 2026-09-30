import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import type { ContextoAuditoria } from '../core/auditoria'
import { cerrarOfertaEnTx } from '../offers/service'
import { expirarOrdenEnTx } from './checkout'

/**
 * MEMBEGO SUPPLY 2.0 · BARRIDO del cron (§25, §37, §39, §64).
 *
 * Tres trabajos, idempotentes: expirar checkouts sin pago cuya reserva
 * caducó, activar ofertas programadas que ya empezaron y finalizar ofertas
 * vencidas (liberando lo no usado). Cada elemento va en su propia
 * transacción: un fallo en uno no deshace los demás, y una segunda pasada no
 * encuentra nada que repetir porque cada paso filtra por estado.
 */

const CTX: ContextoAuditoria = { actorId: null, userAgent: 'cron:supply-v2' }

export interface ResultadoBarrido {
  ordenesExpiradas: number
  ofertasActivadas: number
  ofertasFinalizadas: number
  unidadesLiberadas: number
}

export async function barridoSupplyV2(ahora = new Date(), limite = 200): Promise<ResultadoBarrido> {
  const r: ResultadoBarrido = { ordenesExpiradas: 0, ofertasActivadas: 0, ofertasFinalizadas: 0, unidadesLiberadas: 0 }

  const vencidas = await sinEmpresa('Supply 2.0 cron: checkouts con la reserva caducada', (tx) =>
    tx.supplyV2CustomerOrder.findMany({ where: { status: 'PENDING', expiresAt: { lte: ahora } }, select: { id: true }, take: limite, orderBy: { expiresAt: 'asc' } })
  )
  for (const o of vencidas) {
    const hecho = await sinEmpresa('Supply 2.0 cron: expirar un checkout', (tx) => expirarOrdenEnTx(tx, o.id, CTX, ahora))
    if (hecho) r.ordenesExpiradas++
  }

  const programadas = await sinEmpresa('Supply 2.0 cron: ofertas programadas que ya empezaron', (tx) =>
    tx.supplyV2Offer.findMany({ where: { status: 'SCHEDULED', startsAt: { lte: ahora }, OR: [{ endsAt: null }, { endsAt: { gt: ahora } }] }, select: { id: true }, take: limite })
  )
  for (const o of programadas) {
    const n = await sinEmpresa('Supply 2.0 cron: activar oferta programada', (tx) =>
      tx.supplyV2Offer.updateMany({ where: { id: o.id, status: 'SCHEDULED' }, data: { status: 'ACTIVE' } })
    )
    r.ofertasActivadas += n.count
  }

  const terminadas = await sinEmpresa('Supply 2.0 cron: ofertas cuya vigencia pasó', (tx) =>
    tx.supplyV2Offer.findMany({ where: { status: { in: ['SCHEDULED', 'ACTIVE', 'PAUSED', 'SOLD_OUT'] }, endsAt: { lte: ahora } }, select: { id: true }, take: limite })
  )
  for (const o of terminadas) {
    const res = await sinEmpresa('Supply 2.0 cron: finalizar oferta vencida', (tx) => cerrarOfertaEnTx(tx, o.id, 'ENDED', 'La vigencia de la oferta terminó.', CTX))
    r.ofertasFinalizadas++
    r.unidadesLiberadas += res.liberadas
  }
  return r
}
