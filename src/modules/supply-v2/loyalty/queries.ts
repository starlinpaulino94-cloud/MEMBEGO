import 'server-only'

import { Prisma } from '@prisma/client'
import type { SupplyV2BenefitFunding, SupplyV2CustomerMembershipStatus, SupplyV2LoyaltyModality, SupplyV2LoyaltyProgramStatus } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { dineroSupplyV2 } from '../core/catalogo'
import { compromisoDePuntos, membresiaVigente } from './domain'
import { economiaDelProgramaEnTx } from './rewards'
import { estadisticasDeReferidosEnTx } from './referrals'
import { valorMedioPorPuntoEnTx } from './points'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · LECTURAS (§39–§41).
 *
 * CUATRO PÚBLICOS, CUATRO DTO. Lo que ve el cliente NO lleva presupuesto, ni
 * costo, ni comisión: no es que se oculte en la plantilla, es que no sale de
 * aquí. Una prueba recorre las claves del DTO del cliente y falla si aparece
 * alguna de esas palabras.
 *
 * El dinero cruza como texto ya formateado (`dineroSupplyV2`), no como
 * `Decimal`: lo que llega a la pantalla no se vuelve a calcular.
 */


// ── Cliente ────────────────────────────────────────────────────────────────

export interface MembresiaDelCliente {
  id: string
  code: string
  plan: string
  negocio: string
  estado: SupplyV2CustomerMembershipStatus
  vigente: boolean
  desde: string | null
  hasta: string | null
  diasRestantes: number | null
  precioPagado: string
  renovaciones: number
  beneficios: { nombre: string; usosDisponibles: number; vence: string | null }[]
}

export interface PuntosDelCliente {
  programaId: string
  programa: string
  negocio: string | null
  disponibles: number
  pendientes: number
  reservados: number
  usados: number
  vencidos: number
  /** Lo que vence antes, para avisar con tiempo. */
  proximoVencimiento: { puntos: number; fecha: string } | null
  historial: { fecha: string; tipo: string; puntos: number; concepto: string }[]
}

export interface RecompensaParaElCliente {
  id: string
  code: string
  nombre: string
  descripcion: string | null
  puntosNecesarios: number
  alcanza: boolean
  /** Por qué no se puede pedir, en castellano. Null = se puede. */
  porQueNo: string | null
  vigencia: string | null
}

const fecha = (d: Date | null) => (d ? d.toISOString() : null)

function diasRestantes(hasta: Date | null, ahora: Date): number | null {
  if (!hasta) return null
  return Math.max(0, Math.ceil((hasta.getTime() - ahora.getTime()) / 86_400_000))
}

/** «Mis membresías» (§17). */
export async function misMembresias(customerId: string, ahora = new Date()): Promise<MembresiaDelCliente[]> {
  return sinEmpresa('Supply 2.0: las membresías de un cliente', async (tx) => {
    const filas = await tx.supplyV2CustomerMembership.findMany({
      where: { customerId },
      orderBy: [{ status: 'asc' }, { expiresAt: 'desc' }],
      take: 50,
      select: {
        id: true,
        code: true,
        status: true,
        activatedAt: true,
        expiresAt: true,
        pricePaid: true,
        renewalCount: true,
        plan: { select: { name: true } },
        program: { select: { name: true, supplier: { select: { commercialName: true } } } },
        customerBenefits: {
          where: { status: 'AVAILABLE' },
          select: { usesAllowed: true, usesConsumed: true, expiresAt: true, benefit: { select: { name: true } } },
        },
      },
    })
    return filas.map((m) => ({
      id: m.id,
      code: m.code,
      plan: m.plan.name,
      negocio: m.program.supplier?.commercialName ?? m.program.name,
      estado: m.status,
      vigente: membresiaVigente(m, ahora),
      desde: fecha(m.activatedAt),
      hasta: fecha(m.expiresAt),
      diasRestantes: diasRestantes(m.expiresAt, ahora),
      precioPagado: dineroSupplyV2(m.pricePaid),
      renovaciones: m.renewalCount,
      beneficios: m.customerBenefits.map((b) => ({
        nombre: b.benefit.name,
        usosDisponibles: Math.max(0, b.usesAllowed - b.usesConsumed),
        vence: fecha(b.expiresAt),
      })),
    }))
  })
}

