import { Prisma } from '@prisma/client'
import type { SupplyV2CustomerMembershipStatus } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { vencimientoDeReserva } from '../core/config'
import { fallo } from '../core/errores'
import { exigirTransicion } from '../core/estados'
import { siguienteNumero } from '../core/numeracion'
import { asignarBeneficioEnTx } from '../benefits/service'
import { generarCuponesEnTx } from '../campaigns/coupons'
import {
  estadoAlActivar,
  MENSAJES_NO_CONTRATABLE,
  motivoNoContratable,
  TRANSICIONES_MEMBRESIA,
  ventanaDeMembresia,
  type PlanParaContratar,
  type SituacionDelCliente,
} from './domain'
import { bloquearPlan, bloquearPrograma, eventoDePrograma } from './programs'

/**
 * MEMBEGO SUPPLY · SLICE 8 · MOTOR DE MEMBRESÍAS (§9–§17).
 *
 * Tres formas de tener una membresía, un solo sitio donde se escribe:
 *
 *   GRATUITA   el cliente se inscribe y queda ACTIVE en el acto.
 *   DE PAGO    pasa por el CHECKOUT de los Slices 2–6: nace un
 *              `SupplyV2CustomerOrder` de `kind = MEMBERSHIP`, sin líneas, sin
 *              lote y sin allocation —no se simula con inventario ficticio—, y
 *              la membresía nace PENDING_PAYMENT. La activa la confirmación
 *              del pago, nunca antes.
 *   OTORGADA   Membego o el negocio la conceden, con motivo escrito.
 *
 * Orden de candados: PROGRAMA → PLAN → MEMBRESÍA. El mismo del resto del
 * slice, para no cruzarse con un checkout en curso.
 *
 * NO SE ACTIVA UNA MEMBRESÍA DE PAGO ANTES DE COBRARLA (§12). La única puerta
 * es `activarMembresiaPorPagoEnTx`, y la llama la confirmación del pago.
 */

async function bloquearMembresia(tx: Tx, membershipId: string) {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_customer_memberships" WHERE "id" = ${membershipId} FOR UPDATE`
  const m = await tx.supplyV2CustomerMembership.findUnique({
    where: { id: membershipId },
    include: { plan: { select: { id: true, name: true, durationDays: true, kind: true } }, program: { select: { id: true, supplierId: true, supplier: { select: { companyId: true } } } } },
  })
  if (!m) fallo('MEMBRESIA_NO_ENCONTRADA', 'Esa membresía no existe.')
  return m
}

/**
 * Bloquea TODAS las membresías vivas del cliente en ese plan y devuelve su
 * situación. El candado es lo que hace que dos compras simultáneas se
 * serialicen; los índices únicos parciales son la red por debajo.
 */
async function situacionEnTx(tx: Tx, planId: string, customerId: string): Promise<SituacionDelCliente & { vencimientoMasLejano: Date | null }> {
  await tx.$queryRaw`
    SELECT "id" FROM "supply_v2_customer_memberships"
    WHERE "planId" = ${planId} AND "customerId" = ${customerId}
      AND "status" IN ('PENDING_PAYMENT','SCHEDULED','ACTIVE','SUSPENDED')
    FOR UPDATE`
  const vivas = await tx.supplyV2CustomerMembership.findMany({
    where: { planId, customerId, status: { in: ['PENDING_PAYMENT', 'SCHEDULED', 'ACTIVE', 'SUSPENDED'] } },
    select: { status: true, expiresAt: true },
  })
  const miembrosDelPlan = await tx.supplyV2CustomerMembership.count({
    where: { planId, status: { in: ['ACTIVE', 'SCHEDULED', 'SUSPENDED'] } },
  })
  let masLejano: Date | null = null
  for (const v of vivas) {
    if (v.expiresAt && (!masLejano || v.expiresAt > masLejano)) masLejano = v.expiresAt
  }
  return {
    sinPagar: vivas.filter((v) => v.status === 'PENDING_PAYMENT').length,
    programadas: vivas.filter((v) => v.status === 'SCHEDULED').length,
    activas: vivas.filter((v) => v.status === 'ACTIVE' || v.status === 'SUSPENDED').length,
    miembrosDelPlan,
    vencimientoMasLejano: masLejano,
  }
}

