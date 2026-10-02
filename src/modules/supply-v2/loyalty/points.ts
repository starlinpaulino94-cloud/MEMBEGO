import { Prisma } from '@prisma/client'
import type { SupplyV2PointsMovementType, SupplyV2PointsSource } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { decimal } from '../core/dinero'
import { fallo } from '../core/errores'
import {
  consumirPorVencimiento,
  multiplicadorDeMembresias,
  puntosPorCompra,
  saldoDeMovimientosPuntos,
  sumarDias,
  validarAjusteDePuntos,
  vencimientoDeLote,
  type LoteDePuntos,
  type ReglaDeAcumulacion,
} from './domain'
import { membresiasVivasEnTx } from './memberships'
import { eventoDePrograma } from './programs'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · PUNTOS (§24–§29).
 *
 * EL LEDGER ES LA VERDAD. `SupplyV2PointsAccount` guarda caché de las cinco
 * cubetas; la verdad son los movimientos, que no se borran nunca. Cada
 * movimiento lleva su delta firmado por cubeta Y el saldo resultante, igual
 * que `SupplyV2BenefitMovement` sostiene el presupuesto del Slice 6. Un CHECK
 * impide que cualquier cubeta quede negativa.
 *
 * LOS PUNTOS NO SON DINERO (§24): son enteros, no se convierten en saldo
 * retirable y no se mezclan entre programas — la cuenta es
 * (programa, cliente), nunca solo el cliente.
 *
 * QUÉ ES UN «LOTE». Un lote es el movimiento que METIÓ puntos en
 * `available`: `EARNED` (disponibles ya), `AVAILABLE` (los que estaban
 * pendientes y maduraron) o un `ADMIN_ADJUSTMENT` positivo. Lleva su fecha de
 * vencimiento y cuánto se ha consumido de él. Consumir va SIEMPRE por el que
 * vence antes (§29), y `consumedFromLot` es caché de la suma de los
 * movimientos que lo citan como origen.
 *
 * Orden de candados: … → CUENTA DE PUNTOS → RECOMPENSA. La cuenta se bloquea
 * antes de leer sus lotes, así que dos canjes por los últimos puntos se
 * serializan y solo uno pasa.
 */

const TIPOS_QUE_ABREN_LOTE: readonly SupplyV2PointsMovementType[] = ['EARNED', 'AVAILABLE', 'ADMIN_ADJUSTMENT']

export interface CuentaBloqueada {
  id: string
  programId: string
  customerId: string
  available: number
  pending: number
  reserved: number
  redeemed: number
  expired: number
}

/** Abre la cuenta si hace falta y la bloquea. Sin candado no hay carrera que perder. */
export async function cuentaDePuntosEnTx(tx: Tx, programId: string, customerId: string): Promise<CuentaBloqueada> {
  const existente = await tx.supplyV2PointsAccount.findUnique({
    where: { programId_customerId: { programId, customerId } },
    select: { id: true },
  })
  if (!existente) {
    try {
      await tx.supplyV2PointsAccount.create({ data: { programId, customerId } })
    } catch (e) {
      // Dos altas simultáneas: la que pierde se queda con la que ya existe.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
    }
  }
  await tx.$queryRaw`
    SELECT "id" FROM "supply_v2_points_accounts"
    WHERE "programId" = ${programId} AND "customerId" = ${customerId} FOR UPDATE`
  return tx.supplyV2PointsAccount.findUniqueOrThrow({
    where: { programId_customerId: { programId, customerId } },
    select: { id: true, programId: true, customerId: true, available: true, pending: true, reserved: true, redeemed: true, expired: true },
  })
}

export interface DeltasDePuntos {
  availableDelta?: number
  pendingDelta?: number
  reservedDelta?: number
  redeemedDelta?: number
  expiredDelta?: number
}

export interface DatosMovimiento extends DeltasDePuntos {
  type: SupplyV2PointsMovementType
  source: SupplyV2PointsSource
  /** Magnitud en positivo, para leer el movimiento sin sumar cubetas. */
  points: number
  expiresAt?: Date | null
  orderId?: string | null
  referralId?: string | null
  rewardClaimId?: string | null
  membershipId?: string | null
  sourceMovementId?: string | null
  ruleSnapshot?: Prisma.InputJsonValue | null
  reason?: string | null
  idempotencyKey?: string | null
}

