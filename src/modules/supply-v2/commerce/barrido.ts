import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import type { ContextoAuditoria } from '../core/auditoria'
import { cerrarOfertaEnTx } from '../offers/service'
import { expirarOrdenEnTx } from './checkout'
import { derechosPorVencerEnTx, expirarDerechoEnTx, expirarVouchersEnTx } from '../redemption/service'
import { expirarLoteEnTx, lotesPorVencerEnTx } from '../pool/vencimientos'
import { proyectarVentasSinEventoEnTx } from '../economics/service'

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
  /** Slice 3 (§58) */
  vouchersVencidos: number
  derechosVencidos: number
  /** Derechos vencidos que no se pudieron cerrar (inconsistencia registrada en el log). */
  derechosConError: number
  /** Slice 4 (§48–§49) */
  lotesVencidos: number
  unidadesVencidasSinVender: number
  /** Slice 4 (§24): ventas PAID anteriores sin evento económico, proyectadas. */
  ventasProyectadas: number
}

export async function barridoSupplyV2(ahora = new Date(), limite = 200): Promise<ResultadoBarrido> {
  const r: ResultadoBarrido = { ordenesExpiradas: 0, ofertasActivadas: 0, ofertasFinalizadas: 0, unidadesLiberadas: 0, vouchersVencidos: 0, derechosVencidos: 0, derechosConError: 0, lotesVencidos: 0, unidadesVencidasSinVender: 0, ventasProyectadas: 0 }

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

  // Slice 3: derechos y vouchers vencidos. Las sesiones QR expiradas se quedan como historial (§58–§59).
  // Slice 4: cada derecho en su propia transacción; uno inconsistente (su unidad
  // no está ISSUED en el ledger) se registra y NO bloquea a los demás.
  for (const id of await sinEmpresa('Supply 2.0 cron: derechos por vencer', (tx) => derechosPorVencerEnTx(tx, ahora, limite))) {
    try {
      if (await sinEmpresa('Supply 2.0 cron: vencer un derecho', (tx) => expirarDerechoEnTx(tx, id, CTX, ahora))) r.derechosVencidos++
    } catch (e) {
      r.derechosConError++
      console.error(`[supply-v2:cron] no se pudo vencer el derecho ${id}:`, e instanceof Error ? e.message : e)
    }
  }
  r.vouchersVencidos = await sinEmpresa('Supply 2.0 cron: vouchers vencidos', (tx) => expirarVouchersEnTx(tx, CTX, ahora, limite))

  // Slice 4: lotes vencidos (cada lote en su transacción; RESERVED/ISSUED no se tocan) y ventas sin evento.
  const lotes = await sinEmpresa('Supply 2.0 cron: lotes vencidos con unidades sin vender', (tx) => lotesPorVencerEnTx(tx, ahora, limite))
  for (const lotId of lotes) {
    const v = await sinEmpresa('Supply 2.0 cron: expirar un lote', (tx) => expirarLoteEnTx(tx, lotId, CTX, ahora))
    if (v) {
      r.lotesVencidos++
      r.unidadesVencidasSinVender += v.cerradasDisponibles + v.cerradasAsignadas
    }
  }
  r.ventasProyectadas = await sinEmpresa('Supply 2.0 cron: proyectar ventas sin evento económico', (tx) => proyectarVentasSinEventoEnTx(tx, CTX, limite))
  return r
}
