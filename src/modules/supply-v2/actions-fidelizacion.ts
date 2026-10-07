'use server'

import { revalidatePath } from 'next/cache'
import type {
  SupplyV2LoyaltyModality,
  SupplyV2LoyaltyOwner,
  SupplyV2MembershipBenefitKind,
  SupplyV2MembershipPlanKind,
  SupplyV2ReferralRewardKind,
  SupplyV2RewardKind,
} from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { exigirCliente, exigirPermisoSupplyV2 } from './permisos'
import { comoError, contextoDeAuditoria, entero, fecha, fechaFinDeDia, texto, type EstadoAccion } from './actions-util'
import {
  actualizarPlanEnTx,
  adjuntarBeneficioAPlanEnTx,
  aprobarProgramaEnTx,
  archivarPlanEnTx,
  cancelarProgramaEnTx,
  crearPlanEnTx,
  crearProgramaEnTx,
  enviarProgramaARevisionEnTx,
  pausarPlanEnTx,
  pausarProgramaEnTx,
  publicarPlanEnTx,
  quitarBeneficioDePlanEnTx,
  reanudarProgramaEnTx,
  rechazarProgramaEnTx,
  type ProgramaCreado,
} from './loyalty/programs'
import { cancelarMembresiaEnTx, contratarMembresiaEnTx, otorgarMembresiaEnTx, reactivarMembresiaEnTx, suspenderMembresiaEnTx, type MembresiaCreada } from './loyalty/memberships'
import { ajustarPuntosEnTx } from './loyalty/points'
import { aprobarRecompensaEnTx, crearRecompensaEnTx, pausarRecompensaEnTx, reclamarRecompensaEnTx, reversarReclamacionEnTx, type ReclamacionHecha } from './loyalty/rewards'
import { anularReferidoEnTx, aprobarYConcederEnTx, codigoDeReferidoEnTx, configurarReferidosEnTx } from './loyalty/referrals'
import { MODALIDADES, PROPIETARIOS, TIPOS_DE_PLAN, TIPOS_DE_RECOMPENSA } from './loyalty/domain'
import { RUTA_FIDELIZACION, RUTA_FIDELIZACION_CLIENTE, RUTA_MEMBRESIAS_PUBLICAS, RUTA_PORTAL_FIDELIZACION } from './core/catalogo'

/**
 * MEMBEGO SUPPLY · SLICE 8 · server actions de FIDELIZACIÓN.
 *
 * GUARDIA (permiso de plataforma, o sesión del cliente) → REGLA (en
 * `loyalty/`, dentro de UNA transacción, con bitácora) → `{ error }` o
 * `{ success }`.
 *
 * Los once permisos del slice están separados a propósito: ver no es crear,
 * crear no es aprobar, aprobar un programa no es otorgar una membresía, y
 * ajustar los puntos de alguien a mano tiene el suyo porque es la operación
 * que más se puede abusar. Aquí es donde por fin se exigen: ocultar un botón
 * no es una protección.
 *
 * Lo que hace el CLIENTE con su propia cuenta —contratar un plan publicado,
 * reclamar una recompensa, pedir su código de invitación— no pasa por permisos
 * de plataforma: pasa por `exigirCliente`, y el servidor comprueba que lo que
 * toca es suyo.
 */

function refrescarFidelizacion(id?: string): void {
  revalidatePath(RUTA_FIDELIZACION)
  if (id) revalidatePath(`${RUTA_FIDELIZACION}/${id}`)
  revalidatePath(RUTA_MEMBRESIAS_PUBLICAS)
  revalidatePath(RUTA_FIDELIZACION_CLIENTE)
  revalidatePath(RUTA_PORTAL_FIDELIZACION)
}

// ── Programa (§3–§10) ───────────────────────────────────────────────────────

