import type {
  SupplyV2BenefitFunding,
  SupplyV2CustomerMembershipStatus,
  SupplyV2LoyaltyModality,
  SupplyV2LoyaltyOwner,
  SupplyV2LoyaltyProgramStatus,
  SupplyV2MembershipPlanKind,
  SupplyV2MembershipPlanStatus,
  SupplyV2PointsAccrualBasis,
  SupplyV2PointsMovementType,
  SupplyV2ReferralRewardKind,
  SupplyV2ReferralStatus,
  SupplyV2RewardClaimStatus,
  SupplyV2RewardKind,
  SupplyV2RewardStatus,
} from '@prisma/client'
import { Prisma } from '@prisma/client'
import { decimal, redondear2, type Decimal } from '../core/dinero'
import type { Transiciones } from '../core/estados'

/**
 * MEMBEGO SUPPLY · SLICE 8 · FIDELIZACIÓN: reglas PURAS.
 *
 * Sin Prisma más que para los tipos y `Decimal`. Todo lo de aquí se prueba
 * SIN base de datos (`tests/supply-v2-slice8-dominio.test.ts`).
 *
 * DOS UNIDADES QUE NO SE MEZCLAN
 *
 *   · El dinero es `Prisma.Decimal` y se redondea con `redondear2`.
 *   · Los PUNTOS son enteros. No son dinero: no se convierten en saldo
 *     retirable ni en una cuenta monetaria (§24). Cuando hace falta estimar
 *     lo que podrían llegar a costar, eso es una ESTIMACIÓN y se devuelve
 *     etiquetada como tal (§37).
 */

const CERO = new Prisma.Decimal(0)

// ════════════════════════════════════════════════════════════════════════════
// 1 · PROGRAMA DE FIDELIZACIÓN (§4–§8)
// ════════════════════════════════════════════════════════════════════════════

export const PROPIETARIOS: readonly SupplyV2LoyaltyOwner[] = ['MEMBEGO', 'SUPPLIER']
export const MODALIDADES: readonly SupplyV2LoyaltyModality[] = ['MEMBERSHIPS', 'REFERRALS', 'POINTS', 'REWARDS']
export const BASES_ACUMULACION: readonly SupplyV2PointsAccrualBasis[] = ['CONTRACTUAL_VALUE', 'CUSTOMER_PAID']

export interface DatosPrograma {
  name: string
  description?: string | null
  objective?: string | null
  owner: SupplyV2LoyaltyOwner
  supplierId?: string | null
  funding: SupplyV2BenefitFunding
  currency?: string | null
  modalities: readonly SupplyV2LoyaltyModality[]
  budgetTotal?: number | string | null
  budgetWaiverReason?: string | null
  budgetWaiverById?: string | null
  /** Puntos que se ganan por cada `amountPerPoint` de compra elegible. */
  pointsPerUnit?: number | null
  amountPerPoint?: number | string | null
  accrualBasis?: SupplyV2PointsAccrualBasis | null
  pointsExpireDays?: number | null
  pointsHoldDays?: number | null
  startsAt: Date
  endsAt?: Date | null
}

export function validarPrograma(d: DatosPrograma): string | null {
  if (!d.name?.trim()) return 'El programa necesita un nombre.'
  if (d.name.trim().length > 120) return 'El nombre es demasiado largo.'
  if (!PROPIETARIOS.includes(d.owner)) return 'Indica quién administra el programa.'
  if (d.owner === 'SUPPLIER' && !d.supplierId) return 'Un programa de un negocio necesita saber de qué negocio es.'
  if (d.funding !== 'MEMBEGO' && !d.supplierId) return 'Si el negocio pone dinero, hay que decir qué negocio.'
  if (!d.modalities?.length) return 'Elige al menos una modalidad: membresías, referidos, puntos o recompensas.'
  for (const m of d.modalities) {
    if (!MODALIDADES.includes(m)) return 'Hay una modalidad que no existe.'
  }
  if (new Set(d.modalities).size !== d.modalities.length) return 'Hay una modalidad repetida.'

  if (d.budgetTotal != null && d.budgetTotal !== '') {
    let b: Decimal
    try {
      b = decimal(d.budgetTotal)
    } catch {
      return 'El presupuesto tiene que ser un número.'
    }
    if (!b.isFinite() || b.lessThanOrEqualTo(0)) return 'El presupuesto tiene que ser mayor que cero.'
  } else if (d.funding !== 'SUPPLIER' && !(d.budgetWaiverById && d.budgetWaiverReason?.trim())) {
    // §17 del Slice 7, que aquí se mantiene: si Membego pone dinero, hay techo
    // o hay alguien que firma que no lo hay.
    return 'Un programa que compromete dinero de Membego necesita un presupuesto máximo. Para ir sin él hace falta un motivo escrito y quién lo autoriza.'
  }

  // La regla de acumulación va completa o vacía: media regla no acumula nada.
  const tienePuntos = d.pointsPerUnit != null && d.pointsPerUnit !== 0
  const tieneImporte = d.amountPerPoint != null && d.amountPerPoint !== ''
  if (tienePuntos !== tieneImporte) {
    return 'La regla de puntos va completa: cuántos puntos y por cada cuánto. Ejemplo: 1 punto por cada RD$100.'
  }
  if (tienePuntos) {
    if (!Number.isInteger(d.pointsPerUnit) || d.pointsPerUnit! <= 0) return 'Los puntos por compra tienen que ser un entero positivo.'
    const a = decimal(d.amountPerPoint!)
    if (!a.isFinite() || a.lessThanOrEqualTo(0)) return 'El importe por punto tiene que ser mayor que cero.'
  }
  if (d.modalities.includes('POINTS') && !tienePuntos) {
    return 'Un programa de puntos necesita su regla de acumulación.'
  }
  if (d.accrualBasis && !BASES_ACUMULACION.includes(d.accrualBasis)) return 'La base de acumulación no existe.'
  if (d.pointsExpireDays != null && (!Number.isInteger(d.pointsExpireDays) || d.pointsExpireDays <= 0)) {
    return 'Los días hasta el vencimiento de los puntos tienen que ser un entero positivo (o dejarse vacío: no vencen).'
  }
  if (d.pointsHoldDays != null && (!Number.isInteger(d.pointsHoldDays) || d.pointsHoldDays < 0)) {
    return 'Los días que los puntos quedan pendientes no pueden ser negativos.'
  }

  if (!(d.startsAt instanceof Date) || Number.isNaN(d.startsAt.getTime())) return 'La fecha de inicio no es válida.'
  if (d.endsAt) {
    if (Number.isNaN(d.endsAt.getTime())) return 'La fecha de cierre no es válida.'
    if (d.endsAt <= d.startsAt) return 'El cierre tiene que ser posterior al inicio.'
  }
  return null
}

