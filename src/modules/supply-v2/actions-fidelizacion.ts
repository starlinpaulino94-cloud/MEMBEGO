'use server'

import { revalidatePath } from 'next/cache'
import type { SupplyV2LoyaltyModality, SupplyV2MembershipPlanKind, SupplyV2ReferralRewardKind, SupplyV2RewardKind } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { createRateLimiter } from '@/lib/rate-limit'
import { getRequestMeta } from '@/lib/server-utils'
import {
  RUTA_FIDELIZACION,
  RUTA_FIDELIZACION_CLIENTE,
  RUTA_INVITAR_CLIENTE,
  RUTA_MEMBRESIAS_CLIENTE,
  RUTA_MEMBRESIAS_PUBLICAS,
  RUTA_PORTAL_FIDELIZACION,
  RUTA_PUNTOS_CLIENTE,
  RUTA_RECOMPENSAS_CLIENTE,
} from './core/catalogo'
import { comoError, contextoDeAuditoria, entero, fecha, fechaFinDeDia, numero, texto, type EstadoAccion } from './actions-util'
import { exigirCliente, exigirPermisoSupplyV2, exigirProveedorSupplyV2 } from './permisos'
import {
  actualizarPlanEnTx,
  adjuntarBeneficioAPlanEnTx,
  aprobarProgramaEnTx,
  archivarPlanEnTx,
  cancelarProgramaEnTx,
  crearPlanEnTx,
  crearProgramaEnTx,
  enviarProgramaARevisionEnTx,
  exigirPropiedadDePrograma,
  pausarProgramaEnTx,
  publicarPlanEnTx,
  reanudarProgramaEnTx,
  rechazarProgramaEnTx,
} from './loyalty/programs'
import { cancelarMembresiaEnTx, contratarMembresiaEnTx, otorgarMembresiaEnTx } from './loyalty/memberships'
import { ajustarPuntosEnTx } from './loyalty/points'
import { aprobarRecompensaEnTx, crearRecompensaEnTx, reclamarRecompensaEnTx, reversarReclamacionEnTx } from './loyalty/rewards'
import { atribuirRegistroEnTx, codigoDeReferidoEnTx, configurarReferidosEnTx, registrarAperturaEnTx } from './loyalty/referrals'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · ACCIONES DE FIDELIZACIÓN (§42).
 *
 * TODA acción empieza por su guardia. Las server actions se despachan por id
 * sobre cualquier ruta, así que el middleware no las protege: esconder un
 * botón no es una protección. Crear no es aprobar, aprobar no es otorgar, y
 * ajustar puntos a mano tiene su propio permiso porque vale dinero.
 */

function refrescarFidelizacion(...sufijos: string[]): void {
  revalidatePath(RUTA_FIDELIZACION)
  revalidatePath(RUTA_PORTAL_FIDELIZACION)
  for (const s of sufijos) revalidatePath(`${RUTA_FIDELIZACION}/${s}`)
}

function refrescarCliente(): void {
  for (const r of [RUTA_FIDELIZACION_CLIENTE, RUTA_MEMBRESIAS_CLIENTE, RUTA_PUNTOS_CLIENTE, RUTA_RECOMPENSAS_CLIENTE, RUTA_INVITAR_CLIENTE, RUTA_MEMBRESIAS_PUBLICAS]) {
    revalidatePath(r)
  }
}

/**
 * Probar códigos de invitación a mano no informa de nada (mensaje opaco) y
 * además se limita: doce intentos cada cinco minutos por persona, como los
 * cupones del Slice 7.
 */
const limitadorInvitaciones = createRateLimiter({ name: 'supply-v2-invitacion', interval: 5 * 60_000, maxRequests: 12 })

const MODALIDADES: readonly SupplyV2LoyaltyModality[] = ['MEMBERSHIPS', 'REFERRALS', 'POINTS', 'REWARDS']
const TIPOS_PLAN: readonly SupplyV2MembershipPlanKind[] = ['FREE', 'PAID', 'GRANTED']
const TIPOS_RECOMPENSA: readonly SupplyV2RewardKind[] = ['COUPON', 'BENEFIT', 'FREE_PRODUCT', 'SERVICE', 'PARTIAL_BONUS']
const TIPOS_PREMIO_REFERIDO: readonly SupplyV2ReferralRewardKind[] = ['BONUS', 'COUPON', 'POINTS', 'SUPPLIER_BENEFIT']

