import { Prisma } from '@prisma/client'
import type { SupplyV2LoyaltyEventType, SupplyV2MembershipBenefitKind } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { personasAutorizadasEnTx } from '../core/autorizadas'
import { decimal } from '../core/dinero'
import { fallo } from '../core/errores'
import { exigirTransicion } from '../core/estados'
import { siguienteNumero } from '../core/numeracion'
import { MOTIVO_AUTOAPROBACION, revisarSegregacion } from '../core/segregacion'
import {
  exigeVersionNueva,
  TRANSICIONES_PLAN,
  TRANSICIONES_PROGRAMA,
  validarPlan,
  validarPrograma,
  type DatosPlan,
  type DatosPrograma,
} from './domain'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · PROGRAMAS Y PLANES (§4–§11, §14).
 *
 * TODO dentro de la `tx` de quien llama: aquí no se abre ninguna transacción.
 *
 * ORDEN DE CANDADOS del Slice 8, que extiende por arriba el del Slice 7 para
 * no provocar un abrazo mortal con un checkout en curso:
 *
 *   PROGRAMA → PLAN → MEMBRESÍA → CUENTA DE PUNTOS → RECOMPENSA
 *            → (CUPÓN → CAMPAÑA → BENEFICIO → ASIGNACIÓN)   ← Slice 6 y 7
 *
 * Nadie toma un candado de la derecha y después uno de la izquierda.
 */

export async function bloquearPrograma(tx: Tx, programId: string) {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_loyalty_programs" WHERE "id" = ${programId} FOR UPDATE`
  const p = await tx.supplyV2LoyaltyProgram.findUnique({
    where: { id: programId },
    include: { supplier: { select: { companyId: true } } },
  })
  if (!p) fallo('PROGRAMA_NO_ENCONTRADO', 'El programa no existe.')
  return p
}

export async function bloquearPlan(tx: Tx, planId: string) {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_membership_plans" WHERE "id" = ${planId} FOR UPDATE`
  const p = await tx.supplyV2MembershipPlan.findUnique({
    where: { id: planId },
    include: { program: { select: { id: true, status: true, startsAt: true, endsAt: true, currency: true, supplierId: true, owner: true } } },
  })
  if (!p) fallo('PLAN_NO_ENCONTRADO', 'El plan no existe.')
  return p
}

/** Bitácora propia del programa. No se borra nunca (§43). */
export async function eventoDePrograma(
  tx: Tx,
  programId: string,
  type: SupplyV2LoyaltyEventType,
  payload: Prisma.InputJsonValue,
  actorId: string | null,
  refs: { membershipId?: string | null; referralId?: string | null; rewardClaimId?: string | null } = {}
): Promise<void> {
  await tx.supplyV2LoyaltyEvent.create({
    data: {
      programId,
      type,
      membershipId: refs.membershipId ?? null,
      referralId: refs.referralId ?? null,
      rewardClaimId: refs.rewardClaimId ?? null,
      payload,
      actorId,
    },
  })
}

/**
 * ¿Puede este actor tocar este programa? (§8)
 *
 * La plataforma supervisa todos. Un proveedor administra ÚNICAMENTE los
 * suyos: participar en un programa global no le da acceso a administrarlo, ni
 * a ver los datos de nadie más.
 */
export function exigirPropiedadDePrograma(
  p: { owner: string; supplierId: string | null },
  actor: { esPlataforma: boolean; supplierId: string | null }
): void {
  if (actor.esPlataforma) return
  if (!actor.supplierId || p.owner !== 'SUPPLIER' || p.supplierId !== actor.supplierId) {
    fallo('PROGRAMA_AJENO', 'Este programa es de otro negocio.')
  }
}

// ── Programas ──────────────────────────────────────────────────────────────

export interface ProgramaCreado {
  id: string
  code: string
  status: string
}

