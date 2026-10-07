import { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { decimal } from '../core/dinero'
import { fallo } from '../core/errores'
import { exigirTransicion } from '../core/estados'
import { siguienteNumero } from '../core/numeracion'
import { esAutoaprobacion, MOTIVO_AUTOAPROBACION } from '../core/segregacion'
import { asignarBeneficioEnTx } from '../benefits/service'
import {
  cabeEnElPrograma,
  economiaDelPrograma,
  estadoRecompensaSegunUsos,
  MENSAJES_NO_RECLAMABLE,
  motivoNoReclamable,
  reversaDevuelvePuntos,
  TRANSICIONES_RECLAMACION,
  TRANSICIONES_RECOMPENSA,
  validarRecompensa,
  type ClienteParaReclamar,
  type CostoDeRecompensa,
  type DatosRecompensa,
  type RecompensaParaReclamar,
} from './domain'
import { membresiasVivasEnTx } from './memberships'
import {
  consumirReservaDePuntosEnTx,
  cuentaDePuntosEnTx,
  liberarReservaDePuntosEnTx,
  reservarPuntosEnTx,
} from './points'
import { bloquearPrograma, eventoDePrograma } from './programs'

/**
 * MEMBEGO SUPPLY · SLICE 8 · RECOMPENSAS (§30–§34).
 *
 * CÓMO SE ENTREGA UNA RECOMPENSA, Y POR QUÉ NO HAY OTRO SISTEMA DE REDENCIÓN
 *
 * Reclamar una recompensa NO entrega nada por sí mismo: lo que hace es
 * ASIGNARLE AL CLIENTE UN BENEFICIO DEL SLICE 6. A partir de ahí el camino es
 * el de siempre —el cliente lo usa en la oferta elegible, el checkout lo
 * aplica, nace el derecho, se abre el QR y el proveedor escanea—. Una
 * recompensa que regala un producto apunta a la oferta con la que se entrega
 * Y al beneficio que la paga; cuando ese beneficio se consume, la reclamación
 * pasa a ENTREGADA y es ENTONCES cuando se reconoce el costo (§35).
 *
 * Así no hay un segundo motor de descuentos, ni de redenciones, ni lotes
 * fabricados para que una recompensa parezca un producto.
 *
 * Orden de candados: PROGRAMA → RECOMPENSA → CUENTA DE PUNTOS.
 */

async function bloquearRecompensa(tx: Tx, rewardId: string) {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_rewards" WHERE "id" = ${rewardId} FOR UPDATE`
  const r = await tx.supplyV2Reward.findUnique({
    where: { id: rewardId },
    include: { program: { select: { id: true, status: true, startsAt: true, endsAt: true, currency: true, supplierId: true, supplier: { select: { companyId: true } } } } },
  })
  if (!r) fallo('RECOMPENSA_NO_ENCONTRADA', 'Esa recompensa no existe.')
  return r
}

// ── Catálogo (§30) ─────────────────────────────────────────────────────────

export async function crearRecompensaEnTx(tx: Tx, programId: string, d: DatosRecompensa, ctx: ContextoAuditoria): Promise<{ id: string; code: string }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Una recompensa necesita quién la crea.')
  const error = validarRecompensa(d)
  if (error) fallo('RECOMPENSA_INVALIDA', error)

  const p = await bloquearPrograma(tx, programId)
  if (['COMPLETED', 'CANCELLED'].includes(p.status)) fallo('PROGRAMA_CERRADO', 'Un programa cerrado no admite recompensas nuevas.')
  if (!p.modalities.includes('REWARDS')) fallo('MODALIDAD_NO_HABILITADA', 'Este programa no tiene habilitadas las recompensas.')

  // El techo del programa manda sobre la suma de los techos de sus
  // recompensas: se comprueba ANTES de crearla (§35).
  const economia = await economiaDelProgramaEnTx(tx, programId)
  const noCabe = cabeEnElPrograma(economia, d.budgetTotal ?? null)
  if (noCabe) fallo('PRESUPUESTO_EXCEDIDO', noCabe)

  if (d.benefitId) {
    const b = await tx.supplyV2Benefit.findUnique({ where: { id: d.benefitId }, select: { id: true, status: true, currency: true, requiresAssignment: true } })
    if (!b) fallo('BENEFICIO_NO_ENCONTRADO', 'Ese beneficio no existe.')
    if (['CANCELLED', 'EXPIRED'].includes(b.status)) fallo('BENEFICIO_CERRADO', 'Ese beneficio ya no está disponible.')
    if (b.currency !== p.currency) fallo('MONEDA_DISTINTA', 'Ese beneficio es de otra moneda.')
    if (!b.requiresAssignment) fallo('BENEFICIO_ABIERTO', 'El beneficio de una recompensa tiene que ser de los que se asignan: si no, lo tendría todo el mundo sin canjear nada.')
  }
  if (d.offerId) {
    const o = await tx.supplyV2Offer.findUnique({ where: { id: d.offerId }, select: { id: true, status: true } })
    if (!o) fallo('OFERTA_NO_ENCONTRADA', 'Esa oferta no existe.')
    if (['ENDED', 'CANCELLED'].includes(o.status)) fallo('OFERTA_CERRADA', 'Esa oferta ya terminó.')
  }

  const code = await siguienteNumero(
    tx,
    'MBG-RW',
    async (prefijo) => {
      const u = await tx.supplyV2Reward.findFirst({ where: { code: { startsWith: prefijo } }, orderBy: { code: 'desc' }, select: { code: true } })
      return u?.code ?? null
    },
    d.startsAt
  )

  const r = await tx.supplyV2Reward.create({
    data: {
      code,
      programId,
      name: d.name.trim(),
      kind: d.kind,
      pointsCost: d.pointsCost ?? 0,
      benefitId: d.benefitId ?? null,
      offerId: d.offerId ?? null,
      funding: p.funding,
      unitCost: d.unitCost != null && d.unitCost !== '' ? decimal(d.unitCost) : null,
      budgetTotal: d.budgetTotal != null && d.budgetTotal !== '' ? decimal(d.budgetTotal) : null,
      maxClaims: d.maxClaims ?? null,
      maxPerCustomer: d.maxPerCustomer ?? 1,
      requiresMembership: d.requiresMembership ?? false,
      requiredPlanId: d.requiredPlanId ?? null,
      startsAt: d.startsAt,
      endsAt: d.endsAt ?? null,
      status: 'DRAFT',
      createdById: ctx.actorId,
    },
    select: { id: true, code: true },
  })
  await eventoDePrograma(tx, programId, 'REWARD_CREATED', { code, name: d.name.trim(), kind: d.kind, pointsCost: d.pointsCost ?? 0 }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_REWARD_CREATED', 'SupplyV2Reward', r.id, { code, kind: d.kind, pointsCost: d.pointsCost ?? 0 }, p.supplier?.companyId ?? null)
  return r
}

/** Publicar una recompensa la pone a repartir dinero: lo mira otra persona. */
export async function aprobarRecompensaEnTx(tx: Tx, rewardId: string, ctx: ContextoAuditoria): Promise<{ id: string; repetido: boolean }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Aprobar una recompensa necesita quién la aprueba.')
  const r = await bloquearRecompensa(tx, rewardId)
  if (r.status === 'ACTIVE') return { id: r.id, repetido: true }
  exigirTransicion(TRANSICIONES_RECOMPENSA, r.status, 'ACTIVE', 'Recompensa')
  if (r.program.status !== 'ACTIVE') fallo('PROGRAMA_NO_ACTIVO', 'El programa tiene que estar activo para publicar una recompensa.')

  const autoaprobada = esAutoaprobacion(r.createdById, ctx.actorId)

  await tx.supplyV2Reward.update({ where: { id: r.id }, data: { status: 'ACTIVE', approvedById: ctx.actorId, approvedAt: new Date() } })
  const detalle = { code: r.code, autoaprobada, motivo: autoaprobada ? MOTIVO_AUTOAPROBACION : null }
  await eventoDePrograma(tx, r.programId, 'REWARD_PUBLISHED', detalle, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_REWARD_APPROVED', 'SupplyV2Reward', r.id, detalle, r.program.supplier?.companyId ?? null)
  return { id: r.id, repetido: false }
}

export async function pausarRecompensaEnTx(tx: Tx, rewardId: string, ctx: ContextoAuditoria): Promise<{ id: string }> {
  const r = await bloquearRecompensa(tx, rewardId)
  exigirTransicion(TRANSICIONES_RECOMPENSA, r.status, 'PAUSED', 'Recompensa')
  await tx.supplyV2Reward.update({ where: { id: r.id }, data: { status: 'PAUSED' } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_REWARD_APPROVED', 'SupplyV2Reward', r.id, { code: r.code, pausada: true }, r.program.supplier?.companyId ?? null)
  return { id: r.id }
}

// ── Reclamación (§31) ──────────────────────────────────────────────────────

export interface ReclamacionHecha {
  id: string
  code: string
  status: string
  puntosConsumidos: number
  customerBenefitId: string | null
  repetida: boolean
}

/**
 * EL RECORRIDO DEL §31, en UNA transacción:
 *
 *   cliente tiene puntos → elige recompensa → EL SERVIDOR verifica
 *   elegibilidad → reserva puntos → crea el beneficio → confirma
 *
 * Si no se puede crear el beneficio, los puntos reservados VUELVEN: la
 * transacción entera se deshace, así que no hay forma de quedarse sin puntos
 * y sin recompensa. El índice único parcial
 * `supply_v2_reclamacion_viva_por_cliente` impide además que dos pestañas
 * reserven dos veces.
 */
export async function reclamarRecompensaEnTx(
  tx: Tx,
  d: { rewardId: string; customerId: string; idempotencyKey?: string | null },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<ReclamacionHecha> {
  if (d.idempotencyKey) {
    const previa = await tx.supplyV2RewardClaim.findUnique({
      where: { idempotencyKey: d.idempotencyKey },
      select: { id: true, code: true, status: true, pointsConsumed: true, customerBenefitId: true, customerId: true },
    })
    if (previa) {
      if (previa.customerId !== d.customerId) fallo('CLAVE_AJENA', 'Esa reclamación no es tuya.')
      return { id: previa.id, code: previa.code, status: previa.status, puntosConsumidos: previa.pointsConsumed, customerBenefitId: previa.customerBenefitId, repetida: true }
    }
  }

  const r = await bloquearRecompensa(tx, d.rewardId)
  const cliente = await tx.user.findUnique({ where: { id: d.customerId }, select: { id: true, role: true } })
  if (!cliente || cliente.role !== 'CLIENTE') fallo('CLIENTE_NO_ENCONTRADO', 'El cliente no existe o no es un cliente de Membego.')

  const cuenta = await cuentaDePuntosEnTx(tx, r.programId, d.customerId)
  const vivas = await membresiasVivasEnTx(tx, r.programId, d.customerId, ahora)
  const propias = await tx.supplyV2RewardClaim.count({
    where: { rewardId: r.id, customerId: d.customerId, status: { in: ['RESERVED', 'CLAIMED', 'DELIVERED'] } },
  })
  const enCurso = await tx.supplyV2RewardClaim.count({ where: { rewardId: r.id, customerId: d.customerId, status: 'RESERVED' } })
  const usado = await tx.supplyV2RewardClaim.aggregate({
    where: { rewardId: r.id, status: { in: ['CLAIMED', 'DELIVERED'] } },
    _sum: { cost: true },
  })

  const paraReclamar: RecompensaParaReclamar = {
    status: r.status,
    pointsCost: r.pointsCost,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    maxClaims: r.maxClaims,
    timesClaimed: r.timesClaimed,
    maxPerCustomer: r.maxPerCustomer,
    requiresMembership: r.requiresMembership,
    requiredPlanId: r.requiredPlanId,
    budgetTotal: r.budgetTotal,
    unitCost: r.unitCost,
  }
  const delCliente: ClienteParaReclamar = {
    puntosDisponibles: cuenta.available,
    reclamacionesPropias: propias,
    enCurso,
    planesVivos: vivas.map((m) => m.planId),
    presupuestoUsado: usado._sum.cost ?? new Prisma.Decimal(0),
  }
  const motivo = motivoNoReclamable(r.program, paraReclamar, delCliente, ahora)
  if (motivo) fallo(motivo, MENSAJES_NO_RECLAMABLE[motivo])

  const code = await siguienteNumero(
    tx,
    'MBG-RK',
    async (prefijo) => {
      const u = await tx.supplyV2RewardClaim.findFirst({ where: { code: { startsWith: prefijo } }, orderBy: { code: 'desc' }, select: { code: true } })
      return u?.code ?? null
    },
    ahora
  )

  // 1 · la reclamación nace RESERVED, con los puntos ya apartados.
  const claim = await tx.supplyV2RewardClaim
    .create({
      data: {
        code,
        rewardId: r.id,
        programId: r.programId,
        customerId: d.customerId,
        accountId: cuenta.id,
        pointsReserved: r.pointsCost,
        status: 'RESERVED',
        currency: r.program.currency,
        claimedAt: ahora,
        idempotencyKey: d.idempotencyKey ?? null,
      },
      select: { id: true, code: true },
    })
    .catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        fallo('YA_TIENE_UNA_EN_CURSO', MENSAJES_NO_RECLAMABLE.YA_TIENE_UNA_EN_CURSO)
      }
      throw e
    })

  if (r.pointsCost > 0) {
    await reservarPuntosEnTx(tx, cuenta, { puntos: r.pointsCost, rewardClaimId: claim.id, reason: `Reclamación ${claim.code}` }, ctx)
  }

  // 2 · se crea el beneficio. Si esto falla, la transacción entera se deshace
  // y los puntos no se quedan apartados en el limbo.
  let customerBenefitId: string | null = null
  if (r.benefitId) {
    const asignacion = await asignarBeneficioEnTx(
      tx,
      { benefitId: r.benefitId, customerId: d.customerId, usesAllowed: 1, expiresAt: r.endsAt, note: `Recompensa ${claim.code}` },
      { ...ctx, actorId: ctx.actorId ?? r.createdById }
    )
    customerBenefitId = asignacion.id
  }

  // 3 · se confirma: los puntos reservados pasan a canjeados.
  const cuentaTrasReserva = await cuentaDePuntosEnTx(tx, r.programId, d.customerId)
  if (r.pointsCost > 0) {
    await consumirReservaDePuntosEnTx(tx, cuentaTrasReserva, { puntos: r.pointsCost, rewardClaimId: claim.id }, ctx)
  }
  await tx.supplyV2RewardClaim.update({
    where: { id: claim.id },
    data: { status: 'CLAIMED', pointsConsumed: r.pointsCost, customerBenefitId },
  })
  await tx.supplyV2Reward.update({ where: { id: r.id }, data: { timesClaimed: { increment: 1 } } })

  const nuevoEstado = estadoRecompensaSegunUsos({ status: 'ACTIVE', maxClaims: r.maxClaims, timesClaimed: r.timesClaimed + 1, endsAt: r.endsAt }, ahora)
  if (nuevoEstado !== 'ACTIVE') await tx.supplyV2Reward.update({ where: { id: r.id }, data: { status: nuevoEstado } })

  const detalle = { code: claim.code, recompensa: r.code, puntos: r.pointsCost, customerBenefitId }
  await eventoDePrograma(tx, r.programId, 'REWARD_CLAIMED', detalle, ctx.actorId, { rewardClaimId: claim.id })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_REWARD_CLAIMED', 'SupplyV2RewardClaim', claim.id, detalle, r.program.supplier?.companyId ?? null)
  return { id: claim.id, code: claim.code, status: 'CLAIMED', puntosConsumidos: r.pointsCost, customerBenefitId, repetida: false }
}

/**
 * La recompensa se ENTREGÓ: su beneficio se usó de verdad. Aquí —y no al
 * reclamar— es cuando se reconoce el costo (§35).
 */
export async function marcarEntregadaEnTx(tx: Tx, claimId: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<boolean> {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_reward_claims" WHERE "id" = ${claimId} FOR UPDATE`
  const c = await tx.supplyV2RewardClaim.findUniqueOrThrow({
    where: { id: claimId },
    include: { reward: { select: { code: true, unitCost: true } }, program: { select: { supplier: { select: { companyId: true } } } } },
  })
  if (c.status === 'DELIVERED') return false
  exigirTransicion(TRANSICIONES_RECLAMACION, c.status, 'DELIVERED', 'Reclamación')
  await tx.supplyV2RewardClaim.update({
    where: { id: claimId },
    data: { status: 'DELIVERED', deliveredAt: ahora, cost: c.reward.unitCost ?? new Prisma.Decimal(0) },
  })
  const detalle = { code: c.code, recompensa: c.reward.code, costo: (c.reward.unitCost ?? new Prisma.Decimal(0)).toFixed(2) }
  await eventoDePrograma(tx, c.programId, 'REWARD_DELIVERED', detalle, ctx.actorId, { rewardClaimId: claimId })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_REWARD_DELIVERED', 'SupplyV2RewardClaim', claimId, detalle, c.program.supplier?.companyId ?? null)
  return true
}

/**
 * Pasa a ENTREGADAS las reclamaciones cuyo beneficio ya se consumió. Es el
 * puente entre el canje y la entrega REAL por QR: no hay un segundo sistema
 * de redención, se lee el del Slice 6.
 */
export async function conciliarEntregasEnTx(tx: Tx, ctx: ContextoAuditoria, ahora = new Date(), limite = 200): Promise<number> {
  const candidatas = await tx.supplyV2RewardClaim.findMany({
    where: { status: 'CLAIMED', customerBenefitId: { not: null }, customerBenefit: { usesConsumed: { gt: 0 } } },
    select: { id: true },
    take: limite,
  })
  let entregadas = 0
  for (const c of candidatas) if (await marcarEntregadaEnTx(tx, c.id, ctx, ahora)) entregadas++
  return entregadas
}

/**
 * REVERSA (§34). Una recompensa YA ENTREGADA no devuelve puntos: el beneficio
 * se consumió y devolverlos sería regalarlo dos veces. Solo vuelven los de lo
 * que no se llegó a usar. En los dos casos queda historial.
 */
export async function reversarReclamacionEnTx(tx: Tx, claimId: string, motivo: string, ctx: ContextoAuditoria): Promise<{ id: string; puntosDevueltos: number }> {
  if (!motivo?.trim()) fallo('SIN_MOTIVO', 'Reversar una reclamación necesita un motivo.')
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_reward_claims" WHERE "id" = ${claimId} FOR UPDATE`
  const c = await tx.supplyV2RewardClaim.findUniqueOrThrow({
    where: { id: claimId },
    include: { reward: { select: { id: true, code: true } }, program: { select: { supplier: { select: { companyId: true } } } } },
  })
  exigirTransicion(TRANSICIONES_RECLAMACION, c.status, 'REVERSED', 'Reclamación')

  let puntosDevueltos = 0
  // Una reclamación que se quedó en RESERVED (su transacción no llegó a
  // confirmarla) tiene puntos APARTADOS, no canjeados: se sueltan por el
  // camino de la reserva, que además devuelve el saldo a sus lotes.
  if (c.status === 'RESERVED' && c.pointsReserved > 0) {
    const cuenta = await cuentaDePuntosEnTx(tx, c.programId, c.customerId)
    await liberarReservaDePuntosEnTx(tx, cuenta, { puntos: c.pointsReserved, rewardClaimId: c.id, motivo: motivo.trim() }, ctx)
    puntosDevueltos = c.pointsReserved
  } else if (reversaDevuelvePuntos(c.status) && c.pointsConsumed > 0) {
    const cuenta = await cuentaDePuntosEnTx(tx, c.programId, c.customerId)
    // Lo ya canjeado vuelve como puntos disponibles nuevos, con su motivo:
    // el ledger no se reescribe, se le añade el movimiento que lo explica.
    await tx.supplyV2PointsMovement.create({
      data: {
        accountId: cuenta.id,
        type: 'REVERSED',
        source: 'REWARD',
        points: c.pointsConsumed,
        availableDelta: c.pointsConsumed,
        redeemedDelta: -c.pointsConsumed,
        availableAfter: cuenta.available + c.pointsConsumed,
        pendingAfter: cuenta.pending,
        reservedAfter: cuenta.reserved,
        rewardClaimId: c.id,
        reason: motivo.trim(),
        actorId: ctx.actorId,
      },
    })
    await tx.supplyV2PointsAccount.update({
      where: { id: cuenta.id },
      data: { available: cuenta.available + c.pointsConsumed, redeemed: cuenta.redeemed - c.pointsConsumed },
    })
    puntosDevueltos = c.pointsConsumed
  }

  if (c.customerBenefitId) {
    // La asignación se cancela para que no se pueda usar después de reversar.
    await tx.supplyV2CustomerBenefit.updateMany({ where: { id: c.customerBenefitId, status: 'AVAILABLE' }, data: { status: 'CANCELLED' } })
  }

  await tx.supplyV2RewardClaim.update({ where: { id: claimId }, data: { status: 'REVERSED', reversedAt: new Date(), reverseReason: motivo.trim() } })
  await tx.supplyV2Reward.update({ where: { id: c.rewardId }, data: { timesClaimed: { decrement: 1 } } })

  const detalle = { code: c.code, motivo: motivo.trim(), puntosDevueltos, estadoAnterior: c.status }
  await eventoDePrograma(tx, c.programId, 'REWARD_REVERSED', detalle, ctx.actorId, { rewardClaimId: claimId })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_REWARD_REVERSED', 'SupplyV2RewardClaim', claimId, detalle, c.program.supplier?.companyId ?? null)
  return { id: claimId, puntosDevueltos }
}

// ── Economía del programa (§35–§37) ────────────────────────────────────────

/**
 * Lee la economía del programa DESDE sus recompensas y lo entregado. No hay
 * un segundo contador que pueda descuadrarse, igual que el presupuesto de
 * campaña del Slice 7.
 */
export async function economiaDelProgramaEnTx(tx: Tx, programId: string) {
  const programa = await tx.supplyV2LoyaltyProgram.findUniqueOrThrow({ where: { id: programId }, select: { budgetTotal: true } })
  const recompensas = await tx.supplyV2Reward.findMany({
    where: { programId, status: { not: 'CANCELLED' } },
    select: { id: true, budgetTotal: true, unitCost: true },
  })
  const costos: CostoDeRecompensa[] = []
  for (const r of recompensas) {
    const pendientes = await tx.supplyV2RewardClaim.count({ where: { rewardId: r.id, status: { in: ['RESERVED', 'CLAIMED'] } } })
    const entregadas = await tx.supplyV2RewardClaim.aggregate({ where: { rewardId: r.id, status: 'DELIVERED' }, _count: true, _sum: { cost: true } })
    costos.push({
      budgetTotal: r.budgetTotal,
      unitCost: r.unitCost,
      pendientes,
      entregadas: entregadas._count,
      costoEntregado: entregadas._sum.cost ?? new Prisma.Decimal(0),
    })
  }
  return economiaDelPrograma(programa.budgetTotal, costos)
}