/**
 * Escribe UN movimiento y actualiza la caché de la cuenta con él, en el mismo
 * bloque. La caché nunca se escribe sin el movimiento que la explica.
 */
export async function movimientoDePuntosEnTx(
  tx: Tx,
  cuenta: CuentaBloqueada,
  d: DatosMovimiento,
  actorId: string | null
): Promise<{ id: string; cuenta: CuentaBloqueada }> {
  const available = cuenta.available + (d.availableDelta ?? 0)
  const pending = cuenta.pending + (d.pendingDelta ?? 0)
  const reserved = cuenta.reserved + (d.reservedDelta ?? 0)
  const redeemed = cuenta.redeemed + (d.redeemedDelta ?? 0)
  const expired = cuenta.expired + (d.expiredDelta ?? 0)
  if (available < 0 || pending < 0 || reserved < 0 || redeemed < 0 || expired < 0) {
    fallo('PUNTOS_INCONSISTENTES', 'La cuenta de puntos quedaría en negativo.')
  }

  const mov = await tx.supplyV2PointsMovement.create({
    data: {
      accountId: cuenta.id,
      type: d.type,
      source: d.source,
      points: d.points,
      availableDelta: d.availableDelta ?? 0,
      pendingDelta: d.pendingDelta ?? 0,
      reservedDelta: d.reservedDelta ?? 0,
      redeemedDelta: d.redeemedDelta ?? 0,
      expiredDelta: d.expiredDelta ?? 0,
      availableAfter: available,
      pendingAfter: pending,
      reservedAfter: reserved,
      expiresAt: d.expiresAt ?? null,
      orderId: d.orderId ?? null,
      referralId: d.referralId ?? null,
      rewardClaimId: d.rewardClaimId ?? null,
      membershipId: d.membershipId ?? null,
      sourceMovementId: d.sourceMovementId ?? null,
      ruleSnapshot: d.ruleSnapshot ?? Prisma.JsonNull,
      reason: d.reason ?? null,
      actorId,
      idempotencyKey: d.idempotencyKey ?? null,
    },
    select: { id: true },
  })
  // El CHECK de la base rechaza aquí cualquier negativo que se cuele.
  await tx.supplyV2PointsAccount.update({ where: { id: cuenta.id }, data: { available, pending, reserved, redeemed, expired } })
  const actualizada: CuentaBloqueada = { ...cuenta, available, pending, reserved, redeemed, expired }
  return { id: mov.id, cuenta: actualizada }
}

/** Lotes con puntos disponibles sin consumir, en una cuenta. */
export async function lotesDisponiblesEnTx(tx: Tx, accountId: string): Promise<LoteDePuntos[]> {
  const filas = await tx.supplyV2PointsMovement.findMany({
    where: { accountId, type: { in: [...TIPOS_QUE_ABREN_LOTE] }, availableDelta: { gt: 0 } },
    select: { id: true, availableDelta: true, consumedFromLot: true, expiresAt: true },
    orderBy: { createdAt: 'asc' },
  })
  return filas
    .map((f) => ({ id: f.id, points: f.availableDelta, consumedFromLot: f.consumedFromLot, expiresAt: f.expiresAt }))
    .filter((l) => l.points - l.consumedFromLot > 0)
}

async function marcarConsumoDeLotes(tx: Tx, plan: { loteId: string; puntos: number }[]): Promise<void> {
  for (const c of plan) {
    await tx.supplyV2PointsMovement.update({
      where: { id: c.loteId },
      data: { consumedFromLot: { increment: c.puntos } },
    })
  }
}

// ── Acumulación (§27) ──────────────────────────────────────────────────────

export interface PuntosAcumulados {
  programId: string
  puntos: number
  pendientes: boolean
  movimientoId: string | null
  repetido: boolean
}

/**
 * Puntos por una compra confirmada. Se llama desde la confirmación del pago,
 * en la misma transacción.
 *
 * La REGLA SE CONGELA en el movimiento (`ruleSnapshot`): cambiarla mañana no
 * reescribe lo que alguien ya ganó (§27). Y la clave de idempotencia impide
 * que un reintento de la confirmación sume dos veces (§26).
 */