async function siguienteCodigo(tx: Tx, fecha: Date): Promise<string> {
  return siguienteNumero(
    tx,
    'MBG-MS',
    async (prefijo) => {
      const u = await tx.supplyV2CustomerMembership.findFirst({ where: { code: { startsWith: prefijo } }, orderBy: { code: 'desc' }, select: { code: true } })
      return u?.code ?? null
    },
    fecha
  )
}

async function exigirCliente(tx: Tx, customerId: string): Promise<void> {
  const c = await tx.user.findUnique({ where: { id: customerId }, select: { role: true } })
  if (!c || c.role !== 'CLIENTE') fallo('CLIENTE_NO_ENCONTRADO', 'El cliente no existe o no es un cliente de Membego.')
}

export interface MembresiaCreada {
  id: string
  code: string
  status: SupplyV2CustomerMembershipStatus
  /** Solo en las de pago: el pedido que hay que pagar. */
  orderId: string | null
  orderNumber: string | null
  total: string
  expiresAt: Date | null
  repetida: boolean
}

/**
 * Alta de una membresía. Decide sola el camino según el tipo del plan, para
 * que no haya tres puertas que puedan divergir.
 */
export async function contratarMembresiaEnTx(
  tx: Tx,
  d: { planId: string; customerId: string; idempotencyKey?: string | null },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<MembresiaCreada> {
  await exigirCliente(tx, d.customerId)

  if (d.idempotencyKey) {
    const previa = await tx.supplyV2CustomerMembership.findUnique({
      where: { idempotencyKey: d.idempotencyKey },
      select: { id: true, code: true, status: true, customerId: true, orderId: true, pricePaid: true, expiresAt: true, order: { select: { number: true } } },
    })
    if (previa) {
      if (previa.customerId !== d.customerId) fallo('CLAVE_AJENA', 'Esa compra no es tuya.')
      return {
        id: previa.id,
        code: previa.code,
        status: previa.status,
        orderId: previa.orderId,
        orderNumber: previa.order?.number ?? null,
        total: previa.pricePaid.toFixed(2),
        expiresAt: previa.expiresAt,
        repetida: true,
      }
    }
  }

  const plan = await bloquearPlan(tx, d.planId)
  const programa = await bloquearPrograma(tx, plan.programId)
  const s = await situacionEnTx(tx, plan.id, d.customerId)

  const paraContratar: PlanParaContratar = {
    status: plan.status,
    kind: plan.kind,
    maxMembers: plan.maxMembers,
    maxAdvanceRenewals: plan.maxAdvanceRenewals,
  }
  const motivo = motivoNoContratable(programa, paraContratar, s, ahora)
  if (motivo) fallo(motivo, MENSAJES_NO_CONTRATABLE[motivo])

  const ventana = ventanaDeMembresia(plan.durationDays, ahora, s.vencimientoMasLejano)
  const code = await siguienteCodigo(tx, ahora)
  const esRenovacion = s.activas > 0 || s.programadas > 0
  const companyId = programa.supplier?.companyId ?? null

  if (plan.kind === 'FREE') {
    const m = await tx.supplyV2CustomerMembership.create({
      data: {
        code,
        programId: programa.id,
        planId: plan.id,
        planVersion: plan.currentVersion,
        customerId: d.customerId,
        status: estadoAlActivar(ventana, ahora),
        purchasedAt: ahora,
        activatedAt: ventana.activatedAt,
        expiresAt: ventana.expiresAt,
        pricePaid: new Prisma.Decimal(0),
        currency: plan.currency,
        renewalCount: esRenovacion ? 1 : 0,
        idempotencyKey: d.idempotencyKey ?? null,
      },
      select: { id: true, code: true, status: true, expiresAt: true },
    })
    if (m.status === 'ACTIVE') await concederBeneficiosDePlanEnTx(tx, m.id, ctx)
    await eventoDePrograma(tx, programa.id, 'MEMBERSHIP_STARTED', { code, planId: plan.id, kind: 'FREE', status: m.status }, ctx.actorId, { membershipId: m.id })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_MEMBERSHIP_STARTED', 'SupplyV2CustomerMembership', m.id, { code, planId: plan.id, kind: 'FREE' }, companyId)
    return { id: m.id, code: m.code, status: m.status, orderId: null, orderNumber: null, total: '0.00', expiresAt: m.expiresAt, repetida: false }
  }

  if (plan.kind === 'GRANTED') {
    fallo('SOLO_OTORGADA', MENSAJES_NO_CONTRATABLE.SOLO_OTORGADA)
  }

  // ── DE PAGO: pasa por el checkout, sin lote ni inventario ──
  const numero = await siguienteNumero(
    tx,
    'MBG-SO',
    async (prefijo) => {
      const u = await tx.supplyV2CustomerOrder.findFirst({ where: { number: { startsWith: prefijo } }, orderBy: { number: 'desc' }, select: { number: true } })
      return u?.number ?? null
    },
    ahora
  )
  const orden = await tx.supplyV2CustomerOrder.create({
    data: {
      number: numero,
      customerId: d.customerId,
      currency: plan.currency,
      subtotal: plan.price,
      total: plan.price,
      status: 'PENDING',
      paymentStatus: 'UNPAID',
      expiresAt: vencimientoDeReserva(ahora),
      kind: 'MEMBERSHIP',
      membershipPlanId: plan.id,
      // Una membresía no la vende un proveedor a comisión: la vende el
      // programa. El valor contractual ES lo que paga el cliente.
      contractualValue: plan.price,
      idempotencyKey: d.idempotencyKey ? `membresia:${d.idempotencyKey}` : null,
    },
    select: { id: true, number: true },
  })

  const m = await tx.supplyV2CustomerMembership.create({
    data: {
      code,
      programId: programa.id,
      planId: plan.id,
      planVersion: plan.currentVersion,
      customerId: d.customerId,
      orderId: orden.id,
      status: 'PENDING_PAYMENT',
      purchasedAt: ahora,
      pricePaid: new Prisma.Decimal(0),
      currency: plan.currency,
      renewalCount: esRenovacion ? 1 : 0,
      idempotencyKey: d.idempotencyKey ?? null,
    },
    select: { id: true, code: true, status: true },
  })

  await eventoDePrograma(tx, programa.id, 'MEMBERSHIP_STARTED', { code, planId: plan.id, kind: 'PAID', orderId: orden.id, total: plan.price.toFixed(2) }, ctx.actorId, { membershipId: m.id })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_MEMBERSHIP_STARTED', 'SupplyV2CustomerMembership', m.id, { code, orderId: orden.id, number: orden.number, total: plan.price.toFixed(2) }, companyId)
  return { id: m.id, code: m.code, status: m.status, orderId: orden.id, orderNumber: orden.number, total: plan.price.toFixed(2), expiresAt: null, repetida: false }
}

/**
 * Membresía OTORGADA (§9): la concede Membego o el negocio. Exige motivo
 * escrito —lo sostiene también un CHECK— y no pasa por caja.
 */
export async function otorgarMembresiaEnTx(
  tx: Tx,
  d: { planId: string; customerId: string; motivo: string; dias?: number | null },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<MembresiaCreada> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Otorgar una membresía necesita quién la concede.')
  if (!d.motivo?.trim()) fallo('SIN_MOTIVO', 'Otorgar una membresía necesita un motivo escrito.')
  await exigirCliente(tx, d.customerId)

  const plan = await bloquearPlan(tx, d.planId)
  const programa = await bloquearPrograma(tx, plan.programId)
  if (programa.status !== 'ACTIVE') fallo('PROGRAMA_INACTIVO', 'El programa no está activo.')
  if (plan.status === 'ARCHIVED') fallo('PLAN_NO_DISPONIBLE', 'Ese plan está archivado.')

  const s = await situacionEnTx(tx, plan.id, d.customerId)
  if (s.activas > 0) fallo('YA_ES_MIEMBRO', 'Esta persona ya tiene una membresía viva de este plan.')

  const dias = d.dias ?? plan.durationDays
  if (!Number.isInteger(dias) || dias <= 0) fallo('DURACION_INVALIDA', 'La duración concedida tiene que ser un entero positivo de días.')
  const ventana = ventanaDeMembresia(dias, ahora, s.vencimientoMasLejano)
  const code = await siguienteCodigo(tx, ahora)

  const m = await tx.supplyV2CustomerMembership.create({
    data: {
      code,
      programId: programa.id,
      planId: plan.id,
      planVersion: plan.currentVersion,
      customerId: d.customerId,
      status: estadoAlActivar(ventana, ahora),
      purchasedAt: ahora,
      activatedAt: ventana.activatedAt,
      expiresAt: ventana.expiresAt,
      pricePaid: new Prisma.Decimal(0),
      currency: plan.currency,
      grantedById: ctx.actorId,
      grantReason: d.motivo.trim(),
    },
    select: { id: true, code: true, status: true, expiresAt: true },
  })
  if (m.status === 'ACTIVE') await concederBeneficiosDePlanEnTx(tx, m.id, ctx)

  const companyId = programa.supplier?.companyId ?? null
  await eventoDePrograma(tx, programa.id, 'MEMBERSHIP_GRANTED', { code, planId: plan.id, motivo: d.motivo.trim(), dias }, ctx.actorId, { membershipId: m.id })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_MEMBERSHIP_GRANTED', 'SupplyV2CustomerMembership', m.id, { code, planId: plan.id, motivo: d.motivo.trim(), dias }, companyId)
  return { id: m.id, code: m.code, status: m.status, orderId: null, orderNumber: null, total: '0.00', expiresAt: m.expiresAt, repetida: false }
}

/**
 * LA ÚNICA PUERTA que activa una membresía de pago (§12). La llama la
 * confirmación del pago del checkout, dentro de la MISMA transacción: si el
 * pago se deshace, la membresía no queda activa.
 *
 * Idempotente: una membresía ya activa se devuelve sin volver a conceder sus
 * beneficios.
 */
export async function activarMembresiaPorPagoEnTx(
  tx: Tx,
  orderId: string,
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<{ id: string; code: string; status: string; repetida: boolean } | null> {
  const m0 = await tx.supplyV2CustomerMembership.findUnique({ where: { orderId }, select: { id: true } })
  if (!m0) return null
  const m = await bloquearMembresia(tx, m0.id)
  if (m.status === 'ACTIVE' || m.status === 'SCHEDULED') return { id: m.id, code: m.code, status: m.status, repetida: true }

  const orden = await tx.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: orderId }, select: { paymentStatus: true, status: true, total: true } })
  if (orden.status !== 'PAID') fallo('PAGO_SIN_CONFIRMAR', 'Esta membresía no se activa hasta que el pago esté confirmado.')

  const s = await situacionEnTx(tx, m.planId, m.customerId)
  const ventana = ventanaDeMembresia(m.plan.durationDays, ahora, s.vencimientoMasLejano)
  const destino = estadoAlActivar(ventana, ahora)
  exigirTransicion(TRANSICIONES_MEMBRESIA, m.status, destino, 'Membresía')

  await tx.supplyV2CustomerMembership.update({
    where: { id: m.id },
    data: { status: destino, activatedAt: ventana.activatedAt, expiresAt: ventana.expiresAt, pricePaid: orden.total },
  })
  // Los beneficios se conceden cuando el período EMPIEZA, no cuando se paga:
  // un período comprado por adelantado no da sus usos antes de tiempo.
  if (destino === 'ACTIVE') await concederBeneficiosDePlanEnTx(tx, m.id, ctx)

  const companyId = m.program.supplier?.companyId ?? null
  const detalle = { code: m.code, status: destino, pricePaid: orden.total.toFixed(2), expiresAt: ventana.expiresAt.toISOString() }
  await eventoDePrograma(tx, m.programId, 'MEMBERSHIP_ACTIVATED', detalle, ctx.actorId, { membershipId: m.id })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_MEMBERSHIP_ACTIVATED', 'SupplyV2CustomerMembership', m.id, detalle, companyId)
  if (m.renewalCount > 0) {
    await eventoDePrograma(tx, m.programId, 'MEMBERSHIP_RENEWED', detalle, ctx.actorId, { membershipId: m.id })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_MEMBERSHIP_RENEWED', 'SupplyV2CustomerMembership', m.id, detalle, companyId)
  }
  return { id: m.id, code: m.code, status: destino, repetida: false }
}