export const TRANSICIONES_PROGRAMA: Transiciones<SupplyV2LoyaltyProgramStatus> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  /** Rechazar devuelve a borrador con las notas de revisión. */
  PENDING_APPROVAL: ['ACTIVE', 'DRAFT', 'CANCELLED'],
  ACTIVE: ['PAUSED', 'COMPLETED', 'CANCELLED'],
  PAUSED: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

export const PROGRAMA_CERRADO: readonly SupplyV2LoyaltyProgramStatus[] = ['COMPLETED', 'CANCELLED']

export type MotivoProgramaInactivo = 'NO_ACTIVO' | 'NO_EMPEZO' | 'TERMINO'

export const MENSAJES_PROGRAMA_INACTIVO: Record<MotivoProgramaInactivo, string> = {
  NO_ACTIVO: 'Este programa no está activo ahora mismo.',
  NO_EMPEZO: 'Este programa todavía no empieza.',
  TERMINO: 'Este programa ya terminó.',
}

export function motivoProgramaInactivo(
  p: { status: SupplyV2LoyaltyProgramStatus; startsAt: Date; endsAt: Date | null },
  ahora = new Date()
): MotivoProgramaInactivo | null {
  if (p.status !== 'ACTIVE') return p.status === 'COMPLETED' ? 'TERMINO' : 'NO_ACTIVO'
  if (p.startsAt > ahora) return 'NO_EMPEZO'
  if (p.endsAt && p.endsAt <= ahora) return 'TERMINO'
  return null
}

/**
 * ¿Puede esta persona administrar este programa? (§8)
 *
 * Membego administra los suyos y supervisa todos. Un negocio administra
 * ÚNICAMENTE los suyos: participar en un programa global no da acceso a nada
 * de otro negocio.
 */
export function puedeAdministrarPrograma(
  p: { owner: SupplyV2LoyaltyOwner; supplierId: string | null },
  actor: { esPlataforma: boolean; supplierId: string | null }
): boolean {
  if (actor.esPlataforma) return true
  if (!actor.supplierId) return false
  return p.owner === 'SUPPLIER' && p.supplierId === actor.supplierId
}

// ════════════════════════════════════════════════════════════════════════════
// 2 · PLANES DE MEMBRESÍA (§9–§11, §14)
// ════════════════════════════════════════════════════════════════════════════

export const TIPOS_DE_PLAN: readonly SupplyV2MembershipPlanKind[] = ['FREE', 'PAID', 'GRANTED']

export interface DatosPlan {
  name: string
  description?: string | null
  kind: SupplyV2MembershipPlanKind
  price?: number | string | null
  durationDays: number
  maxMembers?: number | null
  maxAdvanceRenewals?: number | null
}

export function validarPlan(d: DatosPlan): string | null {
  if (!d.name?.trim()) return 'El plan necesita un nombre.'
  if (d.name.trim().length > 120) return 'El nombre es demasiado largo.'
  if (!TIPOS_DE_PLAN.includes(d.kind)) return 'Indica si el plan es gratuito, de pago u otorgado.'

  let precio: Decimal
  try {
    precio = d.price == null || d.price === '' ? CERO : decimal(d.price)
  } catch {
    return 'El precio tiene que ser un número.'
  }
  if (!precio.isFinite() || precio.isNegative()) return 'El precio no puede ser negativo.'
  if (d.kind === 'PAID' && precio.lessThanOrEqualTo(0)) return 'Un plan de pago necesita un precio mayor que cero.'
  if (d.kind !== 'PAID' && precio.greaterThan(0)) {
    return d.kind === 'FREE'
      ? 'Un plan gratuito no lleva precio.'
      : 'Un plan otorgado no lo paga el cliente, así que no lleva precio.'
  }

  if (!Number.isInteger(d.durationDays) || d.durationDays <= 0) return 'La duración tiene que ser un número entero de días mayor que cero.'
  if (d.durationDays > 3650) return 'La duración no puede pasar de diez años.'
  if (d.maxMembers != null && (!Number.isInteger(d.maxMembers) || d.maxMembers <= 0)) return 'El tope de miembros tiene que ser un entero positivo.'
  if (d.maxAdvanceRenewals != null && (!Number.isInteger(d.maxAdvanceRenewals) || d.maxAdvanceRenewals <= 0)) {
    return 'Los períodos que se pueden comprar por adelantado tienen que ser un entero positivo.'
  }
  return null
}

export const TRANSICIONES_PLAN: Transiciones<SupplyV2MembershipPlanStatus> = {
  DRAFT: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['PAUSED', 'ARCHIVED'],
  PAUSED: ['PUBLISHED', 'ARCHIVED'],
  ARCHIVED: [],
}

/**
 * ¿Hace falta una versión nueva del plan? (§14)
 *
 * Solo cuando cambia lo que se le prometió a quien ya compró: el precio o la
 * duración. Cambiar la descripción no reescribe ningún contrato, y subir una
 * versión por eso solo ensuciaría el historial.
 */