// ── Programas ──────────────────────────────────────────────────────────────

export interface ProgramaCreadoDTO {
  id: string
  code: string
}

export async function crearProgramaAction(_prev: EstadoAccion<ProgramaCreadoDTO>, fd: FormData): Promise<EstadoAccion<ProgramaCreadoDTO>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    const owner = texto(fd, 'owner', 20) === 'SUPPLIER' ? 'SUPPLIER' : 'MEMBEGO'
    const modalidades = fd.getAll('modalities').map(String).filter((m): m is SupplyV2LoyaltyModality => (MODALIDADES as readonly string[]).includes(m))
    if (modalidades.length === 0) return { error: 'Elige al menos una modalidad: membresías, referidos, puntos o recompensas.' }
    const startsAt = fecha(fd, 'startsAt')
    if (!startsAt) return { error: 'Indica desde cuándo vale el programa.' }
    const funding = texto(fd, 'funding', 20)
    if (!['MEMBEGO', 'SUPPLIER', 'SHARED'].includes(funding)) return { error: 'Indica quién financia el programa.' }

    const creado = await sinEmpresa('Supply 2.0: alta de un programa de fidelización', (tx) =>
      crearProgramaEnTx(
        tx,
        {
          name: texto(fd, 'name', 120),
          description: texto(fd, 'description', 500) || null,
          objective: texto(fd, 'objective', 300) || null,
          owner,
          supplierId: texto(fd, 'supplierId', 60) || null,
          funding: funding as 'MEMBEGO' | 'SUPPLIER' | 'SHARED',
          modalities: modalidades,
          budgetTotal: numero(fd, 'budgetTotal'),
          budgetWaiverReason: texto(fd, 'budgetWaiverReason', 300) || null,
          budgetWaiverById: texto(fd, 'budgetWaiverById', 60) || null,
          pointsPerUnit: entero(fd, 'pointsPerUnit'),
          amountPerPoint: numero(fd, 'amountPerPoint'),
          accrualBasis: texto(fd, 'accrualBasis', 30) === 'CUSTOMER_PAID' ? 'CUSTOMER_PAID' : 'CONTRACTUAL_VALUE',
          pointsExpireDays: entero(fd, 'pointsExpireDays'),
          pointsHoldDays: entero(fd, 'pointsHoldDays'),
          startsAt,
          endsAt: fechaFinDeDia(fd, 'endsAt'),
        },
        ctx
      )
    )
    refrescarFidelizacion(creado.id)
    return { success: `Programa ${creado.code} creado como borrador. Añade sus planes o recompensas y mándalo a revisión.`, id: creado.id, data: creado }
  } catch (e) {
    return comoError<ProgramaCreadoDTO>(e, 'crearPrograma')
  }
}

export async function enviarProgramaARevisionAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply 2.0: enviar un programa a revisión', (tx) => enviarProgramaARevisionEnTx(tx, id, ctx))
    refrescarFidelizacion(id)
    return { success: 'Programa enviado a revisión. Lo aprueba otra persona autorizada.', id }
  } catch (e) {
    return comoError(e, 'enviarProgramaARevision')
  }
}

export async function aprobarProgramaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply 2.0: aprobar un programa de fidelización', (tx) => aprobarProgramaEnTx(tx, id, ctx))
    refrescarFidelizacion(id)
    refrescarCliente()
    return { success: 'Programa activo. Ya puedes publicar sus planes y recompensas.', id }
  } catch (e) {
    return comoError(e, 'aprobarPrograma')
  }
}

export async function rechazarProgramaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const notas = texto(fd, 'notas', 500)
    if (!notas) return { error: 'Di qué hay que corregir antes de devolverlo a borrador.' }
    await sinEmpresa('Supply 2.0: devolver un programa a borrador', (tx) => rechazarProgramaEnTx(tx, id, notas, ctx))
    refrescarFidelizacion(id)
    return { success: 'Programa devuelto a borrador con tus notas.', id }
  } catch (e) {
    return comoError(e, 'rechazarPrograma')
  }
}