/** «Mis puntos» (§25, §39). */
export async function misPuntos(customerId: string): Promise<PuntosDelCliente[]> {
  return sinEmpresa('Supply 2.0: los puntos de un cliente', async (tx) => {
    const cuentas = await tx.supplyV2PointsAccount.findMany({
      where: { customerId },
      select: {
        id: true,
        available: true,
        pending: true,
        reserved: true,
        redeemed: true,
        expired: true,
        program: { select: { id: true, name: true, supplier: { select: { commercialName: true } } } },
      },
    })
    const salida: PuntosDelCliente[] = []
    for (const c of cuentas) {
      const lotes = await tx.supplyV2PointsMovement.findMany({
        where: { accountId: c.id, availableDelta: { gt: 0 }, expiresAt: { not: null } },
        select: { availableDelta: true, consumedFromLot: true, expiresAt: true },
        orderBy: { expiresAt: 'asc' },
      })
      const proximo = lotes.find((l) => l.availableDelta - l.consumedFromLot > 0)
      const historial = await tx.supplyV2PointsMovement.findMany({
        where: { accountId: c.id },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { createdAt: true, type: true, points: true, source: true, reason: true },
      })
      salida.push({
        programaId: c.program.id,
        programa: c.program.name,
        negocio: c.program.supplier?.commercialName ?? null,
        disponibles: c.available,
        pendientes: c.pending,
        reservados: c.reserved,
        usados: c.redeemed,
        vencidos: c.expired,
        proximoVencimiento: proximo
          ? { puntos: proximo.availableDelta - proximo.consumedFromLot, fecha: proximo.expiresAt!.toISOString() }
          : null,
        historial: historial.map((h) => ({
          fecha: h.createdAt.toISOString(),
          tipo: h.type,
          puntos: h.points,
          concepto: h.reason ?? conceptoDeOrigen(h.source),
        })),
      })
    }
    return salida
  })
}

function conceptoDeOrigen(source: string): string {
  switch (source) {
    case 'PURCHASE':
      return 'Por una compra'
    case 'REFERRAL':
      return 'Por una invitación'
    case 'MEMBERSHIP':
      return 'Por tu membresía'
    case 'REWARD':
      return 'Por una recompensa'
    case 'PROMOTION':
      return 'Por una promoción'
    default:
      return 'Ajuste'
  }
}

/** «Mis recompensas»: el catálogo que este cliente puede pedir. */
export async function recompensasParaElCliente(customerId: string, programId: string, ahora = new Date()): Promise<RecompensaParaElCliente[]> {
  return sinEmpresa('Supply 2.0: recompensas disponibles para un cliente', async (tx) => {
    const cuenta = await tx.supplyV2PointsAccount.findUnique({ where: { programId_customerId: { programId, customerId } }, select: { available: true } })
    const disponibles = cuenta?.available ?? 0
    const recompensas = await tx.supplyV2Reward.findMany({
      where: { programId, status: 'ACTIVE', startsAt: { lte: ahora }, OR: [{ endsAt: null }, { endsAt: { gt: ahora } }] },
      orderBy: { pointsCost: 'asc' },
      take: 50,
      select: { id: true, code: true, name: true, description: true, pointsCost: true, endsAt: true, maxPerCustomer: true, requiresMembership: true, requiredPlanId: true },
    })
    const vivas = await tx.supplyV2CustomerMembership.findMany({ where: { programId, customerId, status: 'ACTIVE' }, select: { planId: true } })
    const planes = vivas.map((v) => v.planId)

    const salida: RecompensaParaElCliente[] = []
    for (const r of recompensas) {
      const propias = await tx.supplyV2RewardClaim.count({ where: { rewardId: r.id, customerId, status: { in: ['RESERVED', 'CLAIMED', 'DELIVERED'] } } })
      let porQueNo: string | null = null
      if (r.requiresMembership && planes.length === 0) porQueNo = 'Es solo para miembros.'
      else if (r.requiredPlanId && !planes.includes(r.requiredPlanId)) porQueNo = 'Es de otro plan de membresía.'
      else if (propias >= r.maxPerCustomer) porQueNo = 'Ya la pediste.'
      else if (disponibles < r.pointsCost) porQueNo = `Te faltan ${r.pointsCost - disponibles} puntos.`
      salida.push({
        id: r.id,
        code: r.code,
        nombre: r.name,
        descripcion: r.description,
        puntosNecesarios: r.pointsCost,
        alcanza: porQueNo === null,
        porQueNo,
        vigencia: fecha(r.endsAt),
      })
    }
    return salida
  })
}