export async function crearProgramaAction(_prev: EstadoAccion<ProgramaCreado>, fd: FormData): Promise<EstadoAccion<ProgramaCreado>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    const owner = texto(fd, 'owner', 20) as SupplyV2LoyaltyOwner
    if (!PROPIETARIOS.includes(owner)) return { error: 'Indica quién administra el programa.' }
    const funding = texto(fd, 'funding', 20) as 'MEMBEGO' | 'SUPPLIER' | 'SHARED'
    if (!['MEMBEGO', 'SUPPLIER', 'SHARED'].includes(funding)) return { error: 'Indica quién financia el programa.' }
    const modalities = fd.getAll('modalities').map((v) => String(v)) as SupplyV2LoyaltyModality[]
    if (modalities.length === 0) return { error: 'Elige al menos una modalidad: membresías, referidos, puntos o recompensas.' }
    for (const m of modalities) if (!MODALIDADES.includes(m)) return { error: 'Hay una modalidad que no existe.' }
    const startsAt = fecha(fd, 'startsAt')
    if (!startsAt) return { error: 'Indica desde cuándo vale el programa.' }

    const creado = await sinEmpresa('Supply: alta de un programa de fidelización', (tx) =>
      crearProgramaEnTx(
        tx,
        {
          name: texto(fd, 'name', 140),
          description: texto(fd, 'description', 2000) || null,
          objective: texto(fd, 'objective', 300) || null,
          owner,
          supplierId: texto(fd, 'supplierId', 60) || null,
          funding,
          modalities,
          budgetTotal: texto(fd, 'budgetTotal', 20) || null,
          budgetWaiverReason: texto(fd, 'budgetWaiverReason', 500) || null,
          pointsPerUnit: entero(fd, 'pointsPerUnit'),
          amountPerPoint: texto(fd, 'amountPerPoint', 20) || null,
          accrualBasis: (texto(fd, 'accrualBasis', 30) || null) as 'CUSTOMER_PAID' | 'CONTRACTUAL_VALUE' | null,
          pointsExpireDays: entero(fd, 'pointsExpireDays'),
          pointsHoldDays: entero(fd, 'pointsHoldDays'),
          startsAt,
          endsAt: fechaFinDeDia(fd, 'endsAt'),
        },
        ctx
      )
    )
    refrescarFidelizacion(creado.id)
    return { success: `Programa ${creado.code} creado como borrador. Añade sus planes y recompensas, y pídele a otra persona autorizada que lo apruebe.`, id: creado.id, data: creado }
  } catch (e) {
    return comoError<ProgramaCreado>(e, 'crearPrograma')
  }
}

export async function enviarProgramaARevisionAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    const r = await sinEmpresa('Supply: enviar un programa a revisión', (tx) => enviarProgramaARevisionEnTx(tx, id, ctx))
    refrescarFidelizacion(id)
    return { success: r.repetido ? 'Ese programa ya estaba en revisión.' : 'Programa en revisión: otra persona autorizada tiene que aprobarlo.', id }
  } catch (e) {
    return comoError(e, 'enviarProgramaARevision')
  }
}

export async function aprobarProgramaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const r = await sinEmpresa('Supply: aprobar un programa de fidelización', (tx) => aprobarProgramaEnTx(tx, id, ctx))
    refrescarFidelizacion(id)
    return { success: r.repetido ? 'Ese programa ya estaba aprobado.' : 'Programa aprobado y activo: sus planes publicados ya los ven los clientes.', id }
  } catch (e) {
    return comoError(e, 'aprobarPrograma')
  }
}

export async function rechazarProgramaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const notas = texto(fd, 'motivo', 500)
    if (!notas) return { error: 'Escribe por qué se devuelve el programa.' }
    await sinEmpresa('Supply: rechazar un programa de fidelización', (tx) => rechazarProgramaEnTx(tx, id, notas, ctx))
    refrescarFidelizacion(id)
    return { success: 'Programa devuelto a borrador con tu motivo.', id }
  } catch (e) {
    return comoError(e, 'rechazarPrograma')
  }
}

export async function pausarProgramaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply: pausar un programa de fidelización', (tx) => pausarProgramaEnTx(tx, id, ctx))
    refrescarFidelizacion(id)
    return { success: 'Programa pausado: no acumula puntos nuevos ni admite contrataciones.', id }
  } catch (e) {
    return comoError(e, 'pausarPrograma')
  }
}