export async function crearProgramaEnTx(tx: Tx, d: DatosPrograma, ctx: ContextoAuditoria): Promise<ProgramaCreado> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Un programa necesita quién lo crea.')
  const error = validarPrograma(d)
  if (error) fallo('PROGRAMA_INVALIDO', error)

  let currency = d.currency?.trim() || 'DOP'
  let companyId: string | null = null
  if (d.supplierId) {
    const s = await tx.supplyV2Supplier.findUnique({
      where: { id: d.supplierId },
      select: { id: true, status: true, currency: true, companyId: true },
    })
    if (!s) fallo('PROVEEDOR_NO_ENCONTRADO', 'El negocio no existe.')
    if (s.status !== 'ACTIVE') fallo('PROVEEDOR_INACTIVO', 'El negocio no está activo.')
    currency = s.currency
    companyId = s.companyId
  }

  const code = await siguienteNumero(
    tx,
    'MBG-FD',
    async (prefijo) => {
      const u = await tx.supplyV2LoyaltyProgram.findFirst({
        where: { code: { startsWith: prefijo } },
        orderBy: { code: 'desc' },
        select: { code: true },
      })
      return u?.code ?? null
    },
    d.startsAt
  )

  const sinTecho = d.budgetTotal == null || d.budgetTotal === ''
  const p = await tx.supplyV2LoyaltyProgram.create({
    data: {
      code,
      name: d.name.trim(),
      description: d.description?.trim() || null,
      objective: d.objective?.trim() || null,
      owner: d.owner,
      supplierId: d.supplierId ?? null,
      funding: d.funding,
      currency,
      modalities: [...d.modalities],
      budgetTotal: sinTecho ? null : decimal(d.budgetTotal!),
      budgetWaiverReason: sinTecho ? d.budgetWaiverReason?.trim() || null : null,
      budgetWaiverById: sinTecho ? d.budgetWaiverById ?? null : null,
      budgetWaiverAt: sinTecho && d.budgetWaiverById ? new Date() : null,
      pointsPerUnit: d.pointsPerUnit ?? null,
      amountPerPoint: d.amountPerPoint != null && d.amountPerPoint !== '' ? decimal(d.amountPerPoint) : null,
      accrualBasis: d.accrualBasis ?? 'CONTRACTUAL_VALUE',
      pointsExpireDays: d.pointsExpireDays ?? null,
      pointsHoldDays: d.pointsHoldDays ?? 0,
      startsAt: d.startsAt,
      endsAt: d.endsAt ?? null,
      status: 'DRAFT',
      createdById: ctx.actorId,
    },
    select: { id: true, code: true, status: true },
  })

  await eventoDePrograma(tx, p.id, 'PROGRAM_CREATED', { code, name: d.name.trim(), owner: d.owner }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_LOYALTY_PROGRAM_CREATED', 'SupplyV2LoyaltyProgram', p.id, { code, owner: d.owner, modalities: [...d.modalities] }, companyId)

  // Un programa sin techo que compromete dinero de Membego deja su
  // autorización MARCADA, no en silencio (§17 del Slice 7).
  if (sinTecho && d.funding !== 'SUPPLIER' && d.budgetWaiverById) {
    await eventoDePrograma(tx, p.id, 'BUDGET_WAIVED', { motivo: d.budgetWaiverReason, autorizadoPor: d.budgetWaiverById }, ctx.actorId)
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_LOYALTY_BUDGET_WAIVED', 'SupplyV2LoyaltyProgram', p.id, { motivo: d.budgetWaiverReason, autorizadoPor: d.budgetWaiverById }, companyId)
  }
  return p
}

