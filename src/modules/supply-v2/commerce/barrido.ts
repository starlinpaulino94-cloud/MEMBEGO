import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import type { ContextoAuditoria } from '../core/auditoria'
import { cerrarOfertaEnTx } from '../offers/service'
import { expirarOrdenEnTx } from './checkout'
import { derechosPorVencerEnTx, expirarDerechoEnTx, expirarVouchersEnTx } from '../redemption/service'
import { expirarLoteEnTx, lotesPorVencerEnTx } from '../pool/vencimientos'
import { proyectarVentasSinEventoEnTx } from '../economics/service'
import { expirarBeneficiosEnTx } from '../benefits/service'
import { barridoCampanasEnTx } from '../campaigns/service'
import { expirarCuponesEnTx } from '../campaigns/coupons'
import { activarProgramadasEnTx, vencerMembresiasEnTx } from '../loyalty/memberships'
import { liberarPendientesEnTx, vencerPuntosEnTx } from '../loyalty/points'
import { conciliarEntregasEnTx } from '../loyalty/rewards'
import { barridoReferidosEnTx } from '../loyalty/referrals'

/**
 * MEMBEGO SUPPLY · BARRIDO del cron (§25, §37, §39, §64).
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
  /** Slice 6 (§27): beneficios y asignaciones cuya vigencia pasó. */
  beneficiosVencidos: number
  asignacionesVencidas: number
  /** Slice 7 (§7): campañas programadas que ya empiezan, vencidas que se cierran y cupones caducados. */
  campanasActivadas: number
  campanasTerminadas: number
  cuponesVencidos: number
  /** Slice 8 (§12–§13): períodos comprados por adelantado que ya empiezan y membresías cuyo período acabó. */
  membresiasActivadas: number
  membresiasVencidas: number
  /** Slice 8 (§28–§29): puntos que maduran y lotes que caducan. */
  puntosLiberados: number
  puntosVencidos: number
  /** Slice 8 (§32, §35): reclamaciones cuyo beneficio ya se usó, y por tanto entregadas. */
  recompensasEntregadas: number
  /** Slice 8 (§21): invitaciones cuyo período de espera ya pasó. */
  referidosRecompensados: number
}