export async function pausarProgramaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const reanudar = texto(fd, 'reanudar', 5) === 'si'
    await sinEmpresa('Supply 2.0: pausar o reanudar un programa', (tx) => (reanudar ? reanudarProgramaEnTx(tx, id, ctx) : pausarProgramaEnTx(tx, id, ctx)))
    refrescarFidelizacion(id)
    refrescarCliente()
    return { success: reanudar ? 'Programa reanudado.' : 'Programa pausado. Deja de dar beneficios nuevos; lo ya concedido sigue valiendo.', id }
  } catch (e) {
    return comoError(e, 'pausarPrograma')
  }
}

export async function cancelarProgramaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'motivo', 300)
    if (!motivo) return { error: 'Cancelar un programa necesita un motivo.' }
    const r = await sinEmpresa('Supply 2.0: cancelar un programa', (tx) => cancelarProgramaEnTx(tx, id, motivo, ctx))
    refrescarFidelizacion(id)
    refrescarCliente()
    return { success: `Programa cancelado. Se archivaron ${r.planesArchivados} planes; las membresías vivas siguen valiendo hasta su vencimiento.`, id }
  } catch (e) {
    return comoError(e, 'cancelarPrograma')
  }
}

// ── Planes ─────────────────────────────────────────────────────────────────

export interface PlanCreadoDTO {
  id: string
  code: string
  name: string
  status: string
}

export async function crearPlanAction(_prev: EstadoAccion<PlanCreadoDTO>, fd: FormData): Promise<EstadoAccion<PlanCreadoDTO>> {
  const programId = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const kind = texto(fd, 'kind', 20) as SupplyV2MembershipPlanKind
    if (!TIPOS_PLAN.includes(kind)) return { error: 'Indica si el plan es gratuito, de pago u otorgado.' }
    const durationDays = entero(fd, 'durationDays')
    if (!durationDays) return { error: 'Indica cuántos días dura el plan.' }

    const creado = await sinEmpresa('Supply 2.0: alta de un plan de membresía', (tx) =>
      crearPlanEnTx(
        tx,
        programId,
        {
          name: texto(fd, 'name', 120),
          description: texto(fd, 'description', 500) || null,
          kind,
          price: numero(fd, 'price') ?? 0,
          durationDays,
          maxMembers: entero(fd, 'maxMembers'),
          maxAdvanceRenewals: entero(fd, 'maxAdvanceRenewals'),
        },
        ctx
      )
    )
    refrescarFidelizacion(programId)
    return { success: `Plan ${creado.name} creado como borrador. Publícalo para que se pueda contratar.`, id: creado.id, data: creado }
  } catch (e) {
    return comoError<PlanCreadoDTO>(e, 'crearPlan')
  }
}

export async function actualizarPlanAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const planId = texto(fd, 'planId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const kind = texto(fd, 'kind', 20) as SupplyV2MembershipPlanKind
    if (!TIPOS_PLAN.includes(kind)) return { error: 'Indica el tipo del plan.' }
    const durationDays = entero(fd, 'durationDays')
    if (!durationDays) return { error: 'Indica cuántos días dura el plan.' }
    const r = await sinEmpresa('Supply 2.0: modificar un plan de membresía', (tx) =>
      actualizarPlanEnTx(
        tx,
        planId,
        { name: texto(fd, 'name', 120), description: texto(fd, 'description', 500) || null, kind, price: numero(fd, 'price') ?? 0, durationDays, maxMembers: entero(fd, 'maxMembers'), maxAdvanceRenewals: entero(fd, 'maxAdvanceRenewals') },
        ctx
      )
    )
    refrescarFidelizacion()
    refrescarCliente()
    return {
      success: r.versionNueva
        ? `Plan actualizado. Es la versión ${r.version}: quien ya compró conserva las condiciones de la suya.`
        : 'Plan actualizado.',
      id: planId,
    }
  } catch (e) {
    return comoError(e, 'actualizarPlan')
  }
}