/** «Invitar amigos» (§19). */
export async function misInvitaciones(customerId: string) {
  return sinEmpresa('Supply 2.0: las invitaciones de un cliente', async (tx) => {
    const programas = await tx.supplyV2LoyaltyProgram.findMany({
      where: { status: 'ACTIVE', modalities: { has: 'REFERRALS' }, referralProgram: { active: true } },
      select: { id: true, name: true, supplier: { select: { commercialName: true } }, referralProgram: { select: { rewardKind: true, rewardPoints: true, minPurchaseAmount: true, waitingPeriodDays: true } } },
      take: 20,
    })
    const salida = []
    for (const p of programas) {
      const stats = await estadisticasDeReferidosEnTx(tx, p.id, customerId)
      salida.push({
        programaId: p.id,
        programa: p.name,
        negocio: p.supplier?.commercialName ?? null,
        premio:
          p.referralProgram?.rewardKind === 'POINTS'
            ? `${p.referralProgram.rewardPoints} puntos`
            : 'Un beneficio del negocio',
        condicion: p.referralProgram?.minPurchaseAmount
          ? `Su primera compra tiene que ser de ${dineroSupplyV2(p.referralProgram.minPurchaseAmount)} o más.`
          : 'Con su primera compra válida.',
        espera: p.referralProgram?.waitingPeriodDays ?? 0,
        codigo: stats?.code ?? null,
        estadisticas: stats,
      })
    }
    return salida
  })
}

/** Membresías publicadas que un cliente puede comprar (§15). */
export async function membresiasEnElMarketplace(ahora = new Date()) {
  return sinEmpresa('Supply 2.0: membresías publicadas', async (tx) => {
    const planes = await tx.supplyV2MembershipPlan.findMany({
      where: { status: 'PUBLISHED', program: { status: 'ACTIVE', startsAt: { lte: ahora }, OR: [{ endsAt: null }, { endsAt: { gt: ahora } }] } },
      orderBy: [{ programId: 'asc' }, { price: 'asc' }],
      take: 60,
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        price: true,
        kind: true,
        durationDays: true,
        maxMembers: true,
        program: { select: { id: true, name: true, supplier: { select: { commercialName: true } } } },
        benefits: { select: { kind: true, pointsMultiplier: true, earlyAccessHours: true, benefit: { select: { name: true } } }, orderBy: { position: 'asc' } },
      },
    })
    return planes.map((p) => ({
      id: p.id,
      code: p.code,
      nombre: p.name,
      descripcion: p.description,
      negocio: p.program.supplier?.commercialName ?? p.program.name,
      programaId: p.program.id,
      precio: dineroSupplyV2(p.price),
      gratuita: p.kind === 'FREE',
      duracionDias: p.durationDays,
      incluye: p.benefits.map((b) =>
        b.kind === 'POINTS_MULTIPLIER'
          ? `Multiplica tus puntos ×${b.pointsMultiplier?.toFixed(2) ?? '1.00'}`
          : b.kind === 'EARLY_ACCESS'
            ? `Acceso anticipado ${b.earlyAccessHours} h antes`
            : (b.benefit?.name ?? 'Beneficio exclusivo')
      ),
      // El cliente NO ve presupuesto, costo ni comisión: no salen de aquí.
    }))
  })
}