export async function enviarProgramaARevisionEnTx(tx: Tx, programId: string, ctx: ContextoAuditoria): Promise<{ id: string; repetido: boolean }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Enviar a revisión necesita quién lo hace.')
  const p = await bloquearPrograma(tx, programId)
  if (p.status === 'PENDING_APPROVAL') return { id: p.id, repetido: true }
  exigirTransicion(TRANSICIONES_PROGRAMA, p.status, 'PENDING_APPROVAL', 'Programa')

  // Un programa que no ofrece NADA no se puede aprobar: no habría qué revisar.
  const planes = await tx.supplyV2MembershipPlan.count({ where: { programId, status: { not: 'ARCHIVED' } } })
  const recompensas = await tx.supplyV2Reward.count({ where: { programId, status: { not: 'CANCELLED' } } })
  const tieneReferidos = (await tx.supplyV2ReferralProgram.count({ where: { programId, active: true } })) > 0
  const tienePuntos = p.modalities.includes('POINTS') && p.pointsPerUnit != null
  if (planes === 0 && recompensas === 0 && !tieneReferidos && !tienePuntos) {
    fallo('PROGRAMA_VACIO', 'Este programa todavía no ofrece nada: añade un plan, una recompensa, el programa de referidos o la regla de puntos.')
  }

  await tx.supplyV2LoyaltyProgram.update({ where: { id: p.id }, data: { status: 'PENDING_APPROVAL' } })
  await eventoDePrograma(tx, p.id, 'PROGRAM_SUBMITTED', { planes, recompensas, tieneReferidos, tienePuntos }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_LOYALTY_PROGRAM_SUBMITTED', 'SupplyV2LoyaltyProgram', p.id, { planes, recompensas }, p.supplier?.companyId ?? null)
  return { id: p.id, repetido: false }
}

/**
 * Aprobar un programa es lo que lo pone a mover dinero, así que lo mira una
 * SEGUNDA persona — mientras haya a quién pasárselo. Con una sola persona
 * autorizada pasa, pero queda el rastro (`autoaprobada`).
 */
export async function aprobarProgramaEnTx(tx: Tx, programId: string, ctx: ContextoAuditoria): Promise<{ id: string; status: string; repetido: boolean }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Aprobar un programa necesita quién lo aprueba.')
  const p = await bloquearPrograma(tx, programId)
  if (p.status === 'ACTIVE') return { id: p.id, status: 'ACTIVE', repetido: true }
  exigirTransicion(TRANSICIONES_PROGRAMA, p.status, 'ACTIVE', 'Programa')

  const personasAutorizadas = await personasAutorizadasEnTx(tx)
  const segregacion = revisarSegregacion(p.createdById, ctx.actorId, personasAutorizadas, 'programaFidelizacion')
  if (!segregacion.permitido) fallo('AUTOAPROBACION', segregacion.motivo)

  await tx.supplyV2LoyaltyProgram.update({
    where: { id: p.id },
    data: { status: 'ACTIVE', approvedById: ctx.actorId, approvedAt: new Date() },
  })
  const detalle = { autoaprobada: segregacion.autoaprobada, personasAutorizadas, motivo: segregacion.autoaprobada ? MOTIVO_AUTOAPROBACION : null }
  await eventoDePrograma(tx, p.id, 'PROGRAM_APPROVED', detalle, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_LOYALTY_PROGRAM_APPROVED', 'SupplyV2LoyaltyProgram', p.id, detalle, p.supplier?.companyId ?? null)
  return { id: p.id, status: 'ACTIVE', repetido: false }
}

export async function rechazarProgramaEnTx(tx: Tx, programId: string, notas: string, ctx: ContextoAuditoria): Promise<{ id: string }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Rechazar un programa necesita quién lo hace.')
  if (!notas?.trim()) fallo('SIN_MOTIVO', 'Devolver un programa a borrador necesita decir qué hay que corregir.')
  const p = await bloquearPrograma(tx, programId)
  exigirTransicion(TRANSICIONES_PROGRAMA, p.status, 'DRAFT', 'Programa')
  await tx.supplyV2LoyaltyProgram.update({ where: { id: p.id }, data: { status: 'DRAFT', reviewNotes: notas.trim() } })
  await eventoDePrograma(tx, p.id, 'PROGRAM_REJECTED', { notas: notas.trim() }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_LOYALTY_PROGRAM_REJECTED', 'SupplyV2LoyaltyProgram', p.id, { notas: notas.trim() }, p.supplier?.companyId ?? null)
  return { id: p.id }
}