export async function reanudarProgramaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply: reanudar un programa de fidelización', (tx) => reanudarProgramaEnTx(tx, id, ctx))
    refrescarFidelizacion(id)
    return { success: 'Programa activo otra vez.', id }
  } catch (e) {
    return comoError(e, 'reanudarPrograma')
  }
}

export async function cancelarProgramaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'motivo', 500)
    if (!motivo) return { error: 'Escribe por qué se cancela el programa.' }
    const r = await sinEmpresa('Supply: cancelar un programa de fidelización', (tx) => cancelarProgramaEnTx(tx, id, motivo, ctx))
    refrescarFidelizacion(id)
    return { success: `Programa cancelado y ${r.planesArchivados} plan(es) archivado(s). Las membresías vivas siguen su curso.`, id }
  } catch (e) {
    return comoError(e, 'cancelarPrograma')
  }
}

// ── Planes de membresía (§11–§16) ───────────────────────────────────────────

export async function crearPlanAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const kind = texto(fd, 'kind', 20) as SupplyV2MembershipPlanKind
    if (!TIPOS_DE_PLAN.includes(kind)) return { error: 'Indica si el plan es gratuito, de pago u otorgado.' }
    const durationDays = entero(fd, 'durationDays')
    if (!durationDays) return { error: 'Indica cuántos días dura el plan.' }
    const r = await sinEmpresa('Supply: crear un plan de membresía', (tx) =>
      crearPlanEnTx(
        tx,
        id,
        {
          name: texto(fd, 'name', 140),
          description: texto(fd, 'description', 2000) || null,
          kind,
          price: kind === 'PAID' ? texto(fd, 'price', 20) || null : null,
          durationDays,
          maxMembers: entero(fd, 'maxMembers'),
          maxAdvanceRenewals: entero(fd, 'maxAdvanceRenewals'),
        },
        ctx
      )
    )
    refrescarFidelizacion(id)
    return { success: `Plan ${r.code} creado. Añade sus beneficios y publícalo cuando esté listo.`, id }
  } catch (e) {
    return comoError(e, 'crearPlan')
  }
}

export async function actualizarPlanAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const kind = texto(fd, 'kind', 20) as SupplyV2MembershipPlanKind
    if (!TIPOS_DE_PLAN.includes(kind)) return { error: 'Indica si el plan es gratuito, de pago u otorgado.' }
    const durationDays = entero(fd, 'durationDays')
    if (!durationDays) return { error: 'Indica cuántos días dura el plan.' }
    const r = await sinEmpresa('Supply: modificar un plan de membresía', (tx) =>
      actualizarPlanEnTx(
        tx,
        texto(fd, 'planId', 60),
        {
          name: texto(fd, 'name', 140),
          description: texto(fd, 'description', 2000) || null,
          kind,
          price: kind === 'PAID' ? texto(fd, 'price', 20) || null : null,
          durationDays,
          maxMembers: entero(fd, 'maxMembers'),
          maxAdvanceRenewals: entero(fd, 'maxAdvanceRenewals'),
        },
        ctx
      )
    )
    refrescarFidelizacion(id)
    return {
      success: r.versionNueva
        ? `Plan actualizado: cambió el precio o la duración, así que ahora es la versión ${r.version}. Lo ya vendido conserva su versión.`
        : 'Plan actualizado. No cambió ni el precio ni la duración, así que la versión es la misma.',
      id,
    }
  } catch (e) {
    return comoError(e, 'actualizarPlan')
  }
}

export async function publicarPlanAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const r = await sinEmpresa('Supply: publicar un plan de membresía', (tx) => publicarPlanEnTx(tx, texto(fd, 'planId', 60), ctx))
    refrescarFidelizacion(id)
    return { success: r.repetido ? 'Ese plan ya estaba publicado.' : 'Plan publicado: ya lo ven los clientes y se puede contratar.', id }
  } catch (e) {
    return comoError(e, 'publicarPlan')
  }
}