// ── Proveedor (§40) ────────────────────────────────────────────────────────

/**
 * Lo que ve un negocio de SUS programas. Nunca los de otro: se filtra por su
 * `supplierId`, no por lo que mande la pantalla.
 */
export async function fidelizacionDelProveedor(supplierId: string) {
  return sinEmpresa('Supply 2.0: fidelización del proveedor', async (tx) => {
    const programas = await tx.supplyV2LoyaltyProgram.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, code: true, name: true, status: true, modalities: true, startsAt: true, endsAt: true },
    })
    const salida = []
    for (const p of programas) {
      const [planes, activas, vencidas, referidos, puntos, reclamadas, entregadas] = await Promise.all([
        tx.supplyV2MembershipPlan.findMany({ where: { programId: p.id }, select: { id: true, name: true, price: true, status: true, durationDays: true } }),
        tx.supplyV2CustomerMembership.count({ where: { programId: p.id, status: 'ACTIVE' } }),
        tx.supplyV2CustomerMembership.count({ where: { programId: p.id, status: 'EXPIRED' } }),
        tx.supplyV2Referral.count({ where: { programId: p.id, status: 'REWARD_GRANTED' } }),
        tx.supplyV2PointsMovement.aggregate({ where: { account: { programId: p.id }, type: { in: ['EARNED', 'AVAILABLE'] } }, _sum: { points: true } }),
        tx.supplyV2RewardClaim.count({ where: { programId: p.id, status: { in: ['CLAIMED', 'DELIVERED'] } } }),
        tx.supplyV2RewardClaim.count({ where: { programId: p.id, status: 'DELIVERED' } }),
      ])
      const economia = await economiaDelProgramaEnTx(tx, p.id)
      salida.push({
        id: p.id,
        code: p.code,
        nombre: p.name,
        estado: p.status,
        modalidades: p.modalities,
        vigencia: { desde: p.startsAt.toISOString(), hasta: fecha(p.endsAt) },
        planes: planes.map((pl) => ({ id: pl.id, nombre: pl.name, precio: dineroSupplyV2(pl.price), estado: pl.status, dias: pl.durationDays })),
        miembrosActivos: activas,
        membresiasVencidas: vencidas,
        referidosValidos: referidos,
        puntosOtorgados: puntos._sum.points ?? 0,
        recompensasReclamadas: reclamadas,
        entregas: entregadas,
        // Lo que financia el negocio y lo que financia Membego, por separado.
        costoAsumido: dineroSupplyV2(economia.costoRealizado),
        comprometido: dineroSupplyV2(economia.comprometido),
      })
    }
    return salida
  })
}

// ── Membego (§41) ──────────────────────────────────────────────────────────