export async function pausarProgramaEnTx(tx: Tx, programId: string, ctx: ContextoAuditoria): Promise<{ id: string; repetido: boolean }> {
  const p = await bloquearPrograma(tx, programId)
  if (p.status === 'PAUSED') return { id: p.id, repetido: true }
  exigirTransicion(TRANSICIONES_PROGRAMA, p.status, 'PAUSED', 'Programa')
  await tx.supplyV2LoyaltyProgram.update({ where: { id: p.id }, data: { status: 'PAUSED' } })
  await eventoDePrograma(tx, p.id, 'PROGRAM_PAUSED', {}, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_LOYALTY_PROGRAM_PAUSED', 'SupplyV2LoyaltyProgram', p.id, {}, p.supplier?.companyId ?? null)
  return { id: p.id, repetido: false }
}

export async function reanudarProgramaEnTx(tx: Tx, programId: string, ctx: ContextoAuditoria): Promise<{ id: string; repetido: boolean }> {
  const p = await bloquearPrograma(tx, programId)
  if (p.status === 'ACTIVE') return { id: p.id, repetido: true }
  exigirTransicion(TRANSICIONES_PROGRAMA, p.status, 'ACTIVE', 'Programa')
  await tx.supplyV2LoyaltyProgram.update({ where: { id: p.id }, data: { status: 'ACTIVE' } })
  await eventoDePrograma(tx, p.id, 'PROGRAM_RESUMED', {}, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_LOYALTY_PROGRAM_RESUMED', 'SupplyV2LoyaltyProgram', p.id, {}, p.supplier?.companyId ?? null)
  return { id: p.id, repetido: false }
}

/**
 * Cancelar cierra el programa y sus planes, pero NO toca lo ya vendido: las
 * membresías vivas siguen valiendo hasta su vencimiento, los puntos ganados
 * siguen ahí y las recompensas entregadas no se deshacen. Cancelar un
 * programa no es una forma de quitarle a la gente lo que ya tiene.
 */
export async function cancelarProgramaEnTx(tx: Tx, programId: string, motivo: string, ctx: ContextoAuditoria): Promise<{ id: string; planesArchivados: number }> {
  if (!motivo?.trim()) fallo('SIN_MOTIVO', 'Cancelar un programa necesita un motivo.')
  const p = await bloquearPrograma(tx, programId)
  exigirTransicion(TRANSICIONES_PROGRAMA, p.status, 'CANCELLED', 'Programa')
  const planes = await tx.supplyV2MembershipPlan.updateMany({
    where: { programId, status: { in: ['DRAFT', 'PUBLISHED', 'PAUSED'] } },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  })
  await tx.supplyV2LoyaltyProgram.update({
    where: { id: p.id },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: motivo.trim() },
  })
  await eventoDePrograma(tx, p.id, 'PROGRAM_CANCELLED', { motivo: motivo.trim(), planesArchivados: planes.count }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_LOYALTY_PROGRAM_CANCELLED', 'SupplyV2LoyaltyProgram', p.id, { motivo: motivo.trim(), planesArchivados: planes.count }, p.supplier?.companyId ?? null)
  return { id: p.id, planesArchivados: planes.count }
}

export async function cerrarProgramaEnTx(tx: Tx, programId: string, ctx: ContextoAuditoria): Promise<{ id: string; repetido: boolean }> {
  const p = await bloquearPrograma(tx, programId)
  if (p.status === 'COMPLETED') return { id: p.id, repetido: true }
  exigirTransicion(TRANSICIONES_PROGRAMA, p.status, 'COMPLETED', 'Programa')
  await tx.supplyV2LoyaltyProgram.update({ where: { id: p.id }, data: { status: 'COMPLETED', completedAt: new Date() } })
  await eventoDePrograma(tx, p.id, 'PROGRAM_COMPLETED', {}, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_LOYALTY_PROGRAM_COMPLETED', 'SupplyV2LoyaltyProgram', p.id, {}, p.supplier?.companyId ?? null)
  return { id: p.id, repetido: false }
}

/** Sucursales participantes (§7). Idempotente: repetir no duplica. */
export async function fijarSucursalesEnTx(tx: Tx, programId: string, sucursalIds: readonly string[], ctx: ContextoAuditoria): Promise<{ total: number }> {
  const p = await bloquearPrograma(tx, programId)
  if (['COMPLETED', 'CANCELLED'].includes(p.status)) fallo('PROGRAMA_CERRADO', 'Un programa cerrado no cambia sus sucursales.')
  const unicas = [...new Set(sucursalIds)]
  if (unicas.length > 0 && p.supplierId) {
    // Un proveedor externo no está registrado como empresa de Membego, así
    // que no tiene sucursales que elegir.
    const companyId = p.supplier?.companyId ?? null
    if (!companyId) fallo('PROVEEDOR_SIN_EMPRESA', 'Este negocio no está registrado como empresa en Membego, así que no tiene sucursales.')
    const ajenas = await tx.sucursal.count({ where: { id: { in: unicas }, companyId: { not: companyId } } })
    if (ajenas > 0) fallo('SUCURSAL_AJENA', 'Hay sucursales que no son de este negocio.')
  }
  await tx.supplyV2LoyaltyProgramBranch.deleteMany({ where: { programId, sucursalId: { notIn: unicas.length ? unicas : ['-'] } } })
  for (const sucursalId of unicas) {
    await tx.supplyV2LoyaltyProgramBranch.upsert({
      where: { programId_sucursalId: { programId, sucursalId } },
      update: {},
      create: { programId, sucursalId },
    })
  }
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_LOYALTY_PROGRAM_CREATED', 'SupplyV2LoyaltyProgram', p.id, { sucursales: unicas.length }, p.supplier?.companyId ?? null)
  return { total: unicas.length }
}

// ── Planes de membresía ────────────────────────────────────────────────────

export interface PlanCreado {
  id: string
  code: string
  name: string
  status: string
}

export async function crearPlanEnTx(tx: Tx, programId: string, d: DatosPlan, ctx: ContextoAuditoria): Promise<PlanCreado> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Un plan necesita quién lo crea.')
  const error = validarPlan(d)
  if (error) fallo('PLAN_INVALIDO', error)
  const p = await bloquearPrograma(tx, programId)
  if (['COMPLETED', 'CANCELLED'].includes(p.status)) fallo('PROGRAMA_CERRADO', 'Un programa cerrado no admite planes nuevos.')
  if (!p.modalities.includes('MEMBERSHIPS')) fallo('MODALIDAD_NO_HABILITADA', 'Este programa no tiene habilitadas las membresías.')
  // Una membresía es SIEMPRE de un negocio: es «la membresía Gold de Car
  // Town», no una membresía de nadie. Y además hace falta para la economía:
  // todo evento económico de Supply 2.0 cuelga de un proveedor, y no se va a
  // cambiar el significado de un modelo financiero existente para esto.
  if (!p.supplierId) fallo('PROGRAMA_SIN_NEGOCIO', 'Un plan de membresía tiene que pertenecer al programa de un negocio concreto.')

  const precio = d.price == null || d.price === '' ? new Prisma.Decimal(0) : decimal(d.price)
  const code = await siguienteNumero(
    tx,
    'MBG-MP',
    async (prefijo) => {
      const u = await tx.supplyV2MembershipPlan.findFirst({ where: { code: { startsWith: prefijo } }, orderBy: { code: 'desc' }, select: { code: true } })
      return u?.code ?? null
    },
    p.startsAt
  )

  const plan = await tx.supplyV2MembershipPlan
    .create({
      data: {
        code,
        programId,
        name: d.name.trim(),
        description: d.description?.trim() || null,
        kind: d.kind,
        price: precio,
        currency: p.currency,
        durationDays: d.durationDays,
        maxMembers: d.maxMembers ?? null,
        maxAdvanceRenewals: d.maxAdvanceRenewals ?? 1,
        status: 'DRAFT',
        currentVersion: 1,
        createdById: ctx.actorId,
      },
      select: { id: true, code: true, name: true, status: true },
    })
    .catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        fallo('PLAN_REPETIDO', `Este programa ya tiene un plan llamado «${d.name.trim()}».`)
      }
      throw e
    })

  // La versión 1 es la foto de lo que se promete desde el primer día.
  await tx.supplyV2MembershipPlanVersion.create({
    data: {
      planId: plan.id,
      version: 1,
      price: precio,
      durationDays: d.durationDays,
      snapshot: { kind: d.kind, price: precio.toFixed(2), durationDays: d.durationDays, beneficios: [] },
      createdById: ctx.actorId,
    },
  })

  await eventoDePrograma(tx, programId, 'PLAN_CREATED', { planId: plan.id, code, name: plan.name, kind: d.kind, price: precio.toFixed(2) }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_MEMBERSHIP_PLAN_CREATED', 'SupplyV2MembershipPlan', plan.id, { code, name: plan.name, kind: d.kind }, p.supplier?.companyId ?? null)
  return plan
}