/**
 * Concede al miembro lo que incluye su plan (§11): los beneficios del Slice 6
 * y, cuando toca, un cupón privado del Slice 7. No se crea NINGÚN descuento
 * nuevo. Idempotente: `asignarBeneficioEnTx` ya lo es por (beneficio, cliente).
 */
export async function concederBeneficiosDePlanEnTx(tx: Tx, membershipId: string, ctx: ContextoAuditoria): Promise<{ beneficios: number; cupones: number }> {
  const m = await tx.supplyV2CustomerMembership.findUniqueOrThrow({
    where: { id: membershipId },
    select: {
      id: true,
      planId: true,
      customerId: true,
      expiresAt: true,
      programId: true,
      grantedById: true,
      order: { select: { paymentConfirmedById: true } },
      program: { select: { approvedById: true, createdById: true } },
    },
  })

  // El BARRIDO no tiene actor: activa un período comprado por adelantado
  // cuando llega su fecha, sin que nadie pulse nada. Pero conceder un
  // beneficio sí exige quién lo concede (Slice 6), y con razón. Así que se
  // atribuye a quien de verdad lo autorizó —quien confirmó el pago, quien
  // otorgó la membresía o quien aprobó el programa—, en vez de relajar la
  // regla del Slice 6 o inventar un actor de sistema que no responde por nada.
  const actorEfectivo =
    ctx.actorId ?? m.grantedById ?? m.order?.paymentConfirmedById ?? m.program.approvedById ?? m.program.createdById
  const quien: ContextoAuditoria = { ...ctx, actorId: actorEfectivo }
  const incluidos = await tx.supplyV2MembershipBenefit.findMany({
    where: { planId: m.planId, kind: { in: ['BENEFIT', 'COUPON'] }, benefitId: { not: null } },
    select: { id: true, kind: true, benefitId: true, usesPerPeriod: true, grantsCoupon: true, benefit: { select: { id: true, campaignId: true, endsAt: true } } },
  })

  let beneficios = 0
  let cupones = 0
  for (const i of incluidos) {
    if (!i.benefitId || !i.benefit) continue
    // El beneficio del miembro no puede durar más que su membresía ni más que
    // el propio beneficio.
    let expira = m.expiresAt
    if (i.benefit.endsAt && (!expira || i.benefit.endsAt < expira)) expira = i.benefit.endsAt

    const asignacion = await asignarBeneficioEnTx(
      tx,
      { benefitId: i.benefitId, customerId: m.customerId, usesAllowed: i.usesPerPeriod ?? null, expiresAt: expira, note: `Incluido en la membresía ${m.id}` },
      quien
    )
    await tx.supplyV2CustomerBenefit.update({ where: { id: asignacion.id }, data: { membershipId: m.id } })
    if (!asignacion.repetida) beneficios++

    if (i.kind === 'COUPON' || i.grantsCoupon) {
      if (!i.benefit.campaignId) fallo('BENEFICIO_SIN_CAMPANA', 'Un cupón de membresía necesita que su promoción pertenezca a una campaña.')
      const yaTiene = await tx.supplyV2Coupon.count({ where: { benefitId: i.benefitId, customerId: m.customerId, status: { in: ['ACTIVE', 'EXHAUSTED'] } } })
      if (yaTiene === 0) {
        await generarCuponesEnTx(
          tx,
          { campaignId: i.benefit.campaignId, benefitId: i.benefitId, kind: 'PRIVATE', cantidad: 1, customerIds: [m.customerId], expiresAt: expira, lote: `Membresía ${m.id}` },
          quien
        )
        cupones++
      }
    }
  }
  return { beneficios, cupones }
}