export async function barridoSupplyV2(ahora = new Date(), limite = 200): Promise<ResultadoBarrido> {
  const r: ResultadoBarrido = { ordenesExpiradas: 0, ofertasActivadas: 0, ofertasFinalizadas: 0, unidadesLiberadas: 0, vouchersVencidos: 0, derechosVencidos: 0, derechosConError: 0, lotesVencidos: 0, unidadesVencidasSinVender: 0, ventasProyectadas: 0, beneficiosVencidos: 0, asignacionesVencidas: 0, campanasActivadas: 0, campanasTerminadas: 0, cuponesVencidos: 0, membresiasActivadas: 0, membresiasVencidas: 0, puntosLiberados: 0, puntosVencidos: 0, recompensasEntregadas: 0, referidosRecompensados: 0 }

  const vencidas = await sinEmpresa('Supply cron: checkouts con la reserva caducada', (tx) =>
    tx.supplyV2CustomerOrder.findMany({ where: { status: 'PENDING', expiresAt: { lte: ahora } }, select: { id: true }, take: limite, orderBy: { expiresAt: 'asc' } })
  )
  for (const o of vencidas) {
    const hecho = await sinEmpresa('Supply cron: expirar un checkout', (tx) => expirarOrdenEnTx(tx, o.id, CTX, ahora))
    if (hecho) r.ordenesExpiradas++
  }

  const programadas = await sinEmpresa('Supply cron: ofertas programadas que ya empezaron', (tx) =>
    tx.supplyV2Offer.findMany({ where: { status: 'SCHEDULED', startsAt: { lte: ahora }, OR: [{ endsAt: null }, { endsAt: { gt: ahora } }] }, select: { id: true }, take: limite })
  )
  for (const o of programadas) {
    const n = await sinEmpresa('Supply cron: activar oferta programada', (tx) =>
      tx.supplyV2Offer.updateMany({ where: { id: o.id, status: 'SCHEDULED' }, data: { status: 'ACTIVE' } })
    )
    r.ofertasActivadas += n.count
  }

  const terminadas = await sinEmpresa('Supply cron: ofertas cuya vigencia pasó', (tx) =>
    tx.supplyV2Offer.findMany({ where: { status: { in: ['SCHEDULED', 'ACTIVE', 'PAUSED', 'SOLD_OUT'] }, endsAt: { lte: ahora } }, select: { id: true }, take: limite })
  )
  for (const o of terminadas) {
    const res = await sinEmpresa('Supply cron: finalizar oferta vencida', (tx) => cerrarOfertaEnTx(tx, o.id, 'ENDED', 'La vigencia de la oferta terminó.', CTX))
    r.ofertasFinalizadas++
    r.unidadesLiberadas += res.liberadas
  }

  // Slice 3: derechos y vouchers vencidos. Las sesiones QR expiradas se quedan como historial (§58–§59).
  // Slice 4: cada derecho en su propia transacción; uno inconsistente (su unidad
  // no está ISSUED en el ledger) se registra y NO bloquea a los demás.
  for (const id of await sinEmpresa('Supply cron: derechos por vencer', (tx) => derechosPorVencerEnTx(tx, ahora, limite))) {
    try {
      if (await sinEmpresa('Supply cron: vencer un derecho', (tx) => expirarDerechoEnTx(tx, id, CTX, ahora))) r.derechosVencidos++
    } catch (e) {
      r.derechosConError++
      console.error(`[supply-v2:cron] no se pudo vencer el derecho ${id}:`, e instanceof Error ? e.message : e)
    }
  }
  r.vouchersVencidos = await sinEmpresa('Supply cron: vouchers vencidos', (tx) => expirarVouchersEnTx(tx, CTX, ahora, limite))

  // Slice 4: lotes vencidos (cada lote en su transacción; RESERVED/ISSUED no se tocan) y ventas sin evento.
  const lotes = await sinEmpresa('Supply cron: lotes vencidos con unidades sin vender', (tx) => lotesPorVencerEnTx(tx, ahora, limite))
  for (const lotId of lotes) {
    const v = await sinEmpresa('Supply cron: expirar un lote', (tx) => expirarLoteEnTx(tx, lotId, CTX, ahora))
    if (v) {
      r.lotesVencidos++
      r.unidadesVencidasSinVender += v.cerradasDisponibles + v.cerradasAsignadas
    }
  }
  r.ventasProyectadas = await sinEmpresa('Supply cron: proyectar ventas sin evento económico', (tx) => proyectarVentasSinEventoEnTx(tx, CTX, limite))

  // Slice 6 (§27): el beneficio vencido deja de valer y sus asignaciones con él.
  // Las RESERVAS vencen con su orden (`expirarOrdenEnTx`, arriba): el presupuesto
  // vuelve por el mismo camino que lo apartó.
  const ben = await sinEmpresa('Supply cron: beneficios y asignaciones vencidos', (tx) => expirarBeneficiosEnTx(tx, CTX, ahora, limite))
  r.beneficiosVencidos = ben.beneficios
  r.asignacionesVencidas = ben.asignaciones

  // Slice 7 (§7): el cron MANTIENE estados —activa las programadas que ya
  // empiezan y cierra las vencidas— pero NO es la protección: cada checkout
  // comprueba la vigencia y el horario en el servidor, así que una pasada
  // tarde no deja valer una promoción terminada.
  const camp = await sinEmpresa('Supply cron: campañas programadas y vencidas', (tx) => barridoCampanasEnTx(tx, CTX, ahora, limite))
  r.campanasActivadas = camp.activadas
  r.campanasTerminadas = camp.terminadas
  r.cuponesVencidos = await sinEmpresa('Supply cron: cupones vencidos', (tx) => expirarCuponesEnTx(tx, ahora, limite))

  // Slice 8 (§12–§13): SE VENCE PRIMERO Y SE ACTIVA DESPUÉS, en este orden y no
  // al revés. Solo puede haber UNA membresía ACTIVE por plan y persona —lo
  // sostiene el índice único parcial `supply_v2_membresia_activa_por_plan`—,
  // así que activar el período nuevo antes de cerrar el que acaba choca contra
  // la base. Y no se pierde ningún día: el período nuevo arranca exactamente
  // cuando termina el anterior, de modo que cuando uno vence el otro ya toca.
  r.membresiasVencidas = await sinEmpresa('Supply cron: vencer membresías', (tx) => vencerMembresiasEnTx(tx, CTX, ahora, limite))
  r.membresiasActivadas = await sinEmpresa('Supply cron: activar membresías programadas', (tx) => activarProgramadasEnTx(tx, CTX, ahora, limite))

  // Slice 8 (§28–§29): primero maduran los pendientes y después vencen los
  // lotes caducados. En ese orden: unos puntos que maduran el mismo día que
  // caducan existen de verdad ese día, y el cliente tiene que poder gastarlos.
  r.puntosLiberados = await sinEmpresa('Supply cron: puntos pendientes que maduran', (tx) => liberarPendientesEnTx(tx, CTX, ahora, limite))
  r.puntosVencidos = await sinEmpresa('Supply cron: lotes de puntos vencidos', (tx) => vencerPuntosEnTx(tx, CTX, ahora, limite))

  // Slice 8 (§32, §35): una recompensa está ENTREGADA cuando su beneficio se
  // usó de verdad —por el QR y el escáner de siempre—, y es entonces cuando
  // se reconoce su costo. Aquí se lee el Slice 6; no hay segundo sistema de
  // redención al que preguntar.
  r.recompensasEntregadas = await sinEmpresa('Supply cron: recompensas entregadas', (tx) => conciliarEntregasEnTx(tx, CTX, ahora, limite))

  // Slice 8 (§21): las invitaciones con período de espera se cobran cuando el
  // plazo pasa. Antes de pagar se vuelve a mirar la compra: una cancelación
  // que llegue dentro del plazo deja la invitación sin recompensa, que es
  // justo para lo que sirve el plazo.
  r.referidosRecompensados = await sinEmpresa('Supply cron: recompensas de invitaciones', (tx) => barridoReferidosEnTx(tx, CTX, ahora, limite))
  return r
}