export function exigeVersionNueva(
  antes: { price: Decimal | string | number; durationDays: number },
  despues: { price: Decimal | string | number; durationDays: number }
): boolean {
  return !decimal(antes.price).equals(decimal(despues.price)) || antes.durationDays !== despues.durationDays
}

// ════════════════════════════════════════════════════════════════════════════
// 3 · MEMBRESÍAS (§12–§14)
// ════════════════════════════════════════════════════════════════════════════

export const TRANSICIONES_MEMBRESIA: Transiciones<SupplyV2CustomerMembershipStatus> = {
  PENDING_PAYMENT: ['ACTIVE', 'SCHEDULED', 'CANCELLED'],
  /** Período pagado que todavía no empieza; el barrido lo activa. */
  SCHEDULED: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['EXPIRED', 'SUSPENDED', 'CANCELLED'],
  SUSPENDED: ['ACTIVE', 'EXPIRED', 'CANCELLED'],
  EXPIRED: [],
  CANCELLED: [],
}

export const MEMBRESIA_VIVA: readonly SupplyV2CustomerMembershipStatus[] = ['PENDING_PAYMENT', 'SCHEDULED', 'ACTIVE', 'SUSPENDED']

export function sumarDias(desde: Date, dias: number): Date {
  const d = new Date(desde.getTime())
  d.setUTCDate(d.getUTCDate() + dias)
  return d
}

export interface VentanaMembresia {
  activatedAt: Date
  expiresAt: Date
}

/**
 * Cuándo corre un período. Si la persona ya tiene uno vivo, el nuevo EMPIEZA
 * CUANDO ACABA el anterior: así se compra por adelantado sin solapar y sin
 * regalar días (§13).
 */
export function ventanaDeMembresia(durationDays: number, ahora: Date, vencimientoAnterior: Date | null): VentanaMembresia {
  const inicio = vencimientoAnterior && vencimientoAnterior > ahora ? vencimientoAnterior : ahora
  return { activatedAt: inicio, expiresAt: sumarDias(inicio, durationDays) }
}

/** Un período que todavía no ha empezado nace SCHEDULED, no ACTIVE. */
export function estadoAlActivar(v: VentanaMembresia, ahora = new Date()): 'ACTIVE' | 'SCHEDULED' {
  return v.activatedAt > ahora ? 'SCHEDULED' : 'ACTIVE'
}

export function membresiaVigente(
  m: { status: SupplyV2CustomerMembershipStatus; activatedAt: Date | null; expiresAt: Date | null },
  ahora = new Date()
): boolean {
  if (m.status !== 'ACTIVE') return false
  if (m.activatedAt && m.activatedAt > ahora) return false
  if (m.expiresAt && m.expiresAt <= ahora) return false
  return true
}

export type MotivoNoContratable =
  | 'PROGRAMA_INACTIVO'
  | 'PLAN_NO_DISPONIBLE'
  | 'PLAN_SIN_PUBLICAR'
  | 'YA_TIENE_UNA_SIN_PAGAR'
  | 'DEMASIADOS_PERIODOS_POR_ADELANTADO'
  | 'PLAN_LLENO'
  | 'SOLO_OTORGADA'

export const MENSAJES_NO_CONTRATABLE: Record<MotivoNoContratable, string> = {
  PROGRAMA_INACTIVO: 'Este programa no está activo ahora mismo.',
  PLAN_NO_DISPONIBLE: 'Este plan no está disponible.',
  PLAN_SIN_PUBLICAR: 'Este plan todavía no está publicado.',
  YA_TIENE_UNA_SIN_PAGAR: 'Ya tienes una compra de este plan pendiente de pago. Termínala o cancélala antes de empezar otra.',
  DEMASIADOS_PERIODOS_POR_ADELANTADO: 'Ya tienes comprados todos los períodos que se pueden adelantar de este plan.',
  PLAN_LLENO: 'Este plan ya alcanzó su número máximo de miembros.',
  SOLO_OTORGADA: 'Esta membresía no se compra: la concede el negocio.',
}

export interface PlanParaContratar {
  status: SupplyV2MembershipPlanStatus
  kind: SupplyV2MembershipPlanKind
  maxMembers: number | null
  maxAdvanceRenewals: number
}

export interface SituacionDelCliente {
  /** Membresías del cliente EN ESTE PLAN que siguen vivas. */
  sinPagar: number
  programadas: number
  activas: number
  /** Miembros vivos del plan, para el tope global. */
  miembrosDelPlan: number
}

/**
 * Elegibilidad para contratar, en orden: programa → plan → cliente → tope.
 * El mismo idioma del Slice 6: un código de motivo con su mensaje.
 */
export function motivoNoContratable(
  programa: { status: SupplyV2LoyaltyProgramStatus; startsAt: Date; endsAt: Date | null },
  plan: PlanParaContratar,
  s: SituacionDelCliente,
  ahora = new Date()
): MotivoNoContratable | null {
  if (motivoProgramaInactivo(programa, ahora)) return 'PROGRAMA_INACTIVO'
  if (plan.status === 'ARCHIVED') return 'PLAN_NO_DISPONIBLE'
  if (plan.status === 'DRAFT') return 'PLAN_SIN_PUBLICAR'
  if (plan.status === 'PAUSED') return 'PLAN_NO_DISPONIBLE'
  if (plan.kind === 'GRANTED') return 'SOLO_OTORGADA'
  if (s.sinPagar > 0) return 'YA_TIENE_UNA_SIN_PAGAR'
  // Solo los períodos ya PAGADOS que todavía no empiezan cuentan como
  // adelantados: comprar cuando no hay ninguno corriendo no adelanta nada,
  // porque ese período arranca hoy.
  if (s.programadas >= plan.maxAdvanceRenewals) return 'DEMASIADOS_PERIODOS_POR_ADELANTADO'
  if (plan.maxMembers != null && s.miembrosDelPlan >= plan.maxMembers && s.activas === 0) return 'PLAN_LLENO'
  return null
}