export async function publicarPlanAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const planId = texto(fd, 'planId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const archivar = texto(fd, 'archivar', 5) === 'si'
    if (archivar) {
      const r = await sinEmpresa('Supply 2.0: archivar un plan', (tx) => archivarPlanEnTx(tx, planId, ctx))
      refrescarFidelizacion()
      refrescarCliente()
      return { success: r.miembrosVivos > 0 ? `Plan archivado. Sus ${r.miembrosVivos} miembros conservan la membresía hasta que venza.` : 'Plan archivado.', id: planId }
    }
    await sinEmpresa('Supply 2.0: publicar un plan', (tx) => publicarPlanEnTx(tx, planId, ctx))
    refrescarFidelizacion()
    refrescarCliente()
    return { success: 'Plan publicado. Ya se puede contratar desde el marketplace.', id: planId }
  } catch (e) {
    return comoError(e, 'publicarPlan')
  }
}

export async function adjuntarBeneficioAPlanAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const planId = texto(fd, 'planId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const kind = texto(fd, 'kind', 30)
    if (!['BENEFIT', 'COUPON', 'POINTS_MULTIPLIER', 'EARLY_ACCESS'].includes(kind)) return { error: 'Indica qué incluye el plan.' }
    await sinEmpresa('Supply 2.0: añadir un beneficio a un plan', (tx) =>
      adjuntarBeneficioAPlanEnTx(
        tx,
        planId,
        {
          kind: kind as 'BENEFIT' | 'COUPON' | 'POINTS_MULTIPLIER' | 'EARLY_ACCESS',
          benefitId: texto(fd, 'benefitId', 60) || null,
          grantsCoupon: texto(fd, 'grantsCoupon', 5) === 'si',
          usesPerPeriod: entero(fd, 'usesPerPeriod'),
          pointsMultiplier: numero(fd, 'pointsMultiplier'),
          earlyAccessHours: entero(fd, 'earlyAccessHours'),
        },
        ctx
      )
    )
    refrescarFidelizacion()
    return { success: 'Añadido a lo que incluye el plan.', id: planId }
  } catch (e) {
    return comoError(e, 'adjuntarBeneficioAPlan')
  }
}

// ── Referidos y recompensas (administración) ───────────────────────────────

export async function configurarReferidosAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const programId = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_REFERRAL_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const rewardKind = texto(fd, 'rewardKind', 30) as SupplyV2ReferralRewardKind
    if (!TIPOS_PREMIO_REFERIDO.includes(rewardKind)) return { error: 'Indica qué gana quien invita.' }
    await sinEmpresa('Supply 2.0: configurar el programa de referidos', (tx) =>
      configurarReferidosEnTx(
        tx,
        programId,
        {
          rewardKind,
          rewardBenefitId: texto(fd, 'rewardBenefitId', 60) || null,
          rewardPoints: entero(fd, 'rewardPoints'),
          rewardAmount: numero(fd, 'rewardAmount'),
          requiresFirstPurchase: texto(fd, 'requiresFirstPurchase', 5) !== 'no',
          minPurchaseAmount: numero(fd, 'minPurchaseAmount'),
          requiresPaymentConfirmed: texto(fd, 'requiresPaymentConfirmed', 5) !== 'no',
          waitingPeriodDays: entero(fd, 'waitingPeriodDays'),
          maxPerReferrer: entero(fd, 'maxPerReferrer'),
          maxTotal: entero(fd, 'maxTotal'),
          budgetTotal: numero(fd, 'budgetTotal'),
        },
        ctx
      )
    )
    refrescarFidelizacion(programId)
    refrescarCliente()
    return { success: 'Programa de referidos configurado.', id: programId }
  } catch (e) {
    return comoError(e, 'configurarReferidos')
  }
}

export interface RecompensaCreadaDTO {
  id: string
  code: string
}