// ── Ciclo de vida ──────────────────────────────────────────────────────────

export async function cancelarMembresiaEnTx(tx: Tx, membershipId: string, motivo: string, ctx: ContextoAuditoria): Promise<{ id: string; repetida: boolean }> {
  if (!motivo?.trim()) fallo('SIN_MOTIVO', 'Cancelar una membresía necesita un motivo.')
  const m = await bloquearMembresia(tx, membershipId)
  if (m.status === 'CANCELLED') return { id: m.id, repetida: true }
  exigirTransicion(TRANSICIONES_MEMBRESIA, m.status, 'CANCELLED', 'Membresía')
  await tx.supplyV2CustomerMembership.update({ where: { id: m.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: motivo.trim() } })
  await eventoDePrograma(tx, m.programId, 'MEMBERSHIP_CANCELLED', { code: m.code, motivo: motivo.trim() }, ctx.actorId, { membershipId: m.id })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_MEMBERSHIP_CANCELLED', 'SupplyV2CustomerMembership', m.id, { code: m.code, motivo: motivo.trim() }, m.program.supplier?.companyId ?? null)
  return { id: m.id, repetida: false }
}

export async function suspenderMembresiaEnTx(tx: Tx, membershipId: string, motivo: string, ctx: ContextoAuditoria): Promise<{ id: string }> {
  if (!motivo?.trim()) fallo('SIN_MOTIVO', 'Suspender una membresía necesita un motivo.')
  const m = await bloquearMembresia(tx, membershipId)
  exigirTransicion(TRANSICIONES_MEMBRESIA, m.status, 'SUSPENDED', 'Membresía')
  await tx.supplyV2CustomerMembership.update({ where: { id: m.id }, data: { status: 'SUSPENDED', suspendedAt: new Date() } })
  await eventoDePrograma(tx, m.programId, 'MEMBERSHIP_SUSPENDED', { code: m.code, motivo: motivo.trim() }, ctx.actorId, { membershipId: m.id })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_MEMBERSHIP_SUSPENDED', 'SupplyV2CustomerMembership', m.id, { code: m.code, motivo: motivo.trim() }, m.program.supplier?.companyId ?? null)
  return { id: m.id }
}