// ════════════════════════════════════════════════════════════════════════════
// 4 · REFERIDOS (§18–§23)
// ════════════════════════════════════════════════════════════════════════════

export const TRANSICIONES_REFERIDO: Transiciones<SupplyV2ReferralStatus> = {
  LINK_OPENED: ['SIGNED_UP', 'REWARD_VOIDED'],
  SIGNED_UP: ['VERIFIED', 'REWARD_VOIDED'],
  VERIFIED: ['PURCHASE_ELIGIBLE', 'REWARD_VOIDED'],
  PURCHASE_ELIGIBLE: ['REWARD_PENDING', 'REWARD_VOIDED'],
  REWARD_PENDING: ['REWARD_APPROVED', 'REWARD_VOIDED'],
  REWARD_APPROVED: ['REWARD_GRANTED', 'REWARD_VOIDED'],
  /** Conceder es el final feliz: una recompensa concedida no se re-concede. */
  REWARD_GRANTED: [],
  REWARD_VOIDED: [],
}

/**
 * Hasta `PURCHASE_ELIGIBLE` todo es informativo. De `REWARD_PENDING` en
 * adelante hay un derecho económico, y por eso esos pasos piden permiso y
 * dejan rastro (§20).
 */
export const REFERIDO_CON_DERECHO: readonly SupplyV2ReferralStatus[] = ['REWARD_PENDING', 'REWARD_APPROVED', 'REWARD_GRANTED']

export const REFERIDO_INFORMATIVO: readonly SupplyV2ReferralStatus[] = ['LINK_OPENED', 'SIGNED_UP', 'VERIFIED', 'PURCHASE_ELIGIBLE']

export type MotivoReferidoNoElegible =
  | 'PROGRAMA_INACTIVO'
  | 'REFERIDOS_DESACTIVADOS'
  | 'AUTORREFERIDO'
  | 'CODIGO_INACTIVO'
  | 'YA_FUE_REFERIDO'
  | 'NO_ES_PRIMERA_COMPRA'
  | 'COMPRA_MINIMA'
  | 'PAGO_SIN_CONFIRMAR'
  | 'COMPRA_CANCELADA'
  | 'PERIODO_DE_ESPERA'
  | 'LIMITE_POR_PARTICIPANTE'
  | 'LIMITE_GLOBAL'
  | 'PRESUPUESTO_AGOTADO'
  | 'YA_RECOMPENSADO'

export const MENSAJES_REFERIDO: Record<MotivoReferidoNoElegible, string> = {
  PROGRAMA_INACTIVO: 'Este programa no está activo ahora mismo.',
  REFERIDOS_DESACTIVADOS: 'Este programa no tiene activo el programa de referidos.',
  AUTORREFERIDO: 'No puedes recomendarte a ti mismo.',
  CODIGO_INACTIVO: 'Ese código de invitación ya no está activo.',
  YA_FUE_REFERIDO: 'Esta persona ya entró por otra invitación.',
  NO_ES_PRIMERA_COMPRA: 'La recompensa es por la primera compra, y esta persona ya había comprado.',
  COMPRA_MINIMA: 'La compra no llega al mínimo que pide el programa.',
  PAGO_SIN_CONFIRMAR: 'La recompensa espera a que el pago esté confirmado.',
  COMPRA_CANCELADA: 'Esa compra se canceló o se devolvió, así que no genera recompensa.',
  PERIODO_DE_ESPERA: 'Todavía corre el período de espera del programa.',
  LIMITE_POR_PARTICIPANTE: 'Ya alcanzaste el máximo de invitaciones premiadas.',
  LIMITE_GLOBAL: 'El programa ya repartió todas sus recompensas.',
  PRESUPUESTO_AGOTADO: 'El programa de referidos se quedó sin presupuesto.',
  YA_RECOMPENSADO: 'Esta invitación ya fue recompensada.',
}

export interface ReglasDeReferido {
  active: boolean
  requiresFirstPurchase: boolean
  minPurchaseAmount: Decimal | null
  requiresPaymentConfirmed: boolean
  waitingPeriodDays: number
  maxPerReferrer: number | null
  maxTotal: number | null
  budgetTotal: Decimal | null
}

export interface CompraDelReferido {
  /** Importe que cuenta para el mínimo: lo que el cliente pagó de verdad. */
  importe: Decimal
  pagoConfirmado: boolean
  cancelada: boolean
  /** Compras elegibles ANTERIORES a esta del mismo cliente. */
  comprasPrevias: number
  confirmadaEn: Date | null
}

export interface UsoDelProgramaDeReferidos {
  recompensasDelReferidor: number
  recompensasTotales: number
  /** Lo ya comprometido del presupuesto del programa de referidos. */
  presupuestoUsado: Decimal
  /** Lo que costaría esta recompensa. */
  costeDeEsta: Decimal
}

/**
 * ¿Da derecho esta compra a la recompensa del referido? Se calcula ENTERO EN
 * EL SERVIDOR (§21) y en orden, para que el motivo que se le enseña a la
 * persona sea el primero que de verdad la bloquea.
 *
 * El autorreferido se comprueba aquí Y lo impide un CHECK de la base: saber
 * el código de otro no sirve para cobrarse a uno mismo (§22).
 */