export async function crearRecompensaAction(_prev: EstadoAccion<RecompensaCreadaDTO>, fd: FormData): Promise<EstadoAccion<RecompensaCreadaDTO>> {
  const programId = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_REWARD_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const kind = texto(fd, 'kind', 30) as SupplyV2RewardKind
    if (!TIPOS_RECOMPENSA.includes(kind)) return { error: 'Indica qué tipo de recompensa es.' }
    const startsAt = fecha(fd, 'startsAt')
    if (!startsAt) return { error: 'Indica desde cuándo se puede pedir.' }
    const creada = await sinEmpresa('Supply 2.0: alta de una recompensa', (tx) =>
      crearRecompensaEnTx(
        tx,
        programId,
        {
          name: texto(fd, 'name', 120),
          kind,
          pointsCost: entero(fd, 'pointsCost') ?? 0,
          benefitId: texto(fd, 'benefitId', 60) || null,
          offerId: texto(fd, 'offerId', 60) || null,
          unitCost: numero(fd, 'unitCost'),
          budgetTotal: numero(fd, 'budgetTotal'),
          maxClaims: entero(fd, 'maxClaims'),
          maxPerCustomer: entero(fd, 'maxPerCustomer'),
          requiresMembership: texto(fd, 'requiresMembership', 5) === 'si',
          requiredPlanId: texto(fd, 'requiredPlanId', 60) || null,
          startsAt,
          endsAt: fechaFinDeDia(fd, 'endsAt'),
        },
        ctx
      )
    )
    refrescarFidelizacion(programId)
    return { success: `Recompensa ${creada.code} creada como borrador. La aprueba otra persona autorizada.`, id: creada.id, data: creada }
  } catch (e) {
    return comoError<RecompensaCreadaDTO>(e, 'crearRecompensa')
  }
}

export async function aprobarRecompensaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'rewardId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_REWARD_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply 2.0: aprobar una recompensa', (tx) => aprobarRecompensaEnTx(tx, id, ctx))
    refrescarFidelizacion()
    refrescarCliente()
    return { success: 'Recompensa publicada. Ya se puede pedir con puntos.', id }
  } catch (e) {
    return comoError(e, 'aprobarRecompensa')
  }
}

export async function reversarReclamacionAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'claimId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_REWARD_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'motivo', 300)
    if (!motivo) return { error: 'Reversar una recompensa necesita un motivo.' }
    const r = await sinEmpresa('Supply 2.0: reversar una reclamación', (tx) => reversarReclamacionEnTx(tx, id, motivo, ctx))
    refrescarFidelizacion()
    refrescarCliente()
    return {
      success: r.puntosDevueltos > 0 ? `Reversada. Se devolvieron ${r.puntosDevueltos} puntos.` : 'Reversada. No se devuelven puntos: la recompensa ya se había usado.',
      id,
    }
  } catch (e) {
    return comoError(e, 'reversarReclamacion')
  }
}

export async function otorgarMembresiaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_GRANT')
    const ctx = await contextoDeAuditoria(actor)
    const planId = texto(fd, 'planId', 60)
    const customerId = texto(fd, 'customerId', 60)
    const motivo = texto(fd, 'motivo', 300)
    if (!planId || !customerId) return { error: 'Elige el plan y la persona.' }
    if (!motivo) return { error: 'Otorgar una membresía necesita un motivo escrito.' }
    const m = await sinEmpresa('Supply 2.0: otorgar una membresía', (tx) => otorgarMembresiaEnTx(tx, { planId, customerId, motivo, dias: entero(fd, 'dias') }, ctx))
    refrescarFidelizacion()
    refrescarCliente()
    return { success: `Membresía ${m.code} concedida.`, id: m.id }
  } catch (e) {
    return comoError(e, 'otorgarMembresia')
  }
}

export async function cancelarMembresiaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'membershipId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_GRANT')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'motivo', 300)
    if (!motivo) return { error: 'Cancelar una membresía necesita un motivo.' }
    await sinEmpresa('Supply 2.0: cancelar una membresía', (tx) => cancelarMembresiaEnTx(tx, id, motivo, ctx))
    refrescarFidelizacion()
    refrescarCliente()
    return { success: 'Membresía cancelada.', id }
  } catch (e) {
    return comoError(e, 'cancelarMembresia')
  }
}