export async function acumularPorCompraEnTx(
  tx: Tx,
  d: { orderId: string; programId: string },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<PuntosAcumulados | null> {
  const clave = `compra:${d.orderId}:programa:${d.programId}`
  const previo = await tx.supplyV2PointsMovement.findUnique({ where: { idempotencyKey: clave }, select: { id: true, points: true, type: true, account: { select: { programId: true } } } })
  if (previo) {
    return { programId: previo.account.programId, puntos: previo.points, pendientes: previo.type === 'PENDING', movimientoId: previo.id, repetido: true }
  }

  const programa = await tx.supplyV2LoyaltyProgram.findUnique({
    where: { id: d.programId },
    select: { id: true, status: true, startsAt: true, endsAt: true, modalities: true, pointsPerUnit: true, amountPerPoint: true, accrualBasis: true, pointsExpireDays: true, pointsHoldDays: true, supplier: { select: { companyId: true } } },
  })
  if (!programa) return null
  if (!programa.modalities.includes('POINTS') || programa.pointsPerUnit == null || programa.amountPerPoint == null) return null
  if (programa.status !== 'ACTIVE') return null
  if (programa.startsAt > ahora) return null
  if (programa.endsAt && programa.endsAt <= ahora) return null

  const orden = await tx.supplyV2CustomerOrder.findUniqueOrThrow({
    where: { id: d.orderId },
    select: { id: true, customerId: true, status: true, total: true, contractualValue: true },
  })
  if (orden.status !== 'PAID') return null

  const regla: ReglaDeAcumulacion = {
    pointsPerUnit: programa.pointsPerUnit,
    amountPerPoint: programa.amountPerPoint,
    basis: programa.accrualBasis,
  }
  // §13 del Slice 6: `total` es lo que paga el cliente y `contractualValue` lo
  // que vale la venta. No son lo mismo cuando hubo bono, y por eso el
  // programa elige sobre cuál acumula.
  const contractual = orden.contractualValue.greaterThan(0) ? orden.contractualValue : orden.total
  const vivas = await membresiasVivasEnTx(tx, programa.id, orden.customerId, ahora)
  const multiplicador = multiplicadorDeMembresias(vivas.flatMap((m) => m.plan.benefits.map((b) => b.pointsMultiplier)))
  const puntos = puntosPorCompra(regla, { contractualValue: contractual, customerPaid: orden.total }, multiplicador)
  if (puntos <= 0) return null

  const cuenta = await cuentaDePuntosEnTx(tx, programa.id, orden.customerId)
  const pendientes = programa.pointsHoldDays > 0
  const expiresAt = vencimientoDeLote(ahora, programa.pointsExpireDays)
  const foto: Prisma.InputJsonValue = {
    pointsPerUnit: regla.pointsPerUnit,
    amountPerPoint: regla.amountPerPoint.toFixed(2),
    basis: regla.basis,
    multiplicador: multiplicador.toFixed(2),
    baseUsada: (regla.basis === 'CUSTOMER_PAID' ? orden.total : contractual).toFixed(2),
    pointsHoldDays: programa.pointsHoldDays,
    pointsExpireDays: programa.pointsExpireDays,
  }

  const { id, cuenta: despues } = await movimientoDePuntosEnTx(
    tx,
    cuenta,
    {
      type: pendientes ? 'PENDING' : 'EARNED',
      source: 'PURCHASE',
      points: puntos,
      ...(pendientes ? { pendingDelta: puntos } : { availableDelta: puntos }),
      expiresAt,
      orderId: orden.id,
      membershipId: vivas[0]?.id ?? null,
      ruleSnapshot: foto,
      idempotencyKey: clave,
    },
    ctx.actorId
  )

  await eventoDePrograma(tx, programa.id, pendientes ? 'POINTS_EARNED' : 'POINTS_AVAILABLE', { puntos, orderId: orden.id, pendientes, saldo: despues.available }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_POINTS_EARNED', 'SupplyV2PointsMovement', id, { programId: programa.id, customerId: orden.customerId, puntos, pendientes, regla: foto }, programa.supplier?.companyId ?? null)
  return { programId: programa.id, puntos, pendientes, movimientoId: id, repetido: false }
}

/** Acumula en TODOS los programas de puntos que cubran esta compra. */
export async function acumularPorCompraEnTodosEnTx(tx: Tx, orderId: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<PuntosAcumulados[]> {
  const orden = await tx.supplyV2CustomerOrder.findUnique({
    where: { id: orderId },
    select: { id: true, kind: true, membershipPlanId: true, lines: { select: { offer: { select: { supplierId: true } } } } },
  })
  if (!orden) return []
  const proveedores = new Set(orden.lines.map((l) => l.offer.supplierId))
  if (orden.kind === 'MEMBERSHIP' && orden.membershipPlanId) {
    const plan = await tx.supplyV2MembershipPlan.findUnique({ where: { id: orden.membershipPlanId }, select: { program: { select: { supplierId: true } } } })
    if (plan?.program.supplierId) proveedores.add(plan.program.supplierId)
  }
  const programas = await tx.supplyV2LoyaltyProgram.findMany({
    where: { status: 'ACTIVE', modalities: { has: 'POINTS' }, OR: [{ owner: 'MEMBEGO' }, { supplierId: { in: [...proveedores] } }] },
    select: { id: true },
  })
  const salida: PuntosAcumulados[] = []
  for (const p of programas) {
    const r = await acumularPorCompraEnTx(tx, { orderId, programId: p.id }, ctx, ahora)
    if (r) salida.push(r)
  }
  return salida
}

/**
 * Una compra que se cae NO deja puntos (§28). Devuelve lo que todavía esté en
 * pendiente o disponible; lo ya gastado no se puede retirar, y la cuenta
 * nunca queda negativa.
 */
export async function reversarPuntosDeCompraEnTx(tx: Tx, orderId: string, motivo: string, ctx: ContextoAuditoria): Promise<number> {
  const movs = await tx.supplyV2PointsMovement.findMany({
    where: { orderId, type: { in: ['EARNED', 'PENDING'] } },
    select: { id: true, points: true, type: true, accountId: true, account: { select: { programId: true, customerId: true } } },
  })
  let reversados = 0
  for (const m of movs) {
    const yaReversado = await tx.supplyV2PointsMovement.count({ where: { sourceMovementId: m.id, type: 'REVERSED' } })
    if (yaReversado > 0) continue
    const cuenta = await cuentaDePuntosEnTx(tx, m.account.programId, m.account.customerId)
    const desdePendiente = m.type === 'PENDING' ? Math.min(cuenta.pending, m.points) : 0
    const desdeDisponible = m.type === 'EARNED' ? Math.min(cuenta.available, m.points) : 0
    const total = desdePendiente + desdeDisponible
    if (total <= 0) continue
    // Se marca el lote como consumido para que no se pueda gastar después.
    if (desdeDisponible > 0) await marcarConsumoDeLotes(tx, [{ loteId: m.id, puntos: desdeDisponible }])
    await movimientoDePuntosEnTx(
      tx,
      cuenta,
      {
        type: 'REVERSED',
        source: 'PURCHASE',
        points: total,
        availableDelta: -desdeDisponible,
        pendingDelta: -desdePendiente,
        orderId,
        sourceMovementId: m.id,
        reason: motivo,
      },
      ctx.actorId
    )
    reversados += total
  }
  return reversados
}

// ── Pendientes → disponibles, y vencimiento (§28, §29) ─────────────────────

/** Los puntos pendientes maduran cuando pasa el plazo del programa. */
export async function liberarPendientesEnTx(tx: Tx, ctx: ContextoAuditoria, ahora = new Date(), limite = 200): Promise<number> {
  const candidatos = await tx.supplyV2PointsMovement.findMany({
    where: { type: 'PENDING', pendingDelta: { gt: 0 } },
    select: { id: true, points: true, pendingDelta: true, consumedFromLot: true, expiresAt: true, accountId: true, orderId: true, account: { select: { programId: true, customerId: true, program: { select: { pointsHoldDays: true } } } } },
    orderBy: { createdAt: 'asc' },
    take: limite,
  })
  let liberados = 0
  for (const c of candidatos) {
    const ya = await tx.supplyV2PointsMovement.count({ where: { sourceMovementId: c.id, type: { in: ['AVAILABLE', 'REVERSED'] } } })
    if (ya > 0) continue
    const mov = await tx.supplyV2PointsMovement.findUniqueOrThrow({ where: { id: c.id }, select: { createdAt: true } })
    if (sumarDias(mov.createdAt, c.account.program.pointsHoldDays) > ahora) continue
    const cuenta = await cuentaDePuntosEnTx(tx, c.account.programId, c.account.customerId)
    if (cuenta.pending < c.pendingDelta) continue
    await movimientoDePuntosEnTx(
      tx,
      cuenta,
      {
        type: 'AVAILABLE',
        source: 'PURCHASE',
        points: c.pendingDelta,
        availableDelta: c.pendingDelta,
        pendingDelta: -c.pendingDelta,
        expiresAt: c.expiresAt,
        orderId: c.orderId,
        sourceMovementId: c.id,
      },
      null
    )
    await eventoDePrograma(tx, c.account.programId, 'POINTS_AVAILABLE', { puntos: c.pendingDelta, desde: c.id }, null)
    liberados += c.pendingDelta
  }
  return liberados
}

/** Vence los lotes caducados. Vencer en un programa no toca los demás (§29). */
export async function vencerPuntosEnTx(tx: Tx, ctx: ContextoAuditoria, ahora = new Date(), limite = 200): Promise<number> {
  const lotes = await tx.supplyV2PointsMovement.findMany({
    where: { type: { in: [...TIPOS_QUE_ABREN_LOTE] }, availableDelta: { gt: 0 }, expiresAt: { lte: ahora } },
    select: { id: true, availableDelta: true, consumedFromLot: true, accountId: true, account: { select: { programId: true, customerId: true } } },
    orderBy: { expiresAt: 'asc' },
    take: limite,
  })
  let vencidos = 0
  for (const l of lotes) {
    const resto = l.availableDelta - l.consumedFromLot
    if (resto <= 0) continue
    const cuenta = await cuentaDePuntosEnTx(tx, l.account.programId, l.account.customerId)
    const aVencer = Math.min(resto, cuenta.available)
    if (aVencer <= 0) continue
    await marcarConsumoDeLotes(tx, [{ loteId: l.id, puntos: aVencer }])
    await movimientoDePuntosEnTx(
      tx,
      cuenta,
      { type: 'EXPIRED', source: 'PROMOTION', points: aVencer, availableDelta: -aVencer, expiredDelta: aVencer, sourceMovementId: l.id, reason: 'Vencimiento del lote de puntos' },
      null
    )
    await eventoDePrograma(tx, l.account.programId, 'POINTS_EXPIRED', { puntos: aVencer, lote: l.id }, null)
    vencidos += aVencer
  }
  return vencidos
}

// ── Reserva y canje (§29, §31) ─────────────────────────────────────────────

export interface ReservaDePuntos {
  movimientoId: string
  puntos: number
  consumos: { loteId: string; puntos: number }[]
}

/**
 * Aparta puntos para una reclamación. La cuenta ya viene bloqueada, así que
 * dos canjes por los últimos puntos se serializan: el segundo ve el saldo ya
 * rebajado y no alcanza.
 *
 * Consume SIEMPRE por el lote que vence antes (§29).
 */
export async function reservarPuntosEnTx(
  tx: Tx,
  cuenta: CuentaBloqueada,
  d: { puntos: number; rewardClaimId?: string | null; referralId?: string | null; reason?: string | null },
  ctx: ContextoAuditoria
): Promise<ReservaDePuntos> {
  if (!Number.isInteger(d.puntos) || d.puntos <= 0) fallo('PUNTOS_INVALIDOS', 'Los puntos a reservar tienen que ser un entero positivo.')
  if (cuenta.available < d.puntos) {
    fallo('PUNTOS_INSUFICIENTES', `No alcanzan los puntos: hacen falta ${d.puntos} y hay ${cuenta.available}.`)
  }
  const lotes = await lotesDisponiblesEnTx(tx, cuenta.id)
  const plan = consumirPorVencimiento(lotes, d.puntos)
  if (!plan) fallo('PUNTOS_INSUFICIENTES', `No alcanzan los puntos: hacen falta ${d.puntos}.`)
  await marcarConsumoDeLotes(tx, plan)
  const { id } = await movimientoDePuntosEnTx(
    tx,
    cuenta,
    {
      type: 'RESERVED',
      source: 'REWARD',
      points: d.puntos,
      availableDelta: -d.puntos,
      reservedDelta: d.puntos,
      rewardClaimId: d.rewardClaimId ?? null,
      referralId: d.referralId ?? null,
      sourceMovementId: plan[0]?.loteId ?? null,
      reason: d.reason ?? null,
    },
    ctx.actorId
  )
  return { movimientoId: id, puntos: d.puntos, consumos: plan }
}

/** Reservado → canjeado: la recompensa se creó de verdad. */
export async function consumirReservaDePuntosEnTx(tx: Tx, cuenta: CuentaBloqueada, d: { puntos: number; rewardClaimId: string }, ctx: ContextoAuditoria): Promise<void> {
  if (cuenta.reserved < d.puntos) fallo('RESERVA_INCONSISTENTE', 'No hay tantos puntos reservados.')
  await movimientoDePuntosEnTx(
    tx,
    cuenta,
    { type: 'REDEEMED', source: 'REWARD', points: d.puntos, reservedDelta: -d.puntos, redeemedDelta: d.puntos, rewardClaimId: d.rewardClaimId },
    ctx.actorId
  )
}

/**
 * Devuelve unos puntos reservados que no llegaron a gastarse: si no se pudo
 * crear la recompensa, los puntos vuelven (§31). Los lotes de los que
 * salieron recuperan su saldo.
 */
export async function liberarReservaDePuntosEnTx(
  tx: Tx,
  cuenta: CuentaBloqueada,
  d: { puntos: number; rewardClaimId: string; consumos?: { loteId: string; puntos: number }[]; motivo: string },
  ctx: ContextoAuditoria
): Promise<void> {
  if (cuenta.reserved < d.puntos) fallo('RESERVA_INCONSISTENTE', 'No hay tantos puntos reservados.')
  const consumos = d.consumos ?? (await consumosDeLaReservaEnTx(tx, d.rewardClaimId))
  for (const c of consumos) {
    await tx.supplyV2PointsMovement.update({ where: { id: c.loteId }, data: { consumedFromLot: { decrement: c.puntos } } })
  }
  await movimientoDePuntosEnTx(
    tx,
    cuenta,
    { type: 'RELEASED', source: 'REWARD', points: d.puntos, availableDelta: d.puntos, reservedDelta: -d.puntos, rewardClaimId: d.rewardClaimId, reason: d.motivo },
    ctx.actorId
  )
}

/** De qué lotes salió la reserva de una reclamación, para poder devolverlos. */
async function consumosDeLaReservaEnTx(tx: Tx, rewardClaimId: string): Promise<{ loteId: string; puntos: number }[]> {
  const r = await tx.supplyV2PointsMovement.findFirst({
    where: { rewardClaimId, type: 'RESERVED' },
    select: { points: true, sourceMovementId: true },
    orderBy: { createdAt: 'desc' },
  })
  return r?.sourceMovementId ? [{ loteId: r.sourceMovementId, puntos: r.points }] : []
}

// ── Puntos por un referido validado y ajustes a mano ───────────────────────

export async function acreditarPuntosEnTx(
  tx: Tx,
  d: { programId: string; customerId: string; puntos: number; source: SupplyV2PointsSource; referralId?: string | null; reason?: string | null; idempotencyKey?: string | null },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<{ movimientoId: string; repetido: boolean }> {
  if (!Number.isInteger(d.puntos) || d.puntos <= 0) fallo('PUNTOS_INVALIDOS', 'Los puntos tienen que ser un entero positivo.')
  if (d.idempotencyKey) {
    const previo = await tx.supplyV2PointsMovement.findUnique({ where: { idempotencyKey: d.idempotencyKey }, select: { id: true } })
    if (previo) return { movimientoId: previo.id, repetido: true }
  }
  const programa = await tx.supplyV2LoyaltyProgram.findUniqueOrThrow({ where: { id: d.programId }, select: { pointsExpireDays: true, supplier: { select: { companyId: true } } } })
  const cuenta = await cuentaDePuntosEnTx(tx, d.programId, d.customerId)
  const { id } = await movimientoDePuntosEnTx(
    tx,
    cuenta,
    {
      type: 'EARNED',
      source: d.source,
      points: d.puntos,
      availableDelta: d.puntos,
      expiresAt: vencimientoDeLote(ahora, programa.pointsExpireDays),
      referralId: d.referralId ?? null,
      reason: d.reason ?? null,
      idempotencyKey: d.idempotencyKey ?? null,
    },
    ctx.actorId
  )
  await eventoDePrograma(tx, d.programId, 'POINTS_EARNED', { puntos: d.puntos, source: d.source, referralId: d.referralId ?? null }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_POINTS_EARNED', 'SupplyV2PointsMovement', id, { programId: d.programId, customerId: d.customerId, puntos: d.puntos, source: d.source }, programa.supplier?.companyId ?? null)
  return { movimientoId: id, repetido: false }
}

/**
 * AJUSTE MANUAL (§43). Exige motivo escrito y actor; lo repite un CHECK de la
 * base. Nunca se borra un movimiento para tapar un error: se escribe otro.
 */
export async function ajustarPuntosEnTx(
  tx: Tx,
  d: { programId: string; customerId: string; puntos: number; motivo: string },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<{ movimientoId: string; saldo: number }> {
  const error = validarAjusteDePuntos({ puntos: d.puntos, motivo: d.motivo, actorId: ctx.actorId })
  if (error) fallo('AJUSTE_INVALIDO', error)
  const programa = await tx.supplyV2LoyaltyProgram.findUniqueOrThrow({ where: { id: d.programId }, select: { pointsExpireDays: true, supplier: { select: { companyId: true } } } })
  const cuenta = await cuentaDePuntosEnTx(tx, d.programId, d.customerId)

  if (d.puntos < 0) {
    const quitar = Math.min(-d.puntos, cuenta.available)
    if (quitar <= 0) fallo('SIN_PUNTOS_QUE_QUITAR', 'Esta persona no tiene puntos disponibles que quitar.')
    const lotes = await lotesDisponiblesEnTx(tx, cuenta.id)
    const plan = consumirPorVencimiento(lotes, quitar)
    if (plan) await marcarConsumoDeLotes(tx, plan)
    const { id, cuenta: despues } = await movimientoDePuntosEnTx(
      tx,
      cuenta,
      { type: 'ADMIN_ADJUSTMENT', source: 'ADMIN', points: quitar, availableDelta: -quitar, reason: d.motivo.trim(), sourceMovementId: plan?.[0]?.loteId ?? null },
      ctx.actorId
    )
    await eventoDePrograma(tx, d.programId, 'POINTS_ADJUSTED', { puntos: -quitar, motivo: d.motivo.trim() }, ctx.actorId)
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_POINTS_ADJUSTED', 'SupplyV2PointsMovement', id, { programId: d.programId, customerId: d.customerId, puntos: -quitar, motivo: d.motivo.trim() }, programa.supplier?.companyId ?? null)
    return { movimientoId: id, saldo: despues.available }
  }

  const { id, cuenta: despues } = await movimientoDePuntosEnTx(
    tx,
    cuenta,
    { type: 'ADMIN_ADJUSTMENT', source: 'ADMIN', points: d.puntos, availableDelta: d.puntos, expiresAt: vencimientoDeLote(ahora, programa.pointsExpireDays), reason: d.motivo.trim() },
    ctx.actorId
  )
  await eventoDePrograma(tx, d.programId, 'POINTS_ADJUSTED', { puntos: d.puntos, motivo: d.motivo.trim() }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_POINTS_ADJUSTED', 'SupplyV2PointsMovement', id, { programId: d.programId, customerId: d.customerId, puntos: d.puntos, motivo: d.motivo.trim() }, programa.supplier?.companyId ?? null)
  return { movimientoId: id, saldo: despues.available }
}

// ── Reconstrucción (§25) ───────────────────────────────────────────────────

/**
 * Reconstruye la cuenta desde sus movimientos. La caché tiene que dar
 * EXACTAMENTE esto; si no, alguien escribió un saldo sin su movimiento.
 */
export async function saldoReconstruidoEnTx(tx: Tx, accountId: string) {
  const movs = await tx.supplyV2PointsMovement.findMany({
    where: { accountId },
    select: { availableDelta: true, pendingDelta: true, reservedDelta: true, redeemedDelta: true, expiredDelta: true },
  })
  return saldoDeMovimientosPuntos(movs)
}

/** Valor medio observado por punto canjeado, para la estimación del §37. */
export async function valorMedioPorPuntoEnTx(tx: Tx, programId: string): Promise<Prisma.Decimal> {
  const entregadas = await tx.supplyV2RewardClaim.aggregate({
    where: { programId, status: 'DELIVERED' },
    _sum: { cost: true, pointsConsumed: true },
  })
  const puntos = entregadas._sum.pointsConsumed ?? 0
  const costo = entregadas._sum.cost ?? new Prisma.Decimal(0)
  if (puntos <= 0) return new Prisma.Decimal(0)
  return decimal(costo).dividedBy(puntos).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
}