export function motivoReferidoNoElegible(
  programa: { status: SupplyV2LoyaltyProgramStatus; startsAt: Date; endsAt: Date | null },
  reglas: ReglasDeReferido,
  referido: { referrerId: string; referredId: string | null; status: SupplyV2ReferralStatus; codigoActivo: boolean },
  compra: CompraDelReferido,
  uso: UsoDelProgramaDeReferidos,
  ahora = new Date()
): MotivoReferidoNoElegible | null {
  if (motivoProgramaInactivo(programa, ahora)) return 'PROGRAMA_INACTIVO'
  if (!reglas.active) return 'REFERIDOS_DESACTIVADOS'
  if (referido.referredId && referido.referredId === referido.referrerId) return 'AUTORREFERIDO'
  if (!referido.codigoActivo) return 'CODIGO_INACTIVO'
  if (referido.status === 'REWARD_GRANTED') return 'YA_RECOMPENSADO'

  if (compra.cancelada) return 'COMPRA_CANCELADA'
  if (reglas.requiresPaymentConfirmed && !compra.pagoConfirmado) return 'PAGO_SIN_CONFIRMAR'
  if (reglas.requiresFirstPurchase && compra.comprasPrevias > 0) return 'NO_ES_PRIMERA_COMPRA'
  if (reglas.minPurchaseAmount && compra.importe.lessThan(reglas.minPurchaseAmount)) return 'COMPRA_MINIMA'
  if (reglas.waitingPeriodDays > 0) {
    if (!compra.confirmadaEn) return 'PAGO_SIN_CONFIRMAR'
    if (sumarDias(compra.confirmadaEn, reglas.waitingPeriodDays) > ahora) return 'PERIODO_DE_ESPERA'
  }

  if (reglas.maxPerReferrer != null && uso.recompensasDelReferidor >= reglas.maxPerReferrer) return 'LIMITE_POR_PARTICIPANTE'
  if (reglas.maxTotal != null && uso.recompensasTotales >= reglas.maxTotal) return 'LIMITE_GLOBAL'
  if (reglas.budgetTotal && uso.presupuestoUsado.plus(uso.costeDeEsta).greaterThan(reglas.budgetTotal)) return 'PRESUPUESTO_AGOTADO'
  return null
}

/** Mismo criterio que el cupón del Slice 7: quien prueba códigos no aprende nada. */
export const MENSAJE_REFERIDO_OPACO = 'Ese código de invitación no existe o no se puede usar.'

export const TIPOS_RECOMPENSA_REFERIDO: readonly SupplyV2ReferralRewardKind[] = ['BONUS', 'COUPON', 'POINTS', 'SUPPLIER_BENEFIT']

// ════════════════════════════════════════════════════════════════════════════
// 5 · PUNTOS (§24–§29)
// ════════════════════════════════════════════════════════════════════════════

export interface ReglaDeAcumulacion {
  pointsPerUnit: number
  amountPerPoint: Decimal
  basis: SupplyV2PointsAccrualBasis
}

export interface ImportesDeLaCompra {
  /** Valor contractual de la venta. */
  contractualValue: Decimal
  /** Lo que el cliente pagó de verdad (puede ser menos: hubo bono). */
  customerPaid: Decimal
}

/**
 * Puntos que gana una compra (§27).
 *
 * `basis` decide sobre qué se calcula, y se CONGELA en el movimiento: cambiar
 * la regla mañana no reescribe lo que alguien ya ganó. El multiplicador de
 * membresía se aplica al final y SIEMPRE redondea hacia abajo: no se regalan
 * puntos por redondeo.
 */
export function puntosPorCompra(regla: ReglaDeAcumulacion, importes: ImportesDeLaCompra, multiplicador: Decimal | number | string = 1): number {
  const base = regla.basis === 'CUSTOMER_PAID' ? importes.customerPaid : importes.contractualValue
  if (base.lessThanOrEqualTo(0)) return 0
  const m = decimal(multiplicador)
  if (!m.isFinite() || m.lessThanOrEqualTo(0)) return 0
  const unidades = base.dividedBy(regla.amountPerPoint).floor()
  return Number(unidades.times(regla.pointsPerUnit).times(m).floor())
}

/** El multiplicador que aplica de verdad: el mayor de los planes vivos, o 1. */
export function multiplicadorDeMembresias(multiplicadores: readonly (Decimal | number | string | null)[]): Decimal {
  let mayor = new Prisma.Decimal(1)
  for (const v of multiplicadores) {
    if (v == null) continue
    const d = decimal(v)
    if (d.isFinite() && d.greaterThan(mayor)) mayor = d
  }
  return mayor
}

export interface MovimientoDePuntos {
  availableDelta: number
  pendingDelta: number
  reservedDelta: number
  redeemedDelta: number
  expiredDelta: number
}

export interface SaldoDePuntos {
  available: number
  pending: number
  reserved: number
  redeemed: number
  expired: number
}

/**
 * Reconstruye la cuenta DESDE LOS MOVIMIENTOS (§25). La caché de
 * `SupplyV2PointsAccount` tiene que dar exactamente esto; si no, alguien
 * escribió un saldo sin su movimiento y eso es un error, no un desajuste
 * aceptable.
 */
export function saldoDeMovimientosPuntos(movs: readonly MovimientoDePuntos[]): SaldoDePuntos {
  return movs.reduce<SaldoDePuntos>(
    (t, m) => ({
      available: t.available + m.availableDelta,
      pending: t.pending + m.pendingDelta,
      reserved: t.reserved + m.reservedDelta,
      redeemed: t.redeemed + m.redeemedDelta,
      expired: t.expired + m.expiredDelta,
    }),
    { available: 0, pending: 0, reserved: 0, redeemed: 0, expired: 0 }
  )
}

export interface LoteDePuntos {
  id: string
  /** Puntos que entraron con este lote. */
  points: number
  /** Lo que ya se consumió o venció de él. */
  consumedFromLot: number
  /** Null = no vencen. */
  expiresAt: Date | null
}

export interface ConsumoDeLote {
  loteId: string
  puntos: number
}

export function disponibleDelLote(l: LoteDePuntos): number {
  return Math.max(0, l.points - l.consumedFromLot)
}

/**
 * Ordena los lotes para consumir PRIMERO LO QUE VENCE ANTES (§29). Los que no
 * vencen van al final: gastarlos antes dejaría caducar los que sí vencen, que
 * es justo lo contrario de lo que le conviene a la persona.
 */