/** Ajuste manual de puntos: su propio permiso, y EXIGE motivo (§43). */
export async function ajustarPuntosAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_POINTS_ADJUST')
    const ctx = await contextoDeAuditoria(actor)
    const programId = texto(fd, 'programId', 60)
    const customerId = texto(fd, 'customerId', 60)
    const puntos = entero(fd, 'puntos')
    const motivo = texto(fd, 'motivo', 300)
    if (!programId || !customerId) return { error: 'Elige el programa y la persona.' }
    if (puntos == null || puntos === 0) return { error: 'El ajuste tiene que ser un número distinto de cero.' }
    if (!motivo) return { error: 'Un ajuste de puntos necesita un motivo escrito.' }
    const r = await sinEmpresa('Supply 2.0: ajustar puntos a mano', (tx) => ajustarPuntosEnTx(tx, { programId, customerId, puntos, motivo }, ctx))
    refrescarFidelizacion()
    refrescarCliente()
    return { success: `Ajuste registrado. Saldo disponible: ${r.saldo} puntos.`, id: r.movimientoId }
  } catch (e) {
    return comoError(e, 'ajustarPuntos')
  }
}

// ── Proveedor ──────────────────────────────────────────────────────────────

/**
 * Un negocio propone su propio programa. Solo puede proponerlo PARA SÍ: el
 * `supplierId` sale de la sesión, no del formulario.
 */
export async function proponerProgramaAction(_prev: EstadoAccion<ProgramaCreadoDTO>, fd: FormData): Promise<EstadoAccion<ProgramaCreadoDTO>> {
  try {
    const proveedor = await exigirProveedorSupplyV2()
    const ctx = { actorId: proveedor.id, ipAddress: null, userAgent: null }
    const modalidades = fd.getAll('modalities').map(String).filter((m): m is SupplyV2LoyaltyModality => (MODALIDADES as readonly string[]).includes(m))
    if (modalidades.length === 0) return { error: 'Elige al menos una modalidad.' }
    const startsAt = fecha(fd, 'startsAt')
    if (!startsAt) return { error: 'Indica desde cuándo vale el programa.' }
    const creado = await sinEmpresa('Supply 2.0: un negocio propone su programa', (tx) =>
      crearProgramaEnTx(
        tx,
        {
          name: texto(fd, 'name', 120),
          description: texto(fd, 'description', 500) || null,
          objective: texto(fd, 'objective', 300) || null,
          owner: 'SUPPLIER',
          supplierId: proveedor.supplierId,
          funding: 'SUPPLIER',
          modalities: modalidades,
          pointsPerUnit: entero(fd, 'pointsPerUnit'),
          amountPerPoint: numero(fd, 'amountPerPoint'),
          startsAt,
          endsAt: fechaFinDeDia(fd, 'endsAt'),
        },
        ctx
      )
    )
    revalidatePath(RUTA_PORTAL_FIDELIZACION)
    return { success: `Programa ${creado.code} propuesto. Membego lo revisa antes de activarlo.`, id: creado.id, data: creado }
  } catch (e) {
    return comoError<ProgramaCreadoDTO>(e, 'proponerPrograma')
  }
}

/** Comprueba que el programa es de quien lo pide, para las lecturas del portal. */
export async function verificarPropiedadAction(programId: string): Promise<boolean> {
  try {
    const proveedor = await exigirProveedorSupplyV2()
    const p = await sinEmpresa('Supply 2.0: propiedad de un programa', (tx) =>
      tx.supplyV2LoyaltyProgram.findUnique({ where: { id: programId }, select: { owner: true, supplierId: true } })
    )
    if (!p) return false
    exigirPropiedadDePrograma(p, { esPlataforma: false, supplierId: proveedor.supplierId })
    return true
  } catch {
    return false
  }
}

// ── Cliente ────────────────────────────────────────────────────────────────