export async function reactivarMembresiaEnTx(tx: Tx, membershipId: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<{ id: string }> {
  const m = await bloquearMembresia(tx, membershipId)
  exigirTransicion(TRANSICIONES_MEMBRESIA, m.status, 'ACTIVE', 'Membresía')
  if (m.expiresAt && m.expiresAt <= ahora) fallo('YA_VENCIDA', 'Esa membresía ya venció: lo que toca es comprar un período nuevo.')
  await tx.supplyV2CustomerMembership.update({ where: { id: m.id }, data: { status: 'ACTIVE', suspendedAt: null } })
  await eventoDePrograma(tx, m.programId, 'MEMBERSHIP_ACTIVATED', { code: m.code, reactivada: true }, ctx.actorId, { membershipId: m.id })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_MEMBERSHIP_ACTIVATED', 'SupplyV2CustomerMembership', m.id, { code: m.code, reactivada: true }, m.program.supplier?.companyId ?? null)
  return { id: m.id }
}

/**
 * Cancela la membresía que colgaba de un pedido que se cayó (vencido,
 * cancelado o rechazado). Sin esto, una compra abandonada dejaría una
 * membresía PENDING_PAYMENT bloqueando la siguiente compra para siempre.
 */
export async function soltarMembresiaDeOrdenEnTx(tx: Tx, orderId: string, motivo: string, ctx: ContextoAuditoria): Promise<boolean> {
  const m0 = await tx.supplyV2CustomerMembership.findUnique({ where: { orderId }, select: { id: true, status: true } })
  if (!m0 || m0.status !== 'PENDING_PAYMENT') return false
  await cancelarMembresiaEnTx(tx, m0.id, motivo, ctx)
  return true
}

// ── Barrido (§13) ──────────────────────────────────────────────────────────

/** Activa los períodos comprados por adelantado cuyo turno ya llegó. */
export async function activarProgramadasEnTx(tx: Tx, ctx: ContextoAuditoria, ahora = new Date(), limite = 200): Promise<number> {
  const pendientes = await tx.supplyV2CustomerMembership.findMany({
    where: { status: 'SCHEDULED', activatedAt: { lte: ahora } },
    select: { id: true },
    take: limite,
  })
  let activadas = 0
  for (const p of pendientes) {
    const m = await bloquearMembresia(tx, p.id)
    if (m.status !== 'SCHEDULED' || !m.activatedAt || m.activatedAt > ahora) continue
    // Solo puede haber una ACTIVE por plan y persona. Si el período anterior
    // todavía no se cerró, este espera a la próxima pasada en vez de tumbar
    // el barrido entero con un choque contra el índice único.
    const anterior = await tx.supplyV2CustomerMembership.count({
      where: { planId: m.planId, customerId: m.customerId, status: 'ACTIVE', id: { not: m.id } },
    })
    if (anterior > 0) continue
    await tx.supplyV2CustomerMembership.update({ where: { id: m.id }, data: { status: 'ACTIVE' } })
    await concederBeneficiosDePlanEnTx(tx, m.id, ctx)
    await eventoDePrograma(tx, m.programId, 'MEMBERSHIP_ACTIVATED', { code: m.code, porBarrido: true }, null, { membershipId: m.id })
    activadas++
  }
  return activadas
}

/**
 * Vence las membresías cuyo período acabó. Vencer una NO toca las de otros
 * programas ni los puntos ganados: solo cierra ese período.
 */
export async function vencerMembresiasEnTx(tx: Tx, ctx: ContextoAuditoria, ahora = new Date(), limite = 200): Promise<number> {
  const caducadas = await tx.supplyV2CustomerMembership.findMany({
    where: { status: { in: ['ACTIVE', 'SUSPENDED'] }, expiresAt: { lte: ahora } },
    select: { id: true },
    take: limite,
  })
  let vencidas = 0
  for (const c of caducadas) {
    const m = await bloquearMembresia(tx, c.id)
    if (!['ACTIVE', 'SUSPENDED'].includes(m.status) || !m.expiresAt || m.expiresAt > ahora) continue
    await tx.supplyV2CustomerMembership.update({ where: { id: m.id }, data: { status: 'EXPIRED' } })
    await eventoDePrograma(tx, m.programId, 'MEMBERSHIP_EXPIRED', { code: m.code }, null, { membershipId: m.id })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_MEMBERSHIP_EXPIRED', 'SupplyV2CustomerMembership', m.id, { code: m.code }, m.program.supplier?.companyId ?? null)
    vencidas++
  }
  return vencidas
}

/** Membresías vivas de un cliente en un programa, para puntos y recompensas. */
export async function membresiasVivasEnTx(tx: Tx, programId: string, customerId: string, ahora = new Date()) {
  return tx.supplyV2CustomerMembership.findMany({
    where: { programId, customerId, status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: ahora } }] },
    select: { id: true, planId: true, plan: { select: { name: true, benefits: { where: { kind: 'POINTS_MULTIPLIER' }, select: { pointsMultiplier: true } } } } },
  })
}