export function ordenarPorVencimiento(lotes: readonly LoteDePuntos[]): LoteDePuntos[] {
  return [...lotes].sort((a, b) => {
    if (a.expiresAt && b.expiresAt) return a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id)
    if (a.expiresAt) return -1
    if (b.expiresAt) return 1
    return a.id.localeCompare(b.id)
  })
}

/**
 * Reparte un consumo entre los lotes, el que antes vence primero. Devuelve
 * `null` si no alcanza: así quien llama no puede gastar de más por descuido.
 */
export function consumirPorVencimiento(lotes: readonly LoteDePuntos[], cantidad: number): ConsumoDeLote[] | null {
  if (!Number.isInteger(cantidad) || cantidad <= 0) return null
  let faltan = cantidad
  const plan: ConsumoDeLote[] = []
  for (const l of ordenarPorVencimiento(lotes)) {
    if (faltan === 0) break
    const hay = disponibleDelLote(l)
    if (hay <= 0) continue
    const toma = Math.min(hay, faltan)
    plan.push({ loteId: l.id, puntos: toma })
    faltan -= toma
  }
  return faltan === 0 ? plan : null
}

/** Lotes vencidos que todavía tienen puntos sin consumir. */
export function lotesVencidos(lotes: readonly LoteDePuntos[], ahora = new Date()): LoteDePuntos[] {
  return lotes.filter((l) => l.expiresAt !== null && l.expiresAt <= ahora && disponibleDelLote(l) > 0)
}

export function vencimientoDeLote(ahora: Date, pointsExpireDays: number | null): Date | null {
  return pointsExpireDays == null ? null : sumarDias(ahora, pointsExpireDays)
}

export const TIPOS_MOVIMIENTO_PUNTOS: readonly SupplyV2PointsMovementType[] = [
  'EARNED',
  'PENDING',
  'AVAILABLE',
  'RESERVED',
  'REDEEMED',
  'RELEASED',
  'EXPIRED',
  'REVERSED',
  'ADMIN_ADJUSTMENT',
]

/** Un ajuste manual EXIGE motivo (§43). Lo repite un CHECK de la base. */
export function validarAjusteDePuntos(d: { puntos: number; motivo?: string | null; actorId?: string | null }): string | null {
  if (!Number.isInteger(d.puntos) || d.puntos === 0) return 'El ajuste tiene que ser un número entero distinto de cero.'
  if (!d.motivo?.trim()) return 'Un ajuste de puntos necesita un motivo escrito.'
  if (d.motivo.trim().length < 5) return 'El motivo del ajuste es demasiado corto para explicar nada.'
  if (!d.actorId) return 'Un ajuste de puntos necesita quién lo hace.'
  return null
}

// ════════════════════════════════════════════════════════════════════════════
// 6 · RECOMPENSAS (§30–§34)
// ════════════════════════════════════════════════════════════════════════════

export const TIPOS_DE_RECOMPENSA: readonly SupplyV2RewardKind[] = ['COUPON', 'BENEFIT', 'FREE_PRODUCT', 'SERVICE', 'PARTIAL_BONUS']

export const TRANSICIONES_RECOMPENSA: Transiciones<SupplyV2RewardStatus> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['PAUSED', 'EXHAUSTED', 'EXPIRED', 'CANCELLED'],
  PAUSED: ['ACTIVE', 'EXPIRED', 'CANCELLED'],
  EXHAUSTED: ['ACTIVE', 'EXPIRED', 'CANCELLED'],
  EXPIRED: [],
  CANCELLED: [],
}

export const TRANSICIONES_RECLAMACION: Transiciones<SupplyV2RewardClaimStatus> = {
  /** Puntos reservados; el beneficio todavía no existe. */
  RESERVED: ['CLAIMED', 'CANCELLED'],
  CLAIMED: ['DELIVERED', 'EXPIRED', 'CANCELLED', 'REVERSED'],
  /** Entregada: a partir de aquí solo cabe una reversa explícita. */
  DELIVERED: ['REVERSED'],
  EXPIRED: [],
  CANCELLED: [],
  REVERSED: [],
}

export interface DatosRecompensa {
  name: string
  kind: SupplyV2RewardKind
  pointsCost?: number | null
  benefitId?: string | null
  offerId?: string | null
  unitCost?: number | string | null
  budgetTotal?: number | string | null
  maxClaims?: number | null
  maxPerCustomer?: number | null
  requiresMembership?: boolean | null
  requiredPlanId?: string | null
  startsAt: Date
  endsAt?: Date | null
}

export function validarRecompensa(d: DatosRecompensa): string | null {
  if (!d.name?.trim()) return 'La recompensa necesita un nombre.'
  if (d.name.trim().length > 120) return 'El nombre es demasiado largo.'
  if (!TIPOS_DE_RECOMPENSA.includes(d.kind)) return 'Indica qué tipo de recompensa es.'
  const costo = d.pointsCost ?? 0
  if (!Number.isInteger(costo) || costo < 0) return 'El costo en puntos tiene que ser un entero que no sea negativo.'
  if ((d.kind === 'FREE_PRODUCT' || d.kind === 'SERVICE') && !d.offerId) {
    return 'Una recompensa que entrega un producto o un servicio necesita la oferta con la que se entrega.'
  }
  // TODA recompensa necesita su beneficio: es lo que la paga y lo que el
  // cliente usa en el checkout de siempre. Una que regala un producto apunta
  // además a la oferta con la que se entrega. Sin beneficio, reclamarla no
  // daría nada y el cliente habría gastado sus puntos a cambio de aire.
  if (!d.benefitId) {
    return 'Esta recompensa necesita el beneficio que se le concede al cliente.'
  }
  if (d.unitCost != null && d.unitCost !== '') {
    const c = decimal(d.unitCost)
    if (!c.isFinite() || c.isNegative()) return 'El costo por entrega no puede ser negativo.'
  }
  if (d.budgetTotal != null && d.budgetTotal !== '') {
    const b = decimal(d.budgetTotal)
    if (!b.isFinite() || b.lessThanOrEqualTo(0)) return 'El presupuesto tiene que ser mayor que cero (o dejarse vacío: sin tope).'
  }
  if (d.maxClaims != null && (!Number.isInteger(d.maxClaims) || d.maxClaims <= 0)) return 'El tope de reclamaciones tiene que ser un entero positivo.'
  const porCliente = d.maxPerCustomer ?? 1
  if (!Number.isInteger(porCliente) || porCliente <= 0) return 'El tope por cliente tiene que ser un entero positivo.'
  if (d.requiredPlanId && !d.requiresMembership) return 'Si la recompensa es de un plan concreto, tiene que ser solo para miembros.'
  if (!(d.startsAt instanceof Date) || Number.isNaN(d.startsAt.getTime())) return 'La fecha de inicio no es válida.'
  if (d.endsAt) {
    if (Number.isNaN(d.endsAt.getTime())) return 'La fecha de fin no es válida.'
    if (d.endsAt <= d.startsAt) return 'El fin tiene que ser posterior al inicio.'
  }
  return null
}