export async function pausarPlanAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply: pausar un plan de membresía', (tx) => pausarPlanEnTx(tx, texto(fd, 'planId', 60), ctx))
    refrescarFidelizacion(id)
    return { success: 'Plan pausado: deja de poder contratarse. Lo ya vendido sigue vigente.', id }
  } catch (e) {
    return comoError(e, 'pausarPlan')
  }
}

export async function archivarPlanAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const r = await sinEmpresa('Supply: archivar un plan de membresía', (tx) => archivarPlanEnTx(tx, texto(fd, 'planId', 60), ctx))
    refrescarFidelizacion(id)
    return { success: `Plan archivado. ${r.miembrosVivos} membresía(s) viva(s) siguen su curso hasta vencer: archivar no cancela lo vendido.`, id }
  } catch (e) {
    return comoError(e, 'archivarPlan')
  }
}

export async function adjuntarBeneficioAPlanAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const kind = texto(fd, 'kind', 30) as SupplyV2MembershipBenefitKind
    if (!['BENEFIT', 'COUPON', 'POINTS_MULTIPLIER', 'EARLY_ACCESS'].includes(kind)) return { error: 'Indica qué incluye el plan.' }
    await sinEmpresa('Supply: añadir un beneficio a un plan', (tx) =>
      adjuntarBeneficioAPlanEnTx(
        tx,
        texto(fd, 'planId', 60),
        {
          kind,
          benefitId: texto(fd, 'benefitId', 60) || null,
          grantsCoupon: texto(fd, 'grantsCoupon', 5) === 'si',
          usesPerPeriod: entero(fd, 'usesPerPeriod'),
          pointsMultiplier: texto(fd, 'pointsMultiplier', 10) || null,
          earlyAccessHours: entero(fd, 'earlyAccessHours'),
        },
        ctx
      )
    )
    refrescarFidelizacion(id)
    return { success: 'Beneficio añadido al plan. Se concederá al activarse cada membresía.', id }
  } catch (e) {
    return comoError(e, 'adjuntarBeneficioAPlan')
  }
}

export async function quitarBeneficioDePlanAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply: quitar un beneficio de un plan', (tx) => quitarBeneficioDePlanEnTx(tx, texto(fd, 'membershipBenefitId', 60), ctx))
    refrescarFidelizacion(id)
    return { success: 'Beneficio quitado del plan. Lo ya concedido a los miembros no se toca.', id }
  } catch (e) {
    return comoError(e, 'quitarBeneficioDePlan')
  }
}

// ── Membresías de clientes (§17–§20) ────────────────────────────────────────

export async function otorgarMembresiaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_GRANT')
    const ctx = await contextoDeAuditoria(actor)
    const customerId = texto(fd, 'customerId', 60)
    if (!customerId) return { error: 'Elige el cliente que recibe la membresía.' }
    const motivo = texto(fd, 'motivo', 500)
    if (!motivo) return { error: 'Otorgar una membresía sin cobrarla exige un motivo escrito.' }
    const r = await sinEmpresa('Supply: otorgar una membresía', (tx) =>
      otorgarMembresiaEnTx(tx, { planId: texto(fd, 'planId', 60), customerId, motivo, dias: entero(fd, 'dias') }, ctx)
    )
    refrescarFidelizacion(id)
    return { success: `Membresía ${r.code} otorgada y activa, con tu motivo en la bitácora.`, id }
  } catch (e) {
    return comoError(e, 'otorgarMembresia')
  }
}

export async function cancelarMembresiaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_GRANT')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'motivo', 500)
    if (!motivo) return { error: 'Cancelar una membresía exige un motivo escrito.' }
    const r = await sinEmpresa('Supply: cancelar una membresía', (tx) => cancelarMembresiaEnTx(tx, texto(fd, 'membershipId', 60), motivo, ctx))
    refrescarFidelizacion(id)
    return { success: r.repetida ? 'Esa membresía ya estaba cancelada.' : 'Membresía cancelada.', id }
  } catch (e) {
    return comoError(e, 'cancelarMembresia')
  }
}