/**
 * Cambiar un plan NO reescribe lo ya vendido (§14).
 *
 * Si cambia el precio o la duración —lo que se le prometió a quien ya
 * compró— sube la versión y se guarda una foto nueva. Las membresías
 * existentes siguen apuntando a SU versión y conservan sus condiciones.
 */
export async function actualizarPlanEnTx(
  tx: Tx,
  planId: string,
  d: DatosPlan,
  ctx: ContextoAuditoria
): Promise<{ id: string; version: number; versionNueva: boolean }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Modificar un plan necesita quién lo hace.')
  const error = validarPlan(d)
  if (error) fallo('PLAN_INVALIDO', error)
  const plan = await bloquearPlan(tx, planId)
  if (plan.status === 'ARCHIVED') fallo('PLAN_ARCHIVADO', 'Un plan archivado ya no se modifica.')
  if (plan.kind !== d.kind) {
    fallo('TIPO_INMUTABLE', 'El tipo del plan no se cambia: crea otro plan. Cambiarlo alteraría lo que ya contrataron los miembros actuales.')
  }

  const precio = d.price == null || d.price === '' ? new Prisma.Decimal(0) : decimal(d.price)
  const versionNueva = exigeVersionNueva({ price: plan.price, durationDays: plan.durationDays }, { price: precio, durationDays: d.durationDays })
  const version = versionNueva ? plan.currentVersion + 1 : plan.currentVersion

  if (versionNueva) {
    const beneficios = await tx.supplyV2MembershipBenefit.findMany({
      where: { planId },
      select: { kind: true, benefitId: true, usesPerPeriod: true, pointsMultiplier: true, earlyAccessHours: true },
    })
    await tx.supplyV2MembershipPlanVersion.create({
      data: {
        planId,
        version,
        price: precio,
        durationDays: d.durationDays,
        snapshot: {
          kind: plan.kind,
          price: precio.toFixed(2),
          durationDays: d.durationDays,
          beneficios: beneficios.map((b) => ({
            kind: b.kind,
            benefitId: b.benefitId,
            usesPerPeriod: b.usesPerPeriod,
            pointsMultiplier: b.pointsMultiplier?.toFixed(2) ?? null,
            earlyAccessHours: b.earlyAccessHours,
          })),
        },
        createdById: ctx.actorId,
      },
    })
  }

  await tx.supplyV2MembershipPlan.update({
    where: { id: planId },
    data: {
      name: d.name.trim(),
      description: d.description?.trim() || null,
      price: precio,
      durationDays: d.durationDays,
      maxMembers: d.maxMembers ?? null,
      maxAdvanceRenewals: d.maxAdvanceRenewals ?? plan.maxAdvanceRenewals,
      currentVersion: version,
    },
  })

  const detalle = { planId, version, versionNueva, precio: precio.toFixed(2), durationDays: d.durationDays }
  await eventoDePrograma(tx, plan.programId, 'PLAN_UPDATED', detalle, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_MEMBERSHIP_PLAN_UPDATED', 'SupplyV2MembershipPlan', planId, detalle, null)
  return { id: planId, version, versionNueva }
}