export type MotivoNoReclamable =
  | 'PROGRAMA_INACTIVO'
  | 'RECOMPENSA_INACTIVA'
  | 'RECOMPENSA_NO_VIGENTE'
  | 'RECOMPENSA_VENCIDA'
  | 'RECOMPENSA_AGOTADA'
  | 'SOLO_MIEMBROS'
  | 'PLAN_REQUERIDO'
  | 'LIMITE_POR_CLIENTE'
  | 'YA_TIENE_UNA_EN_CURSO'
  | 'PUNTOS_INSUFICIENTES'
  | 'PRESUPUESTO_AGOTADO'

export const MENSAJES_NO_RECLAMABLE: Record<MotivoNoReclamable, string> = {
  PROGRAMA_INACTIVO: 'Este programa no está activo ahora mismo.',
  RECOMPENSA_INACTIVA: 'Esta recompensa no está disponible.',
  RECOMPENSA_NO_VIGENTE: 'Esta recompensa todavía no empieza.',
  RECOMPENSA_VENCIDA: 'Esta recompensa ya venció.',
  RECOMPENSA_AGOTADA: 'Esta recompensa ya se agotó.',
  SOLO_MIEMBROS: 'Esta recompensa es solo para miembros.',
  PLAN_REQUERIDO: 'Esta recompensa es de otro plan de membresía.',
  LIMITE_POR_CLIENTE: 'Ya alcanzaste el máximo de veces que puedes pedir esta recompensa.',
  YA_TIENE_UNA_EN_CURSO: 'Ya tienes una reclamación de esta recompensa en curso.',
  PUNTOS_INSUFICIENTES: 'No te alcanzan los puntos para esta recompensa.',
  PRESUPUESTO_AGOTADO: 'Esta recompensa se quedó sin presupuesto.',
}

export interface RecompensaParaReclamar {
  status: SupplyV2RewardStatus
  pointsCost: number
  startsAt: Date
  endsAt: Date | null
  maxClaims: number | null
  timesClaimed: number
  maxPerCustomer: number
  requiresMembership: boolean
  requiredPlanId: string | null
  budgetTotal: Decimal | null
  unitCost: Decimal | null
}

export interface ClienteParaReclamar {
  puntosDisponibles: number
  /** Reclamaciones del cliente que cuentan para el tope (vivas o entregadas). */
  reclamacionesPropias: number
  /** Reclamaciones RESERVED en curso de esta misma recompensa. */
  enCurso: number
  /** Planes de membresía vivos del cliente en este programa. */
  planesVivos: readonly string[]
  /** Costo ya comprometido del presupuesto de la recompensa. */
  presupuestoUsado: Decimal
}

/**
 * Elegibilidad para reclamar, en orden: programa → recompensa → membresía →
 * límites → puntos → presupuesto. Los puntos se comprueban DESPUÉS de los
 * límites, para que a quien no puede pedirla no se le diga que le faltan
 * puntos.
 */
export function motivoNoReclamable(
  programa: { status: SupplyV2LoyaltyProgramStatus; startsAt: Date; endsAt: Date | null },
  r: RecompensaParaReclamar,
  c: ClienteParaReclamar,
  ahora = new Date()
): MotivoNoReclamable | null {
  if (motivoProgramaInactivo(programa, ahora)) return 'PROGRAMA_INACTIVO'
  if (r.status === 'EXPIRED') return 'RECOMPENSA_VENCIDA'
  if (r.status === 'EXHAUSTED') return 'RECOMPENSA_AGOTADA'
  if (r.status !== 'ACTIVE') return 'RECOMPENSA_INACTIVA'
  if (r.startsAt > ahora) return 'RECOMPENSA_NO_VIGENTE'
  if (r.endsAt && r.endsAt <= ahora) return 'RECOMPENSA_VENCIDA'
  if (r.maxClaims != null && r.timesClaimed >= r.maxClaims) return 'RECOMPENSA_AGOTADA'

  if (r.requiresMembership && c.planesVivos.length === 0) return 'SOLO_MIEMBROS'
  if (r.requiredPlanId && !c.planesVivos.includes(r.requiredPlanId)) return 'PLAN_REQUERIDO'

  if (c.enCurso > 0) return 'YA_TIENE_UNA_EN_CURSO'
  if (c.reclamacionesPropias >= r.maxPerCustomer) return 'LIMITE_POR_CLIENTE'

  if (r.pointsCost > 0 && c.puntosDisponibles < r.pointsCost) return 'PUNTOS_INSUFICIENTES'

  if (r.budgetTotal && r.unitCost && c.presupuestoUsado.plus(r.unitCost).greaterThan(r.budgetTotal)) return 'PRESUPUESTO_AGOTADO'
  return null
}