export interface TableroDeFidelizacion {
  programas: {
    id: string
    code: string
    nombre: string
    estado: SupplyV2LoyaltyProgramStatus
    propietario: string
    negocio: string | null
    miembrosActivos: number
    membresiasVencidas: number
    referidosValidos: number
    puntosEmitidos: number
    recompensasReclamadas: number
    presupuestoAprobado: string | null
    costoRealizado: string
    costoPendiente: string
    sinTope: boolean
    modalidades: SupplyV2LoyaltyModality[]
    funding: SupplyV2BenefitFunding
    startsAt: Date
    endsAt: Date | null
    /** Días tras los que vencen los puntos; null = no vencen. */
    puntosVencenEnDias: number | null
    puntosEmitidosAcum: number
    puntosVencidos: number
  }[]
  totales: {
    programasActivos: number
    miembrosActivos: number
    referidosValidos: number
    puntosEmitidos: number
    puntosDisponibles: number
    /** Puntos vencidos sin canjear, de todos los programas (dato real, no proyección). */
    puntosVencidos: number
    recompensasEntregadas: number
    /** Costo ya realizado entre recompensas entregadas; null si no hay entregas. */
    ticketMedio: string | null
    costoRealizado: string
    /** §37: ESTIMACIÓN, no deuda. La etiqueta viaja con la cifra. */
    costoPotencialEstimado: string
    estimacionAdvertencia: string
  }
}

/**
 * El tablero de Membego. Las cifras de resultado son reales; la única
 * estimación va marcada como tal y con su advertencia al lado, porque §41
 * prohíbe enseñar una estimación como si fuera un resultado confirmado.
 */
export async function tableroDeFidelizacion(): Promise<TableroDeFidelizacion> {
  return sinEmpresa('Supply 2.0: tablero de fidelización', async (tx) => {
    const programas = await tx.supplyV2LoyaltyProgram.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, code: true, name: true, status: true, owner: true, budgetTotal: true, modalities: true, funding: true, startsAt: true, endsAt: true, pointsExpireDays: true, supplier: { select: { commercialName: true } } },
    })
    const filas: TableroDeFidelizacion['programas'] = []
    let miembros = 0
    let referidos = 0
    let emitidos = 0
    let disponibles = 0
    let vencidosTotal = 0
    let entregadas = 0
    let realizadoTotal = new Prisma.Decimal(0)
    let potencialTotal = new Prisma.Decimal(0)

    for (const p of programas) {
      const [activas, vencidas, refs, emit, saldos, reclamadas, entreg] = await Promise.all([
        tx.supplyV2CustomerMembership.count({ where: { programId: p.id, status: 'ACTIVE' } }),
        tx.supplyV2CustomerMembership.count({ where: { programId: p.id, status: 'EXPIRED' } }),
        tx.supplyV2Referral.count({ where: { programId: p.id, status: 'REWARD_GRANTED' } }),
        tx.supplyV2PointsMovement.aggregate({ where: { account: { programId: p.id }, type: { in: ['EARNED', 'AVAILABLE'] } }, _sum: { points: true } }),
        tx.supplyV2PointsAccount.aggregate({ where: { programId: p.id }, _sum: { available: true, redeemed: true, expired: true } }),
        tx.supplyV2RewardClaim.count({ where: { programId: p.id, status: { in: ['CLAIMED', 'DELIVERED'] } } }),
        tx.supplyV2RewardClaim.count({ where: { programId: p.id, status: 'DELIVERED' } }),
      ])
      const economia = await economiaDelProgramaEnTx(tx, p.id)
      const porPunto = await valorMedioPorPuntoEnTx(tx, p.id)
      const compromiso = compromisoDePuntos(
        {
          emitidos: emit._sum.points ?? 0,
          disponibles: saldos._sum.available ?? 0,
          usados: saldos._sum.redeemed ?? 0,
          vencidos: saldos._sum.expired ?? 0,
        },
        economia.costoRealizado,
        porPunto
      )

      filas.push({
        id: p.id,
        code: p.code,
        nombre: p.name,
        estado: p.status,
        propietario: p.owner === 'MEMBEGO' ? 'Membego' : (p.supplier?.commercialName ?? 'Un negocio'),
        negocio: p.supplier?.commercialName ?? null,
        miembrosActivos: activas,
        membresiasVencidas: vencidas,
        referidosValidos: refs,
        puntosEmitidos: emit._sum.points ?? 0,
        recompensasReclamadas: reclamadas,
        presupuestoAprobado: p.budgetTotal ? dineroSupplyV2(p.budgetTotal) : null,
        costoRealizado: dineroSupplyV2(economia.costoRealizado),
        costoPendiente: dineroSupplyV2(economia.costoPendiente),
        sinTope: p.budgetTotal === null,
        modalidades: p.modalities,
        funding: p.funding,
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        puntosVencenEnDias: p.pointsExpireDays,
        puntosEmitidosAcum: emit._sum.points ?? 0,
        puntosVencidos: saldos._sum.expired ?? 0,
      })
      miembros += activas
      referidos += refs
      emitidos += emit._sum.points ?? 0
      disponibles += saldos._sum.available ?? 0
      vencidosTotal += saldos._sum.expired ?? 0
      entregadas += entreg
      realizadoTotal = realizadoTotal.plus(economia.costoRealizado)
      potencialTotal = potencialTotal.plus(compromiso.costoPotencialEstimado)
    }

    return {
      programas: filas,
      totales: {
        programasActivos: filas.filter((f) => f.estado === 'ACTIVE').length,
        miembrosActivos: miembros,
        referidosValidos: referidos,
        puntosEmitidos: emitidos,
        puntosDisponibles: disponibles,
        puntosVencidos: vencidosTotal,
        recompensasEntregadas: entregadas,
        ticketMedio: entregadas > 0 ? dineroSupplyV2(realizadoTotal.dividedBy(entregadas).toDecimalPlaces(2)) : null,
        costoRealizado: dineroSupplyV2(realizadoTotal),
        costoPotencialEstimado: dineroSupplyV2(potencialTotal),
        estimacionAdvertencia:
          'Estimación, no deuda: depende de que la gente canjee, de qué canjee y de que no se le venzan los puntos antes.',
      },
    }
  })
}