export async function suspenderMembresiaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_GRANT')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'motivo', 500)
    if (!motivo) return { error: 'Suspender una membresía exige un motivo escrito.' }
    await sinEmpresa('Supply: suspender una membresía', (tx) => suspenderMembresiaEnTx(tx, texto(fd, 'membershipId', 60), motivo, ctx))
    refrescarFidelizacion(id)
    return { success: 'Membresía suspendida: sus beneficios dejan de aplicarse hasta que se reactive.', id }
  } catch (e) {
    return comoError(e, 'suspenderMembresia')
  }
}

export async function reactivarMembresiaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_GRANT')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply: reactivar una membresía', (tx) => reactivarMembresiaEnTx(tx, texto(fd, 'membershipId', 60), ctx))
    refrescarFidelizacion(id)
    return { success: 'Membresía activa otra vez.', id }
  } catch (e) {
    return comoError(e, 'reactivarMembresia')
  }
}

// ── Puntos (§24–§29, §43) ───────────────────────────────────────────────────

export async function ajustarPuntosAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    // Permiso propio: es la operación de fidelización que más se puede abusar.
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_POINTS_ADJUST')
    const ctx = await contextoDeAuditoria(actor)
    const customerId = texto(fd, 'customerId', 60)
    if (!customerId) return { error: 'Elige el cliente cuyos puntos se ajustan.' }
    const puntos = entero(fd, 'puntos')
    if (puntos == null || puntos === 0) return { error: 'Indica cuántos puntos sumar (positivo) o quitar (negativo).' }
    const motivo = texto(fd, 'motivo', 500)
    if (!motivo) return { error: 'Un ajuste de puntos a mano exige un motivo escrito: queda en la bitácora y no se borra.' }
    const r = await sinEmpresa('Supply: ajustar los puntos de un cliente', (tx) => ajustarPuntosEnTx(tx, { programId: id, customerId, puntos, motivo }, ctx))
    refrescarFidelizacion(id)
    return { success: `Ajuste registrado. El cliente queda con ${r.saldo} punto(s) disponible(s).`, id }
  } catch (e) {
    return comoError(e, 'ajustarPuntos')
  }
}

// ── Recompensas (§30–§35) ───────────────────────────────────────────────────

export async function crearRecompensaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_REWARD_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const kind = texto(fd, 'kind', 30) as SupplyV2RewardKind
    if (!TIPOS_DE_RECOMPENSA.includes(kind)) return { error: 'Indica qué tipo de recompensa es.' }
    const startsAt = fecha(fd, 'startsAt')
    if (!startsAt) return { error: 'Indica desde cuándo se puede pedir.' }
    const r = await sinEmpresa('Supply: crear una recompensa', (tx) =>
      crearRecompensaEnTx(
        tx,
        id,
        {
          name: texto(fd, 'name', 140),
          kind,
          pointsCost: entero(fd, 'pointsCost'),
          benefitId: texto(fd, 'benefitId', 60) || null,
          offerId: texto(fd, 'offerId', 60) || null,
          unitCost: texto(fd, 'unitCost', 20) || null,
          budgetTotal: texto(fd, 'budgetTotal', 20) || null,
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
    refrescarFidelizacion(id)
    return { success: `Recompensa ${r.code} creada como borrador. Tiene que aprobarla otra persona autorizada antes de repartir nada.`, id }
  } catch (e) {
    return comoError(e, 'crearRecompensa')
  }
}

export async function aprobarRecompensaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_REWARD_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const r = await sinEmpresa('Supply: aprobar una recompensa', (tx) => aprobarRecompensaEnTx(tx, texto(fd, 'rewardId', 60), ctx))
    refrescarFidelizacion(id)
    return { success: r.repetido ? 'Esa recompensa ya estaba aprobada.' : 'Recompensa aprobada y activa: los clientes ya pueden canjear sus puntos por ella.', id }
  } catch (e) {
    return comoError(e, 'aprobarRecompensa')
  }
}

export async function pausarRecompensaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_REWARD_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply: pausar una recompensa', (tx) => pausarRecompensaEnTx(tx, texto(fd, 'rewardId', 60), ctx))
    refrescarFidelizacion(id)
    return { success: 'Recompensa pausada: deja de poder reclamarse. Lo ya reclamado sigue su curso.', id }
  } catch (e) {
    return comoError(e, 'pausarRecompensa')
  }
}