export async function contratarMembresiaAction(_prev: EstadoAccion<{ orderId: string | null }>, fd: FormData): Promise<EstadoAccion<{ orderId: string | null }>> {
  try {
    const cliente = await exigirCliente()
    const planId = texto(fd, 'planId', 60)
    if (!planId) return { error: 'Elige el plan.' }
    const m = await sinEmpresa('Supply 2.0: contratar una membresía', (tx) =>
      contratarMembresiaEnTx(tx, { planId, customerId: cliente.id, idempotencyKey: texto(fd, 'idempotencyKey', 80) || null }, { actorId: cliente.id, ipAddress: null, userAgent: null })
    )
    refrescarCliente()
    return {
      success: m.orderId
        ? `Membresía ${m.code} apartada. Paga para activarla.`
        : `¡Listo! Tu membresía ${m.code} ya está activa.`,
      id: m.id,
      data: { orderId: m.orderId },
    }
  } catch (e) {
    return comoError<{ orderId: string | null }>(e, 'contratarMembresia')
  }
}

export async function miCodigoDeInvitacionAction(_prev: EstadoAccion<{ code: string }>, fd: FormData): Promise<EstadoAccion<{ code: string }>> {
  try {
    const cliente = await exigirCliente()
    const programId = texto(fd, 'programId', 60)
    if (!programId) return { error: 'Elige el programa.' }
    const c = await sinEmpresa('Supply 2.0: código de invitación de un cliente', (tx) =>
      codigoDeReferidoEnTx(tx, programId, cliente.id)
    )
    refrescarCliente()
    return { success: 'Este es tu código.', id: c.id, data: { code: c.code } }
  } catch (e) {
    return comoError<{ code: string }>(e, 'miCodigoDeInvitacion')
  }
}

/**
 * Alguien llegó con un enlace de invitación y se registró. El código se
 * resuelve en el SERVIDOR; saberlo no salta ninguna regla.
 */
export async function usarInvitacionAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const cliente = await exigirCliente()
    // Dos cubos, como los cupones del Slice 7: por persona y por IP. Con uno
    // solo, muchas cuentas desde el mismo sitio no se frenan entre ellas.
    const meta = await getRequestMeta()
    const permitido = await limitadorInvitaciones(`cliente:${cliente.id}`)
    const permitidoIp = meta.ipAddress ? await limitadorInvitaciones(`ip:${meta.ipAddress}`) : true
    if (!permitido || !permitidoIp) return { error: 'Demasiados intentos con códigos. Espera unos minutos y vuelve a probar.' }
    const codigo = texto(fd, 'codigo', 40)
    if (!codigo) return { error: 'Escribe el código de invitación.' }
    const r = await sinEmpresa('Supply 2.0: usar una invitación', (tx) =>
      atribuirRegistroEnTx(tx, { codigo, referredId: cliente.id }, { actorId: cliente.id, ipAddress: null, userAgent: null })
    )
    refrescarCliente()
    return { success: r.repetido ? 'Ya estabas registrado con esa invitación.' : 'Invitación aplicada. Tu primera compra válida premiará a quien te invitó.', id: r.id }
  } catch (e) {
    return comoError(e, 'usarInvitacion')
  }
}

export async function abrirInvitacionAction(codigo: string): Promise<{ ok: boolean; programa?: string }> {
  try {
    const r = await sinEmpresa('Supply 2.0: abrir un enlace de invitación', (tx) => registrarAperturaEnTx(tx, codigo))
    return { ok: true, programa: r.programId }
  } catch {
    // Mensaje opaco: no se dice si el código no existe o no vale.
    return { ok: false }
  }
}

export async function reclamarRecompensaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const cliente = await exigirCliente()
    const rewardId = texto(fd, 'rewardId', 60)
    if (!rewardId) return { error: 'Elige la recompensa.' }
    const r = await sinEmpresa('Supply 2.0: reclamar una recompensa', (tx) =>
      reclamarRecompensaEnTx(tx, { rewardId, customerId: cliente.id, idempotencyKey: texto(fd, 'idempotencyKey', 80) || null }, { actorId: cliente.id, ipAddress: null, userAgent: null })
    )
    refrescarCliente()
    return { success: `¡Listo! Recompensa ${r.code} reclamada: usaste ${r.puntosConsumidos} puntos. Ya puedes usarla en tus compras.`, id: r.id }
  } catch (e) {
    return comoError(e, 'reclamarRecompensa')
  }
}