export async function publicarPlanEnTx(tx: Tx, planId: string, ctx: ContextoAuditoria): Promise<{ id: string; repetido: boolean }> {
  const plan = await bloquearPlan(tx, planId)
  if (plan.status === 'PUBLISHED') return { id: planId, repetido: true }
  exigirTransicion(TRANSICIONES_PLAN, plan.status, 'PUBLISHED', 'Plan')
  if (plan.program.status !== 'ACTIVE') {
    fallo('PROGRAMA_NO_ACTIVO', 'El programa tiene que estar activo para publicar un plan: si no, nadie podría usar lo que incluye.')
  }
  await tx.supplyV2MembershipPlan.update({ where: { id: planId }, data: { status: 'PUBLISHED', publishedAt: new Date() } })
  await eventoDePrograma(tx, plan.programId, 'PLAN_PUBLISHED', { planId, code: plan.code }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_MEMBERSHIP_PLAN_PUBLISHED', 'SupplyV2MembershipPlan', planId, { code: plan.code }, null)
  return { id: planId, repetido: false }
}

export async function pausarPlanEnTx(tx: Tx, planId: string, ctx: ContextoAuditoria): Promise<{ id: string; repetido: boolean }> {
  const plan = await bloquearPlan(tx, planId)
  if (plan.status === 'PAUSED') return { id: planId, repetido: true }
  exigirTransicion(TRANSICIONES_PLAN, plan.status, 'PAUSED', 'Plan')
  await tx.supplyV2MembershipPlan.update({ where: { id: planId }, data: { status: 'PAUSED' } })
  await eventoDePrograma(tx, plan.programId, 'PLAN_PAUSED', { planId }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_MEMBERSHIP_PLAN_PAUSED', 'SupplyV2MembershipPlan', planId, {}, null)
  return { id: planId, repetido: false }
}

/**
 * Archivar quita el plan del escaparate. Los miembros actuales conservan su
 * membresía hasta que venza: archivar no es cancelar lo vendido.
 */
export async function archivarPlanEnTx(tx: Tx, planId: string, ctx: ContextoAuditoria): Promise<{ id: string; miembrosVivos: number }> {
  const plan = await bloquearPlan(tx, planId)
  if (plan.status === 'ARCHIVED') return { id: planId, miembrosVivos: 0 }
  exigirTransicion(TRANSICIONES_PLAN, plan.status, 'ARCHIVED', 'Plan')
  const miembrosVivos = await tx.supplyV2CustomerMembership.count({
    where: { planId, status: { in: ['ACTIVE', 'SCHEDULED', 'SUSPENDED'] } },
  })
  await tx.supplyV2MembershipPlan.update({ where: { id: planId }, data: { status: 'ARCHIVED', archivedAt: new Date() } })
  await eventoDePrograma(tx, plan.programId, 'PLAN_ARCHIVED', { planId, miembrosVivos }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_MEMBERSHIP_PLAN_ARCHIVED', 'SupplyV2MembershipPlan', planId, { miembrosVivos }, null)
  return { id: planId, miembrosVivos }
}

// ── Beneficios de un plan (§11) ────────────────────────────────────────────

export interface DatosBeneficioDePlan {
  kind: SupplyV2MembershipBenefitKind
  benefitId?: string | null
  grantsCoupon?: boolean | null
  usesPerPeriod?: number | null
  pointsMultiplier?: number | string | null
  earlyAccessHours?: number | null
  position?: number | null
}

/**
 * Añade al plan un beneficio del Slice 6 (o un multiplicador de puntos). NO
 * se crea un descuento nuevo: el motor es el de siempre.
 */
export async function adjuntarBeneficioAPlanEnTx(tx: Tx, planId: string, d: DatosBeneficioDePlan, ctx: ContextoAuditoria): Promise<{ id: string }> {
  const plan = await bloquearPlan(tx, planId)
  if (plan.status === 'ARCHIVED') fallo('PLAN_ARCHIVADO', 'Un plan archivado no cambia lo que incluye.')

  if (d.kind === 'POINTS_MULTIPLIER') {
    if (d.pointsMultiplier == null || d.pointsMultiplier === '') fallo('SIN_MULTIPLICADOR', 'Indica por cuánto multiplica los puntos este plan.')
    const m = decimal(d.pointsMultiplier)
    if (!m.isFinite() || m.lessThanOrEqualTo(1)) fallo('MULTIPLICADOR_INVALIDO', 'El multiplicador tiene que ser mayor que 1: si no, no multiplica nada.')
  } else if (d.kind === 'EARLY_ACCESS') {
    if (!d.earlyAccessHours || d.earlyAccessHours <= 0) fallo('SIN_HORAS', 'Indica cuántas horas de acceso anticipado da el plan.')
  } else {
    if (!d.benefitId) fallo('SIN_BENEFICIO', 'Elige el beneficio que incluye el plan.')
    const b = await tx.supplyV2Benefit.findUnique({ where: { id: d.benefitId }, select: { id: true, status: true, currency: true, requiresAssignment: true } })
    if (!b) fallo('BENEFICIO_NO_ENCONTRADO', 'Ese beneficio no existe.')
    if (['CANCELLED', 'EXPIRED'].includes(b.status)) fallo('BENEFICIO_CERRADO', 'Ese beneficio ya no está disponible.')
    if (b.currency !== plan.program.currency) fallo('MONEDA_DISTINTA', 'Ese beneficio es de otra moneda.')
    // Un beneficio de plan se CONCEDE al miembro, así que tiene que ser de
    // los que se asignan: si no, lo tendría todo el mundo y el plan no daría
    // nada exclusivo.
    if (!b.requiresAssignment) fallo('BENEFICIO_ABIERTO', 'Ese beneficio está abierto a todo el mundo: un plan tiene que incluir uno que se asigne a quien es miembro.')
  }

  const fila = await tx.supplyV2MembershipBenefit
    .create({
      data: {
        planId,
        kind: d.kind,
        benefitId: d.benefitId ?? null,
        grantsCoupon: d.grantsCoupon ?? false,
        usesPerPeriod: d.usesPerPeriod ?? null,
        pointsMultiplier: d.pointsMultiplier != null && d.pointsMultiplier !== '' ? decimal(d.pointsMultiplier) : null,
        earlyAccessHours: d.earlyAccessHours ?? null,
        position: d.position ?? 0,
      },
      select: { id: true },
    })
    .catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        fallo('BENEFICIO_REPETIDO', 'Ese beneficio ya está incluido en el plan.')
      }
      throw e
    })

  await eventoDePrograma(tx, plan.programId, 'PLAN_UPDATED', { planId, beneficioAgregado: fila.id, kind: d.kind }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_MEMBERSHIP_PLAN_UPDATED', 'SupplyV2MembershipPlan', planId, { beneficioAgregado: fila.id, kind: d.kind }, null)
  return fila
}

export async function quitarBeneficioDePlanEnTx(tx: Tx, membershipBenefitId: string, ctx: ContextoAuditoria): Promise<{ id: string }> {
  const fila = await tx.supplyV2MembershipBenefit.findUnique({ where: { id: membershipBenefitId }, select: { id: true, planId: true, benefitId: true } })
  if (!fila) fallo('NO_ENCONTRADO', 'Ese beneficio no está en el plan.')
  const plan = await bloquearPlan(tx, fila.planId)
  // Quitarlo del plan no le quita nada a quien ya lo tiene concedido: su
  // asignación sigue viva hasta que venza o se agote.
  await tx.supplyV2MembershipBenefit.delete({ where: { id: membershipBenefitId } })
  await eventoDePrograma(tx, plan.programId, 'PLAN_UPDATED', { planId: fila.planId, beneficioQuitado: membershipBenefitId }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_MEMBERSHIP_PLAN_UPDATED', 'SupplyV2MembershipPlan', fila.planId, { beneficioQuitado: membershipBenefitId }, null)
  return { id: membershipBenefitId }
}