export async function reversarReclamacionAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_REWARD_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'motivo', 500)
    if (!motivo) return { error: 'Reversar una reclamación exige un motivo escrito.' }
    const r = await sinEmpresa('Supply: reversar una reclamación de recompensa', (tx) => reversarReclamacionEnTx(tx, texto(fd, 'claimId', 60), motivo, ctx))
    refrescarFidelizacion(id)
    return {
      success:
        r.puntosDevueltos > 0
          ? `Reclamación reversada y ${r.puntosDevueltos} punto(s) devuelto(s) al cliente.`
          : 'Reclamación reversada. Lo ya entregado no devuelve puntos: el costo ya se realizó.',
      id,
    }
  } catch (e) {
    return comoError(e, 'reversarReclamacion')
  }
}

// ── Referidos (§18–§23) ─────────────────────────────────────────────────────

export async function configurarReferidosAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_REFERRAL_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const rewardKind = texto(fd, 'rewardKind', 30) as SupplyV2ReferralRewardKind
    if (!['POINTS', 'BONUS', 'COUPON', 'SUPPLIER_BENEFIT'].includes(rewardKind)) return { error: 'Indica con qué se premia al que invita.' }
    await sinEmpresa('Supply: configurar el programa de referidos', (tx) =>
      configurarReferidosEnTx(
        tx,
        id,
        {
          rewardKind,
          rewardBenefitId: texto(fd, 'rewardBenefitId', 60) || null,
          rewardPoints: entero(fd, 'rewardPoints'),
          rewardAmount: texto(fd, 'rewardAmount', 20) || null,
          requiresFirstPurchase: texto(fd, 'requiresFirstPurchase', 5) !== 'no',
          minPurchaseAmount: texto(fd, 'minPurchaseAmount', 20) || null,
          requiresPaymentConfirmed: texto(fd, 'requiresPaymentConfirmed', 5) !== 'no',
          waitingPeriodDays: entero(fd, 'waitingPeriodDays'),
          maxPerReferrer: entero(fd, 'maxPerReferrer'),
          maxTotal: entero(fd, 'maxTotal'),
          budgetTotal: texto(fd, 'budgetTotal', 20) || null,
        },
        ctx
      )
    )
    refrescarFidelizacion(id)
    return { success: 'Referidos configurados. Cada cliente ya puede pedir su código.', id }
  } catch (e) {
    return comoError(e, 'configurarReferidos')
  }
}

export async function aprobarReferidoAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_REFERRAL_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const r = await sinEmpresa('Supply: conceder el premio de un referido', (tx) => aprobarYConcederEnTx(tx, texto(fd, 'referralId', 60), ctx))
    refrescarFidelizacion(id)
    return r.concedida ? { success: 'Premio concedido a quien invitó.', id } : { error: r.motivo ?? 'Ese referido todavía no cumple las condiciones.' }
  } catch (e) {
    return comoError(e, 'aprobarReferido')
  }
}

export async function anularReferidoAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'programId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_REFERRAL_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'motivo', 500)
    if (!motivo) return { error: 'Anular una invitación exige un motivo escrito.' }
    await sinEmpresa('Supply: anular un referido', (tx) => anularReferidoEnTx(tx, texto(fd, 'referralId', 60), motivo, ctx))
    refrescarFidelizacion(id)
    return { success: 'Invitación anulada. Es definitivo.', id }
  } catch (e) {
    return comoError(e, 'anularReferido')
  }
}

// ── Lo que hace el CLIENTE con su propia cuenta ─────────────────────────────

/**
 * Contratar un plan publicado. Si es de pago, abre el pedido de membresía por
 * el checkout de siempre y el cliente sigue a pagarlo; si es gratuito, la
 * membresía queda activa en el acto. La clave de idempotencia impide que el
 * doble clic compre dos veces.
 */
