import { randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { SupplyV2ReferralRewardKind } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { decimal } from '../core/dinero'
import { fallo } from '../core/errores'
import { exigirTransicion } from '../core/estados'
import { codigoAleatorio, codigoValido, normalizarCodigoCupon } from '../campaigns/domain'
import { asignarBeneficioEnTx } from '../benefits/service'
import {
  MENSAJE_REFERIDO_OPACO,
  MENSAJES_REFERIDO,
  motivoReferidoNoElegible,
  sumarDias,
  TRANSICIONES_REFERIDO,
  type CompraDelReferido,
  type ReglasDeReferido,
  type UsoDelProgramaDeReferidos,
} from './domain'
import { acreditarPuntosEnTx } from './points'
import { aprobarRecompensaEnTx, crearRecompensaEnTx } from './rewards'
import { bloquearPrograma, eventoDePrograma } from './programs'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · REFERIDOS (§18–§23).
 *
 * El recorrido del enunciado: Juan comparte su enlace, María se registra con
 * él, María hace su PRIMERA COMPRA VÁLIDA y entonces —y solo entonces— Juan
 * cobra. Abrir el enlace no paga nada.
 *
 * ANTIFRAUDE (§22). Lo que se protege y cómo:
 *
 *   · Autorreferido ............ CHECK en la base + comprobación en el dominio
 *   · Códigos duplicados ....... índice único, y único también en MAYÚSCULAS
 *   · Recompensa repetida ...... REWARD_GRANTED es estado final + clave de
 *                                idempotencia + `referralId` único en la
 *                                reclamación
 *   · Varias cuentas por el
 *     mismo referido ........... `@@unique([programId, referredId])`: una
 *                                persona solo entra por una invitación
 *   · Compra cancelada ......... la elegibilidad exige pago confirmado y no
 *                                cancelado, y se vuelve a comprobar al conceder
 *   · Manipulación del enlace .. el código se resuelve en el SERVIDOR y no es
 *                                una credencial: saberlo no salta ninguna regla
 *   · Reintentos de la
 *     confirmación de pago ..... claves de idempotencia en los dos puntos
 *
 * LO QUE NO SE HACE: no se trata compartir dispositivo, IP o red como prueba
 * de fraude (§22). No se guarda ni se mira nada de eso: los controles son
 * sobre hechos de la propia operación —quién compró, cuándo y si se canceló—.
 */

const LARGO_CODIGO = 10

export async function bloquearReferido(tx: Tx, referralId: string) {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_referrals" WHERE "id" = ${referralId} FOR UPDATE`
  const r = await tx.supplyV2Referral.findUnique({
    where: { id: referralId },
    include: { program: { select: { id: true, status: true, startsAt: true, endsAt: true, supplier: { select: { companyId: true } } } }, referralCode: { select: { id: true, active: true } } },
  })
  if (!r) fallo('REFERIDO_NO_ENCONTRADO', 'Esa invitación no existe.')
  return r
}

// ── Configuración del programa de referidos (§21) ──────────────────────────

export interface DatosProgramaReferidos {
  rewardKind: SupplyV2ReferralRewardKind
  rewardBenefitId?: string | null
  rewardPoints?: number | null
  rewardAmount?: number | string | null
  requiresFirstPurchase?: boolean | null
  minPurchaseAmount?: number | string | null
  requiresPaymentConfirmed?: boolean | null
  waitingPeriodDays?: number | null
  maxPerReferrer?: number | null
  maxTotal?: number | null
  budgetTotal?: number | string | null
}

export async function configurarReferidosEnTx(tx: Tx, programId: string, d: DatosProgramaReferidos, ctx: ContextoAuditoria): Promise<{ id: string }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Configurar los referidos necesita quién lo hace.')
  const p = await bloquearPrograma(tx, programId)
  if (['COMPLETED', 'CANCELLED'].includes(p.status)) fallo('PROGRAMA_CERRADO', 'Un programa cerrado no cambia sus referidos.')
  if (!p.modalities.includes('REFERRALS')) fallo('MODALIDAD_NO_HABILITADA', 'Este programa no tiene habilitados los referidos.')

  if (d.rewardKind === 'POINTS') {
    if (!d.rewardPoints || d.rewardPoints <= 0) fallo('SIN_PUNTOS', 'Una recompensa en puntos necesita cuántos puntos da.')
    if (!p.modalities.includes('POINTS') || p.pointsPerUnit == null) {
      fallo('SIN_PUNTOS_EN_PROGRAMA', 'Este programa no tiene puntos habilitados, así que no puede pagar los referidos en puntos.')
    }
  } else {
    if (!d.rewardBenefitId) fallo('SIN_BENEFICIO', 'Esta recompensa necesita el beneficio que se le concede a quien invita.')
    const b = await tx.supplyV2Benefit.findUnique({ where: { id: d.rewardBenefitId }, select: { id: true, status: true, requiresAssignment: true, currency: true } })
    if (!b) fallo('BENEFICIO_NO_ENCONTRADO', 'Ese beneficio no existe.')
    if (['CANCELLED', 'EXPIRED'].includes(b.status)) fallo('BENEFICIO_CERRADO', 'Ese beneficio ya no está disponible.')
    if (b.currency !== p.currency) fallo('MONEDA_DISTINTA', 'Ese beneficio es de otra moneda.')
    if (!b.requiresAssignment) fallo('BENEFICIO_ABIERTO', 'El premio de un referido tiene que ser un beneficio de los que se asignan.')
  }
  if (d.waitingPeriodDays != null && (!Number.isInteger(d.waitingPeriodDays) || d.waitingPeriodDays < 0)) {
    fallo('ESPERA_INVALIDA', 'El período de espera no puede ser negativo.')
  }

  const datos = {
    rewardKind: d.rewardKind,
    rewardBenefitId: d.rewardBenefitId ?? null,
    rewardPoints: d.rewardPoints ?? null,
    rewardAmount: d.rewardAmount != null && d.rewardAmount !== '' ? decimal(d.rewardAmount) : null,
    requiresFirstPurchase: d.requiresFirstPurchase ?? true,
    minPurchaseAmount: d.minPurchaseAmount != null && d.minPurchaseAmount !== '' ? decimal(d.minPurchaseAmount) : null,
    requiresPaymentConfirmed: d.requiresPaymentConfirmed ?? true,
    waitingPeriodDays: d.waitingPeriodDays ?? 0,
    maxPerReferrer: d.maxPerReferrer ?? null,
    maxTotal: d.maxTotal ?? null,
    budgetTotal: d.budgetTotal != null && d.budgetTotal !== '' ? decimal(d.budgetTotal) : null,
    active: true,
  }
  const rp = await tx.supplyV2ReferralProgram.upsert({
    where: { programId },
    update: datos,
    create: { programId, ...datos },
    select: { id: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_LOYALTY_PROGRAM_CREATED', 'SupplyV2ReferralProgram', rp.id, { programId, rewardKind: d.rewardKind }, p.supplier?.companyId ?? null)
  return rp
}

// ── Código y enlace (§19) ──────────────────────────────────────────────────

/**
 * El código de una persona en un programa. Se genera con `randomBytes` y un
 * alfabeto sin caracteres que se confundan al dictarlos; NUNCA es un id
 * interno (§19). Idempotente: la misma persona siempre recibe el suyo.
 */
export async function codigoDeReferidoEnTx(tx: Tx, programId: string, ownerId: string): Promise<{ id: string; code: string; repetido: boolean }> {
  const previo = await tx.supplyV2ReferralCode.findUnique({ where: { programId_ownerId: { programId, ownerId } }, select: { id: true, code: true } })
  if (previo) return { ...previo, repetido: true }

  const programa = await tx.supplyV2LoyaltyProgram.findUniqueOrThrow({ where: { id: programId }, select: { status: true, modalities: true } })
  if (!programa.modalities.includes('REFERRALS')) fallo('MODALIDAD_NO_HABILITADA', 'Este programa no tiene habilitados los referidos.')
  const cliente = await tx.user.findUnique({ where: { id: ownerId }, select: { role: true } })
  if (!cliente || cliente.role !== 'CLIENTE') fallo('CLIENTE_NO_ENCONTRADO', 'Solo un cliente de Membego puede invitar.')

  for (let intento = 0; intento < 6; intento++) {
    const code = codigoAleatorio((n) => randomBytes(n), LARGO_CODIGO)
    if (!codigoValido(code)) continue
    try {
      const creado = await tx.supplyV2ReferralCode.create({ data: { code, programId, ownerId }, select: { id: true, code: true } })
      return { ...creado, repetido: false }
    } catch (e) {
      // Colisión de código: se reintenta con otro. El índice único manda.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue
      throw e
    }
  }
  fallo('CODIGO_NO_GENERADO', 'No se pudo generar un código de invitación. Vuelve a intentarlo.')
}

/** Resuelve un código escrito a mano. Mensaje OPACO: probar códigos no informa de nada. */
export async function resolverCodigoEnTx(tx: Tx, codigo: string) {
  const normalizado = normalizarCodigoCupon(codigo ?? '')
  if (!codigoValido(normalizado)) fallo('CODIGO_INVALIDO', MENSAJE_REFERIDO_OPACO)
  const filas = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "supply_v2_referral_codes" WHERE upper("code") = ${normalizado} LIMIT 1`
  if (filas.length === 0) fallo('CODIGO_NO_ENCONTRADO', MENSAJE_REFERIDO_OPACO)
  const c = await tx.supplyV2ReferralCode.findUniqueOrThrow({
    where: { id: filas[0]!.id },
    include: { program: { select: { id: true, status: true, startsAt: true, endsAt: true, name: true } } },
  })
  if (!c.active) fallo('CODIGO_INACTIVO', MENSAJE_REFERIDO_OPACO)
  return c
}

/** Alguien abrió el enlace. Informativo: no genera ningún derecho (§18, §20). */
export async function registrarAperturaEnTx(tx: Tx, codigo: string): Promise<{ programId: string; ownerId: string }> {
  const c = await resolverCodigoEnTx(tx, codigo)
  await tx.supplyV2ReferralCode.update({ where: { id: c.id }, data: { timesOpened: { increment: 1 } } })
  return { programId: c.programId, ownerId: c.ownerId }
}

// ── Atribución del registro (§20, §22) ─────────────────────────────────────

/**
 * María se registró con el enlace de Juan. Aquí se comprueba el autorreferido
 * y que esta persona no haya entrado ya por otra invitación; la base repite
 * las dos cosas con un CHECK y un índice único.
 */
export async function atribuirRegistroEnTx(
  tx: Tx,
  d: { codigo: string; referredId: string },
  ctx: ContextoAuditoria
): Promise<{ id: string; status: string; repetido: boolean }> {
  const c = await resolverCodigoEnTx(tx, d.codigo)
  if (c.ownerId === d.referredId) fallo('AUTORREFERIDO', MENSAJES_REFERIDO.AUTORREFERIDO)
  const referido = await tx.user.findUnique({ where: { id: d.referredId }, select: { role: true } })
  if (!referido || referido.role !== 'CLIENTE') fallo('CLIENTE_NO_ENCONTRADO', 'Quien se registra tiene que ser un cliente de Membego.')

  const previo = await tx.supplyV2Referral.findUnique({
    where: { programId_referredId: { programId: c.programId, referredId: d.referredId } },
    select: { id: true, status: true, referrerId: true },
  })
  if (previo) {
    // Ya entró por una invitación. Si es la misma, es un reintento; si es
    // otra, no se cambia de padrino (§22).
    if (previo.referrerId === c.ownerId) return { id: previo.id, status: previo.status, repetido: true }
    fallo('YA_FUE_REFERIDO', MENSAJES_REFERIDO.YA_FUE_REFERIDO)
  }

  const r = await tx.supplyV2Referral
    .create({
      data: {
        programId: c.programId,
        referralCodeId: c.id,
        referrerId: c.ownerId,
        referredId: d.referredId,
        codeSnapshot: c.code,
        status: 'SIGNED_UP',
        signedUpAt: new Date(),
      },
      select: { id: true },
    })
    .catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') fallo('YA_FUE_REFERIDO', MENSAJES_REFERIDO.YA_FUE_REFERIDO)
      throw e
    })
  await tx.supplyV2ReferralCode.update({ where: { id: c.id }, data: { timesSignedUp: { increment: 1 } } })
  await eventoDePrograma(tx, c.programId, 'REFERRAL_SIGNED_UP', { codigo: c.code, referrerId: c.ownerId }, ctx.actorId, { referralId: r.id })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_REFERRAL_SIGNED_UP', 'SupplyV2Referral', r.id, { programId: c.programId, referrerId: c.ownerId, referredId: d.referredId }, null)
  return { id: r.id, status: 'SIGNED_UP', repetido: false }
}

// ── La compra que da derecho (§21) ─────────────────────────────────────────

async function usoDelProgramaEnTx(tx: Tx, programId: string, referrerId: string, coste: Prisma.Decimal): Promise<UsoDelProgramaDeReferidos> {
  const [delReferidor, totales, gastado] = await Promise.all([
    tx.supplyV2Referral.count({ where: { programId, referrerId, status: 'REWARD_GRANTED' } }),
    tx.supplyV2Referral.count({ where: { programId, status: 'REWARD_GRANTED' } }),
    tx.supplyV2Referral.aggregate({ where: { programId, status: 'REWARD_GRANTED' }, _sum: { rewardAmount: true } }),
  ])
  return {
    recompensasDelReferidor: delReferidor,
    recompensasTotales: totales,
    presupuestoUsado: gastado._sum.rewardAmount ?? new Prisma.Decimal(0),
    costeDeEsta: coste,
  }
}

/**
 * Una compra confirmada: ¿hace elegible a algún referido? Se llama desde la
 * confirmación del pago, en la misma transacción.
 *
 * La elegibilidad se calcula ENTERA EN EL SERVIDOR (§21) y en orden, de modo
 * que el motivo que se registra es el primero que de verdad bloquea.
 */
export async function evaluarCompraEnTx(tx: Tx, orderId: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<string[]> {
  const orden = await tx.supplyV2CustomerOrder.findUnique({
    where: { id: orderId },
    select: { id: true, customerId: true, status: true, total: true, paidAt: true },
  })
  if (!orden || orden.status !== 'PAID') return []

  const candidatos = await tx.supplyV2Referral.findMany({
    where: { referredId: orden.customerId, status: { in: ['SIGNED_UP', 'VERIFIED', 'PURCHASE_ELIGIBLE'] } },
    select: { id: true },
  })
  const tocados: string[] = []
  for (const c of candidatos) {
    const r = await bloquearReferido(tx, c.id)
    const reglasFila = await tx.supplyV2ReferralProgram.findUnique({ where: { programId: r.programId }, select: { active: true, requiresFirstPurchase: true, minPurchaseAmount: true, requiresPaymentConfirmed: true, waitingPeriodDays: true, maxPerReferrer: true, maxTotal: true, budgetTotal: true, rewardAmount: true } })
    if (!reglasFila) continue
    const reglas: ReglasDeReferido = reglasFila

    // Compras elegibles ANTERIORES a esta del mismo cliente: si ya había
    // comprado, esta no es su primera compra.
    const previas = await tx.supplyV2CustomerOrder.count({
      where: { customerId: orden.customerId, status: 'PAID', id: { not: orden.id }, paidAt: { lt: orden.paidAt ?? ahora } },
    })
    const compra: CompraDelReferido = {
      importe: orden.total,
      pagoConfirmado: true,
      cancelada: false,
      comprasPrevias: previas,
      confirmadaEn: orden.paidAt ?? ahora,
    }
    const uso = await usoDelProgramaEnTx(tx, r.programId, r.referrerId, reglasFila.rewardAmount ?? new Prisma.Decimal(0))
    const motivo = motivoReferidoNoElegible(r.program, reglas, { referrerId: r.referrerId, referredId: r.referredId, status: r.status, codigoActivo: r.referralCode.active }, compra, uso, ahora)

    if (motivo && motivo !== 'PERIODO_DE_ESPERA') {
      // No es elegible por esta compra. No se anula el referido: puede serlo
      // por otra más adelante, salvo que el motivo sea definitivo.
      continue
    }

    // Elegible. Se marca la compra que lo hizo, y se pasa a pendiente de
    // recompensa: de aquí en adelante hay un derecho económico en juego.
    if (r.status !== 'PURCHASE_ELIGIBLE') {
      if (r.status === 'SIGNED_UP') {
        exigirTransicion(TRANSICIONES_REFERIDO, r.status, 'VERIFIED', 'Referido')
        await tx.supplyV2Referral.update({ where: { id: r.id }, data: { status: 'VERIFIED', verifiedAt: ahora } })
      }
      await tx.supplyV2Referral.update({ where: { id: r.id }, data: { status: 'PURCHASE_ELIGIBLE', eligibleOrderId: orden.id, eligibleAt: ahora } })
    }
    await eventoDePrograma(tx, r.programId, 'REFERRAL_ELIGIBLE', { orderId: orden.id, importe: orden.total.toFixed(2) }, ctx.actorId, { referralId: r.id })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_REFERRAL_ELIGIBLE', 'SupplyV2Referral', r.id, { orderId: orden.id, importe: orden.total.toFixed(2) }, r.program.supplier?.companyId ?? null)
    tocados.push(r.id)

    // Sin período de espera, la recompensa se aprueba y se concede ya.
    if (reglas.waitingPeriodDays === 0) {
      await aprobarYConcederEnTx(tx, r.id, ctx, ahora)
    } else {
      await tx.supplyV2Referral.update({ where: { id: r.id }, data: { status: 'REWARD_PENDING' } })
    }
  }
  return tocados
}

/**
 * Aprueba y concede la recompensa, EXACTAMENTE UNA VEZ (§23).
 *
 * Tres cierres distintos lo garantizan: `REWARD_GRANTED` es estado final, la
 * clave de idempotencia del movimiento de puntos, y `referralId` es único en
 * la reclamación. Y antes de pagar se vuelve a comprobar que la compra que lo
 * hizo elegible sigue siendo válida: una cancelación posterior no cobra.
 */
export async function aprobarYConcederEnTx(tx: Tx, referralId: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<{ concedida: boolean; motivo?: string }> {
  const r = await bloquearReferido(tx, referralId)
  if (r.status === 'REWARD_GRANTED') return { concedida: false, motivo: 'YA_RECOMPENSADO' }
  if (r.status === 'REWARD_VOIDED') return { concedida: false, motivo: 'ANULADO' }

  const reglasFila = await tx.supplyV2ReferralProgram.findUnique({ where: { programId: r.programId }, select: { active: true, requiresFirstPurchase: true, minPurchaseAmount: true, requiresPaymentConfirmed: true, waitingPeriodDays: true, maxPerReferrer: true, maxTotal: true, budgetTotal: true, rewardKind: true, rewardBenefitId: true, rewardPoints: true, rewardAmount: true } })
  if (!reglasFila) return { concedida: false, motivo: 'SIN_PROGRAMA' }
  if (!r.eligibleOrderId) return { concedida: false, motivo: 'SIN_COMPRA' }

  // LA COMPRA SE VUELVE A MIRAR. Entre la elegibilidad y la concesión puede
  // haberse cancelado, y una compra caída no paga recompensa (§22).
  const orden = await tx.supplyV2CustomerOrder.findUniqueOrThrow({
    where: { id: r.eligibleOrderId },
    select: { status: true, total: true, paidAt: true, customerId: true },
  })
  const previas = await tx.supplyV2CustomerOrder.count({
    where: { customerId: orden.customerId, status: 'PAID', id: { not: r.eligibleOrderId }, paidAt: { lt: orden.paidAt ?? ahora } },
  })
  const compra: CompraDelReferido = {
    importe: orden.total,
    pagoConfirmado: orden.status === 'PAID',
    cancelada: orden.status !== 'PAID',
    comprasPrevias: previas,
    confirmadaEn: orden.paidAt,
  }
  const uso = await usoDelProgramaEnTx(tx, r.programId, r.referrerId, reglasFila.rewardAmount ?? new Prisma.Decimal(0))
  const motivo = motivoReferidoNoElegible(r.program, reglasFila, { referrerId: r.referrerId, referredId: r.referredId, status: r.status, codigoActivo: r.referralCode.active }, compra, uso, ahora)
  if (motivo) {
    if (motivo === 'PERIODO_DE_ESPERA') return { concedida: false, motivo }
    // Lo demás es definitivo: se anula con su motivo, que queda escrito.
    await anularReferidoEnTx(tx, r.id, MENSAJES_REFERIDO[motivo], ctx)
    return { concedida: false, motivo }
  }

  // El barrido concede sin que nadie pulse nada, pero conceder un beneficio
  // exige quién lo concede (Slice 6). Se atribuye a quien aprobó el programa
  // —que es quien autorizó pagar estos premios—, no a un actor de sistema.
  const autorizo = await tx.supplyV2LoyaltyProgram.findUniqueOrThrow({ where: { id: r.programId }, select: { approvedById: true, createdById: true } })
  const quien: ContextoAuditoria = { ...ctx, actorId: ctx.actorId ?? autorizo.approvedById ?? autorizo.createdById }

  if (r.status === 'PURCHASE_ELIGIBLE') {
    exigirTransicion(TRANSICIONES_REFERIDO, r.status, 'REWARD_PENDING', 'Referido')
    await tx.supplyV2Referral.update({ where: { id: r.id }, data: { status: 'REWARD_PENDING' } })
  }
  await tx.supplyV2Referral.update({ where: { id: r.id }, data: { status: 'REWARD_APPROVED', rewardApprovedAt: ahora } })
  await eventoDePrograma(tx, r.programId, 'REFERRAL_REWARD_APPROVED', { rewardKind: reglasFila.rewardKind }, ctx.actorId, { referralId: r.id })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_REFERRAL_REWARD_APPROVED', 'SupplyV2Referral', r.id, { rewardKind: reglasFila.rewardKind }, r.program.supplier?.companyId ?? null)

  // ── Conceder ──
  const clave = `referido:${r.id}`
  let benefitId: string | null = null
  if (reglasFila.rewardKind === 'POINTS') {
    await acreditarPuntosEnTx(
      tx,
      { programId: r.programId, customerId: r.referrerId, puntos: reglasFila.rewardPoints!, source: 'REFERRAL', referralId: r.id, reason: `Invitación ${r.codeSnapshot}`, idempotencyKey: clave },
      ctx,
      ahora
    )
  } else {
    const asignacion = await asignarBeneficioEnTx(
      tx,
      { benefitId: reglasFila.rewardBenefitId!, customerId: r.referrerId, usesAllowed: 1, note: `Premio por la invitación ${r.codeSnapshot}` },
      quien
    )
    benefitId = reglasFila.rewardBenefitId!
    // La reclamación cuelga del referido: `referralId` es ÚNICO, así que un
    // referido no puede pagar dos recompensas.
    await tx.supplyV2RewardClaim.create({
      data: {
        code: `MBG-RK-REF-${r.id.slice(-10).toUpperCase()}`,
        rewardId: (await recompensaPuenteEnTx(tx, r.programId, reglasFila.rewardBenefitId!, quien)).id,
        programId: r.programId,
        customerId: r.referrerId,
        pointsReserved: 0,
        pointsConsumed: 0,
        status: 'CLAIMED',
        customerBenefitId: asignacion.id,
        referralId: r.id,
        currency: 'DOP',
        claimedAt: ahora,
      },
    }).catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') fallo('YA_RECOMPENSADO', MENSAJES_REFERIDO.YA_RECOMPENSADO)
      throw e
    })
  }

  await tx.supplyV2Referral.update({
    where: { id: r.id },
    data: {
      status: 'REWARD_GRANTED',
      rewardGrantedAt: ahora,
      rewardKind: reglasFila.rewardKind,
      rewardPoints: reglasFila.rewardPoints,
      rewardAmount: reglasFila.rewardAmount,
      rewardBenefitId: benefitId,
      idempotencyKey: clave,
    },
  })
  await tx.supplyV2ReferralCode.update({ where: { id: r.referralCodeId }, data: { timesRewarded: { increment: 1 } } })
  const detalle = { rewardKind: reglasFila.rewardKind, puntos: reglasFila.rewardPoints, beneficio: benefitId, referidor: r.referrerId }
  await eventoDePrograma(tx, r.programId, 'REFERRAL_REWARD_GRANTED', detalle, ctx.actorId, { referralId: r.id })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_REFERRAL_REWARD_GRANTED', 'SupplyV2Referral', r.id, detalle, r.program.supplier?.companyId ?? null)
  return { concedida: true }
}

/**
 * La recompensa de un referido en forma de beneficio también es una
 * reclamación, para que la economía del programa la vea por el mismo sitio
 * que las demás. Esta es la recompensa «puente» del programa; se crea una
 * sola vez y se reutiliza.
 */
async function recompensaPuenteEnTx(tx: Tx, programId: string, benefitId: string, ctx: ContextoAuditoria): Promise<{ id: string }> {
  const previa = await tx.supplyV2Reward.findFirst({ where: { programId, benefitId, pointsCost: 0, kind: 'BENEFIT' }, select: { id: true } })
  if (previa) return previa
  const creada = await crearRecompensaEnTx(
    tx,
    programId,
    { name: 'Premio por invitación', kind: 'BENEFIT', pointsCost: 0, benefitId, maxPerCustomer: 1_000_000, startsAt: new Date(Date.now() - 60_000) },
    ctx
  )
  await aprobarRecompensaEnTx(tx, creada.id, ctx)
  return creada
}

export async function anularReferidoEnTx(tx: Tx, referralId: string, motivo: string, ctx: ContextoAuditoria): Promise<{ id: string }> {
  if (!motivo?.trim()) fallo('SIN_MOTIVO', 'Anular una invitación necesita un motivo.')
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_referrals" WHERE "id" = ${referralId} FOR UPDATE`
  const r = await tx.supplyV2Referral.findUniqueOrThrow({ where: { id: referralId }, select: { id: true, status: true, programId: true } })
  if (r.status === 'REWARD_VOIDED') return { id: r.id }
  exigirTransicion(TRANSICIONES_REFERIDO, r.status, 'REWARD_VOIDED', 'Referido')
  await tx.supplyV2Referral.update({ where: { id: r.id }, data: { status: 'REWARD_VOIDED', voidedAt: new Date(), voidReason: motivo.trim() } })
  await eventoDePrograma(tx, r.programId, 'REFERRAL_REWARD_VOIDED', { motivo: motivo.trim() }, ctx.actorId, { referralId: r.id })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_REFERRAL_REWARD_VOIDED', 'SupplyV2Referral', r.id, { motivo: motivo.trim() }, null)
  return { id: r.id }
}

/** Barrido: referidos cuyo período de espera ya pasó. */
export async function barridoReferidosEnTx(tx: Tx, ctx: ContextoAuditoria, ahora = new Date(), limite = 200): Promise<number> {
  const pendientes = await tx.supplyV2Referral.findMany({
    where: { status: { in: ['PURCHASE_ELIGIBLE', 'REWARD_PENDING', 'REWARD_APPROVED'] }, eligibleAt: { not: null } },
    select: { id: true },
    orderBy: { eligibleAt: 'asc' },
    take: limite,
  })
  let concedidas = 0
  for (const p of pendientes) {
    const r = await aprobarYConcederEnTx(tx, p.id, ctx, ahora)
    if (r.concedida) concedidas++
  }
  return concedidas
}

/** Estadísticas del panel «Invitar amigos» (§19). */
export async function estadisticasDeReferidosEnTx(tx: Tx, programId: string, ownerId: string) {
  const codigo = await tx.supplyV2ReferralCode.findUnique({ where: { programId_ownerId: { programId, ownerId } }, select: { id: true, code: true, timesOpened: true, timesSignedUp: true, timesRewarded: true, active: true } })
  if (!codigo) return null
  const porEstado = await tx.supplyV2Referral.groupBy({ by: ['status'], where: { programId, referrerId: ownerId }, _count: true })
  const cuenta = (estados: string[]) => porEstado.filter((p) => estados.includes(p.status)).reduce((t, p) => t + p._count, 0)
  return {
    code: codigo.code,
    activo: codigo.active,
    aperturas: codigo.timesOpened,
    registros: codigo.timesSignedUp,
    recompensados: codigo.timesRewarded,
    pendientes: cuenta(['SIGNED_UP', 'VERIFIED', 'PURCHASE_ELIGIBLE', 'REWARD_PENDING', 'REWARD_APPROVED']),
    validos: cuenta(['REWARD_GRANTED']),
    anulados: cuenta(['REWARD_VOIDED']),
  }
}

/** Fija el período de espera del programa, en días, desde la compra elegible. */
export function finDelPeriodoDeEspera(eligibleAt: Date, waitingPeriodDays: number): Date {
  return sumarDias(eligibleAt, waitingPeriodDays)
}