/**
 * ¿Devuelve puntos una reversa? (§34)
 *
 * Una recompensa YA USADA no se anula devolviendo los puntos: el beneficio ya
 * se consumió y devolverlos sería regalarlo dos veces. Solo vuelven los
 * puntos de lo que todavía no se usó.
 */
export function reversaDevuelvePuntos(status: SupplyV2RewardClaimStatus): boolean {
  return status === 'RESERVED' || status === 'CLAIMED'
}

export function estadoRecompensaSegunUsos(
  r: Pick<RecompensaParaReclamar, 'status' | 'maxClaims' | 'timesClaimed' | 'endsAt'>,
  ahora = new Date()
): SupplyV2RewardStatus {
  if (r.status === 'CANCELLED') return 'CANCELLED'
  if (r.endsAt && r.endsAt <= ahora) return 'EXPIRED'
  if (r.maxClaims != null && r.timesClaimed >= r.maxClaims) return 'EXHAUSTED'
  return r.status === 'EXHAUSTED' ? 'ACTIVE' : r.status
}

// ════════════════════════════════════════════════════════════════════════════
// 7 · ECONOMÍA DEL PROGRAMA (§35–§38)
// ════════════════════════════════════════════════════════════════════════════

export interface CostoDeRecompensa {
  budgetTotal: Decimal | null
  unitCost: Decimal | null
  /** Reclamaciones vivas (reservadas o reclamadas, sin entregar). */
  pendientes: number
  /** Entregadas: estas SÍ son costo realizado. */
  entregadas: number
  /** Costo realmente reconocido en las entregas. */
  costoEntregado: Decimal
}

export interface EconomiaDelPrograma {
  /** Techo aprobado del programa; null = sin tope autorizado. */
  aprobado: Decimal | null
  /** Suma de los topes de sus recompensas. */
  comprometido: Decimal
  /** Costo de lo YA ENTREGADO. Esto es dinero gastado. */
  costoRealizado: Decimal
  /** Costo de lo reclamado y todavía no entregado. */
  costoPendiente: Decimal
  disponible: Decimal | null
  algunaRecompensaSinTope: boolean
}

/**
 * La economía del programa se LEE de sus recompensas y de lo entregado: no
 * hay un segundo contador que pueda desincronizarse (mismo criterio que el
 * presupuesto de campaña del Slice 7).
 *
 * `costoRealizado` es dinero gastado; `costoPendiente` todavía depende de que
 * la entrega ocurra. No se suman en una sola cifra a propósito.
 */
export function economiaDelPrograma(
  aprobado: Decimal | string | number | null,
  recompensas: readonly CostoDeRecompensa[]
): EconomiaDelPrograma {
  const techo = aprobado != null && aprobado !== '' ? decimal(aprobado) : null
  let comprometido = CERO
  let realizado = CERO
  let pendiente = CERO
  let sinTope = false
  for (const r of recompensas) {
    if (r.budgetTotal == null) sinTope = true
    else comprometido = comprometido.plus(r.budgetTotal)
    realizado = realizado.plus(r.costoEntregado)
    if (r.unitCost) pendiente = pendiente.plus(r.unitCost.times(r.pendientes))
  }
  return {
    aprobado: techo,
    comprometido,
    costoRealizado: redondear2(realizado),
    costoPendiente: redondear2(pendiente),
    disponible: techo ? redondear2(techo.minus(realizado).minus(pendiente)) : null,
    algunaRecompensaSinTope: sinTope,
  }
}

/** ¿Cabe una recompensa nueva (o ampliada) dentro del techo del programa? */
export function cabeEnElPrograma(e: EconomiaDelPrograma, nuevoTecho: Decimal | string | number | null): string | null {
  if (e.aprobado == null) return null
  if (nuevoTecho == null || nuevoTecho === '') {
    return 'El programa tiene un presupuesto máximo, así que sus recompensas no pueden ir sin tope.'
  }
  const suma = e.comprometido.plus(decimal(nuevoTecho))
  if (suma.greaterThan(e.aprobado)) {
    return `Las recompensas del programa sumarían ${suma.toFixed(2)} y el presupuesto aprobado es ${e.aprobado.toFixed(2)}.`
  }
  return null
}

export interface CompromisoDePuntos {
  puntosEmitidos: number
  puntosDisponibles: number
  puntosUsados: number
  puntosVencidos: number
  /** Costo EFECTIVO: lo que ya se entregó. Esto sí es dinero. */
  costoEfectivo: Decimal
  /**
   * ESTIMACIÓN del costo de los puntos que todavía están vivos, si se
   * canjearan todos. NO es dinero adeudado: depende de que la persona canjee,
   * de qué canjee y de que no se le venzan antes (§37).
   */
  costoPotencialEstimado: Decimal
  /** Lo dice el propio tipo para que nadie lo presente como deuda. */
  readonly esEstimacion: true
}

/**
 * Separa lo que ya costó de lo que PODRÍA costar (§37).
 *
 * `valorPorPunto` es el costo medio observado por punto canjeado, no una
 * promesa de conversión: los puntos no se convierten en dinero (§24).
 */
export function compromisoDePuntos(
  totales: { emitidos: number; disponibles: number; usados: number; vencidos: number },
  costoEfectivo: Decimal | string | number,
  valorPorPunto: Decimal | string | number
): CompromisoDePuntos {
  const efectivo = decimal(costoEfectivo)
  const porPunto = decimal(valorPorPunto)
  const estimado = porPunto.isFinite() && porPunto.greaterThan(0) ? porPunto.times(Math.max(0, totales.disponibles)) : CERO
  return {
    puntosEmitidos: totales.emitidos,
    puntosDisponibles: totales.disponibles,
    puntosUsados: totales.usados,
    puntosVencidos: totales.vencidos,
    costoEfectivo: redondear2(efectivo),
    costoPotencialEstimado: redondear2(estimado),
    esEstimacion: true,
  }
}