export async function contratarMembresiaAction(_prev: EstadoAccion<MembresiaCreada>, fd: FormData): Promise<EstadoAccion<MembresiaCreada>> {
  try {
    const cliente = await exigirCliente()
    const ctx = await contextoDeAuditoria(cliente)
    const planId = texto(fd, 'planId', 60)
    if (!planId) return { error: 'Elige el plan que quieres contratar.' }
    const r = await sinEmpresa('Supply: un cliente contrata una membresía', (tx) =>
      contratarMembresiaEnTx(tx, { planId, customerId: cliente.id, idempotencyKey: texto(fd, 'idempotencyKey', 80) || null }, ctx)
    )
    revalidatePath(RUTA_FIDELIZACION_CLIENTE)
    revalidatePath(RUTA_MEMBRESIAS_PUBLICAS)
    revalidatePath('/cliente/compras')
    return {
      success: r.orderId
        ? 'Membresía reservada. Te falta pagarla para que empiece.'
        : '¡Listo! Tu membresía ya está activa y sus beneficios están en tu cuenta.',
      id: r.orderId ?? r.id,
      data: r,
    }
  } catch (e) {
    return comoError<MembresiaCreada>(e, 'contratarMembresia')
  }
}

/** Canjear puntos por una recompensa. El servidor comprueba el saldo; la pantalla no. */
export async function reclamarRecompensaAction(_prev: EstadoAccion<ReclamacionHecha>, fd: FormData): Promise<EstadoAccion<ReclamacionHecha>> {
  try {
    const cliente = await exigirCliente()
    const ctx = await contextoDeAuditoria(cliente)
    const rewardId = texto(fd, 'rewardId', 60)
    if (!rewardId) return { error: 'Elige la recompensa que quieres.' }
    const r = await sinEmpresa('Supply: un cliente reclama una recompensa', (tx) =>
      reclamarRecompensaEnTx(tx, { rewardId, customerId: cliente.id, idempotencyKey: texto(fd, 'idempotencyKey', 80) || null }, ctx)
    )
    revalidatePath(RUTA_FIDELIZACION_CLIENTE)
    revalidatePath('/cliente/compras')
    return {
      success: r.repetida
        ? 'Ya habías pedido esta recompensa: está en tu cuenta.'
        : `¡Listo! Usaste ${r.puntosConsumidos} punto(s). Tu recompensa ${r.code} ya está en tu cuenta, lista para usar.`,
      id: r.id,
      data: r,
    }
  } catch (e) {
    return comoError<ReclamacionHecha>(e, 'reclamarRecompensa')
  }
}

/** Pedir (o recuperar) mi código de invitación de un programa. */
export async function miCodigoDeReferidoAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const cliente = await exigirCliente()
    const ctx = await contextoDeAuditoria(cliente)
    const programId = texto(fd, 'programId', 60)
    if (!programId) return { error: 'No sabemos de qué programa quieres tu código.' }
    void ctx
    const r = await sinEmpresa('Supply: código de invitación de un cliente', (tx) => codigoDeReferidoEnTx(tx, programId, cliente.id))
    revalidatePath(RUTA_FIDELIZACION_CLIENTE)
    return { success: r.repetido ? `Tu código es ${r.code}.` : `Tu código de invitación es ${r.code}. Compártelo: cobras cuando quien lo use haga su primera compra válida.`, id: r.code }
  } catch (e) {
    return comoError(e, 'miCodigoDeReferido')
  }
}

/** Buscador de clientes de los formularios de fidelización. */
export async function buscarClientesFidelizacionAction(query: string): Promise<{ id: string; nombre: string; email: string }[]> {
  await exigirPermisoSupplyV2('SUPPLY_V2_MEMBERSHIP_GRANT')
  const q = query.trim()
  if (q.length < 2) return []
  const filas = await sinEmpresa('Supply: buscar clientes para fidelización', (tx) =>
    tx.user.findMany({
      where: { role: 'CLIENTE', OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] },
      orderBy: { name: 'asc' },
      take: 20,
      select: { id: true, name: true, email: true },
    })
  )
  return filas.map((u) => ({ id: u.id, nombre: u.name, email: u.email }))
}