/** Ficha de un programa para Membego, con su bitácora. */
export async function fichaDePrograma(programId: string) {
  return sinEmpresa('Supply 2.0: ficha de un programa de fidelización', async (tx) => {
    const p = await tx.supplyV2LoyaltyProgram.findUnique({
      where: { id: programId },
      select: {
        id: true, code: true, name: true, description: true, objective: true, status: true, owner: true,
        currency: true, modalities: true, budgetTotal: true, budgetWaiverReason: true, budgetWaiverAt: true,
        startsAt: true, endsAt: true, pointsPerUnit: true, amountPerPoint: true, accrualBasis: true,
        pointsExpireDays: true, pointsHoldDays: true,
        supplier: { select: { id: true, commercialName: true } },
        plans: { select: { id: true, code: true, name: true, price: true, kind: true, status: true, durationDays: true, currentVersion: true, _count: { select: { memberships: true } } }, orderBy: { price: 'asc' } },
        rewards: { select: { id: true, code: true, name: true, pointsCost: true, status: true, timesClaimed: true, maxClaims: true, budgetTotal: true, unitCost: true }, orderBy: { pointsCost: 'asc' } },
        referralProgram: { select: { rewardKind: true, rewardPoints: true, waitingPeriodDays: true, maxPerReferrer: true, maxTotal: true, budgetTotal: true, active: true } },
        events: { select: { type: true, payload: true, createdAt: true, actor: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 60 },
      },
    })
    if (!p) return null
    const economia = await economiaDelProgramaEnTx(tx, programId)
    const porPunto = await valorMedioPorPuntoEnTx(tx, programId)
    const saldos = await tx.supplyV2PointsAccount.aggregate({ where: { programId }, _sum: { available: true, redeemed: true, expired: true, pending: true } })
    const emitidos = await tx.supplyV2PointsMovement.aggregate({ where: { account: { programId }, type: { in: ['EARNED', 'AVAILABLE'] } }, _sum: { points: true } })
    const compromiso = compromisoDePuntos(
      { emitidos: emitidos._sum.points ?? 0, disponibles: saldos._sum.available ?? 0, usados: saldos._sum.redeemed ?? 0, vencidos: saldos._sum.expired ?? 0 },
      economia.costoRealizado,
      porPunto
    )
    return {
      id: p.id,
      code: p.code,
      nombre: p.name,
      descripcion: p.description,
      objetivo: p.objective,
      estado: p.status,
      propietario: p.owner === 'MEMBEGO' ? 'Membego' : (p.supplier?.commercialName ?? 'Un negocio'),
      modalidades: p.modalities,
      vigencia: { desde: p.startsAt.toISOString(), hasta: fecha(p.endsAt) },
      reglaDePuntos:
        p.pointsPerUnit && p.amountPerPoint
          ? `${p.pointsPerUnit} ${p.pointsPerUnit === 1 ? 'punto' : 'puntos'} por cada ${dineroSupplyV2(p.amountPerPoint)} ${p.accrualBasis === 'CUSTOMER_PAID' ? 'pagados' : 'de valor de la compra'}`
          : null,
      vencimientoDePuntos: p.pointsExpireDays ? `${p.pointsExpireDays} días` : 'No vencen',
      diasPendientes: p.pointsHoldDays,
      presupuesto: {
        aprobado: economia.aprobado ? dineroSupplyV2(economia.aprobado) : null,
        comprometido: dineroSupplyV2(economia.comprometido),
        realizado: dineroSupplyV2(economia.costoRealizado),
        pendiente: dineroSupplyV2(economia.costoPendiente),
        disponible: economia.disponible ? dineroSupplyV2(economia.disponible) : null,
        algunaSinTope: economia.algunaRecompensaSinTope,
        sinTopeAutorizado: p.budgetTotal === null ? { motivo: p.budgetWaiverReason, cuando: fecha(p.budgetWaiverAt) } : null,
      },
      puntos: {
        emitidos: compromiso.puntosEmitidos,
        disponibles: compromiso.puntosDisponibles,
        pendientes: saldos._sum.pending ?? 0,
        usados: compromiso.puntosUsados,
        vencidos: compromiso.puntosVencidos,
        costoEfectivo: dineroSupplyV2(compromiso.costoEfectivo),
        costoPotencialEstimado: dineroSupplyV2(compromiso.costoPotencialEstimado),
        esEstimacion: compromiso.esEstimacion,
      },
      planes: p.plans.map((pl) => ({
        id: pl.id, code: pl.code, nombre: pl.name, precio: dineroSupplyV2(pl.price), tipo: pl.kind,
        estado: pl.status, dias: pl.durationDays, version: pl.currentVersion, miembros: pl._count.memberships,
      })),
      recompensas: p.rewards.map((r) => ({
        id: r.id, code: r.code, nombre: r.name, puntosNecesarios: r.pointsCost, estado: r.status,
        reclamadas: r.timesClaimed, tope: r.maxClaims,
        presupuesto: r.budgetTotal ? dineroSupplyV2(r.budgetTotal) : null,
        costoPorEntrega: r.unitCost ? dineroSupplyV2(r.unitCost) : null,
      })),
      referidos: p.referralProgram,
      bitacora: p.events.map((e) => ({ tipo: e.type, cuando: e.createdAt.toISOString(), quien: e.actor?.name ?? 'Sistema', detalle: e.payload })),
    }
  })
}

/** Resumen corto para el panel del cliente. */
export async function resumenDeFidelizacion(customerId: string, ahora = new Date()) {
  const [membresias, puntos] = await Promise.all([misMembresias(customerId, ahora), misPuntos(customerId)])
  return {
    membresiasActivas: membresias.filter((m) => m.vigente).length,
    membresias,
    puntos,
    puntosTotales: puntos.reduce((t, p) => t + p.disponibles, 0),
    proximoVencimiento: membresias
      .filter((m) => m.vigente && m.hasta)
      .sort((a, b) => (a.hasta! < b.hasta! ? -1 : 1))[0] ?? null,
  }
}

