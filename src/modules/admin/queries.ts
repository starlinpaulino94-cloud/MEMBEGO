import { Prisma } from '@prisma/client'
import { conEmpresa, sinEmpresa, type Tx } from '@/lib/tenant'
import type { SessionUser } from '@/types'

/** companyId filter: superadmin gets undefined (all), admin gets their company. */
export function companyFilter(user: SessionUser): string | undefined {
  if (user.metadata.role === 'SUPERADMIN') return undefined
  return user.metadata.companyId ?? '__none__'
}

/** Query de una empresa, o de todas si `companyId` es undefined (superadmin). */
function scopeEmpresa<T>(
  companyId: string | undefined,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  if (companyId) return conEmpresa(companyId, fn)
  return sinEmpresa('reportes del superadmin: cruza todas las empresas', fn)
}

export async function adminMetrics(user: SessionUser) {
  const companyId = companyFilter(user)
  return scopeEmpresa(companyId, async (tx) => {
    const clienteWhere = companyId ? { companyId } : {}
    // Filtro directo por memberships.companyId (indexado); antes se filtraba
    // vía cliente.companyId, forzando un JOIN innecesario.
    const membershipWhere = companyId ? { companyId } : {}
    const visitWhere = companyId ? { cliente: { companyId } } : {}

    const safeCount = (p: Promise<number>) => p.catch(() => 0)

    const [totalClientes, activas, pendientes, visitasHoy] = await Promise.all([
      safeCount(tx.cliente.count({ where: clienteWhere })),
      safeCount(tx.membership.count({
        where: { ...membershipWhere, estado: 'ACTIVA' },
      })),
      safeCount(tx.membership.count({
        where: { ...membershipWhere, estado: 'PENDIENTE' },
      })),
      safeCount(tx.visit.count({
        where: {
          ...visitWhere,
          fechaVisita: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      })),
    ])

    return { totalClientes, activas, pendientes, visitasHoy }
  })
}

export interface ReportePorPlan {
  plan: string
  count: number
}

export interface ClienteFrecuente {
  clienteId: string
  nombre: string
  visitas: number
}

export interface MembresiaPorVencer {
  id: string
  cliente: string
  plan: string
  fechaVencimiento: Date | null
}

export interface ReportesData {
  ingresosMes: number
  activasPorPlan: ReportePorPlan[]
  lavadosMes: number
  clientesFrecuentes: ClienteFrecuente[]
  membresiasPorVencer: MembresiaPorVencer[]
}

async function ingresosDelMes(
  tx: Tx,
  where: Prisma.MembershipWhereInput,
  monthStart: Date,
  monthEnd: Date
): Promise<number> {
  try {
    const agg = await tx.membership.aggregate({
      _sum: { montoPagado: true },
      where: {
        ...where,
        pagoConfirmado: true,
        updatedAt: { gte: monthStart, lt: monthEnd },
      },
    })
    return Number(agg._sum.montoPagado ?? 0)
  } catch {
    return 0
  }
}

async function activasPorPlanQuery(
  tx: Tx,
  where: Prisma.MembershipWhereInput
): Promise<ReportePorPlan[]> {
  try {
    // Conteo agregado en la BD. Antes se cargaban TODAS las membresías
    // activas (con include del plan) solo para contarlas en memoria.
    const grupos = await tx.membership.groupBy({
      by: ['planId'],
      where: { ...where, estado: 'ACTIVA' },
      _count: { _all: true },
    })
    if (grupos.length === 0) return []
    const planes = await tx.plan.findMany({
      where: { id: { in: grupos.map((g) => g.planId) } },
      select: { id: true, nombre: true },
    })
    const nombreDe = new Map(planes.map((p) => [p.id, p.nombre]))
    const porNombre = new Map<string, number>()
    for (const g of grupos) {
      const nombre = nombreDe.get(g.planId) ?? 'Plan'
      porNombre.set(nombre, (porNombre.get(nombre) ?? 0) + g._count._all)
    }
    return Array.from(porNombre.entries())
      .map(([plan, count]) => ({ plan, count }))
      .sort((a, b) => b.count - a.count)
  } catch {
    return []
  }
}

async function clientesFrecuentesQuery(
  tx: Tx,
  visitWhere: Prisma.VisitWhereInput
): Promise<ClienteFrecuente[]> {
  try {
    const visitasPorCliente = await tx.visit.groupBy({
      by: ['clienteId'],
      where: visitWhere,
      _count: { _all: true },
      orderBy: { _count: { clienteId: 'desc' } },
      take: 5,
    })
    if (visitasPorCliente.length === 0) return []
    const clientes = await tx.cliente.findMany({
      where: { id: { in: visitasPorCliente.map((v) => v.clienteId) } },
      select: { id: true, nombre: true },
    })
    const nombreMap = new Map(clientes.map((c) => [c.id, c.nombre]))
    return visitasPorCliente.map((v) => ({
      clienteId: v.clienteId,
      nombre: nombreMap.get(v.clienteId) ?? 'Cliente',
      visitas: v._count._all,
    }))
  } catch {
    return []
  }
}

async function membresiasPorVencerQuery(
  tx: Tx,
  where: Prisma.MembershipWhereInput,
  now: Date,
  in7Days: Date
): Promise<MembresiaPorVencer[]> {
  try {
    const porVencer = await tx.membership.findMany({
      where: {
        ...where,
        estado: 'ACTIVA',
        fechaVencimiento: { gte: now, lte: in7Days },
      },
      include: {
        plan: { select: { nombre: true } },
        cliente: { select: { nombre: true } },
      },
      orderBy: { fechaVencimiento: 'asc' },
      take: 100,
    })
    return porVencer.map((m) => ({
      id: m.id,
      cliente: m.cliente.nombre,
      plan: m.plan.nombre,
      fechaVencimiento: m.fechaVencimiento,
    }))
  } catch {
    return []
  }
}

/** All admin reports in one call. companyId undefined => all companies. */
export async function getReportesAdmin(
  companyId: string | undefined
): Promise<ReportesData> {
  // memberships.companyId directo (indexado); Visit no tiene companyId,
  // así que las visitas siguen filtrándose vía cliente.
  const membershipWhere = companyId ? { companyId } : {}
  const visitWhere = companyId ? { cliente: { companyId } } : {}

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const in7Days = new Date(now)
  in7Days.setDate(in7Days.getDate() + 7)

  return scopeEmpresa(companyId, async (tx) => {
    // Bloques independientes en paralelo (antes ~6 round-trips secuenciales),
    // cada uno con su fallback para no tumbar el reporte completo.
    const [ingresosMes, activasPorPlan, lavadosMes, clientesFrecuentes, membresiasPorVencer] =
      await Promise.all([
        ingresosDelMes(tx, membershipWhere, monthStart, monthEnd),
        activasPorPlanQuery(tx, membershipWhere),
        tx.visit
          .count({
            where: { ...visitWhere, fechaVisita: { gte: monthStart, lt: monthEnd } },
          })
          .catch(() => 0),
        clientesFrecuentesQuery(tx, visitWhere),
        membresiasPorVencerQuery(tx, membershipWhere, now, in7Days),
      ])

    return { ingresosMes, activasPorPlan, lavadosMes, clientesFrecuentes, membresiasPorVencer }
  })
}

export interface ReportesGlobales {
  total: ReportesData
  empresas: { companyId: string; nombre: string; data: ReportesData }[]
}

/**
 * Global reports (superadmin): overall plus per-company breakdown.
 *
 * Número FIJO de queries (~11) independiente del número de empresas: los
 * desgloses salen de agregaciones globales por companyId. Antes se ejecutaba
 * getReportesAdmin por cada empresa (~7×N queries simultáneas), el peor
 * ofensor de agotamiento del pool de conexiones.
 */
export async function getReportesGlobales(): Promise<ReportesGlobales> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const in7Days = new Date(now)
  in7Days.setDate(in7Days.getDate() + 7)

  const [total, companies, ingresosPorEmpresa, activasPorEmpresaPlan, lavadosPorEmpresa, porVencerGlobal] =
    await Promise.all([
      getReportesAdmin(undefined),
      sinEmpresa('reportes globales: listar todas las empresas', (tx) =>
        tx.company.findMany({
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        })
      ),
      sinEmpresa('reportes globales: ingresos por empresa', (tx) =>
        tx.membership
          .groupBy({
            by: ['companyId'],
            _sum: { montoPagado: true },
            where: {
              pagoConfirmado: true,
              updatedAt: { gte: monthStart, lt: monthEnd },
            },
          })
          .catch(() => [])
      ),
      sinEmpresa('reportes globales: activas por empresa y plan', (tx) =>
        tx.membership
          .groupBy({
            by: ['companyId', 'planId'],
            _count: { _all: true },
            where: { estado: 'ACTIVA' },
          })
          .catch(() => [])
      ),
      sinEmpresa('reportes globales: lavados por empresa', (tx) =>
        tx.$queryRaw<{ companyId: string; total: number }[]>`
          SELECT c."companyId", COUNT(*)::int AS total
          FROM "visits" v
          JOIN "clientes" c ON c."id" = v."clienteId"
          WHERE v."fechaVisita" >= ${monthStart} AND v."fechaVisita" < ${monthEnd}
          GROUP BY c."companyId"
        `.catch(() => [] as { companyId: string; total: number }[])
      ),
      sinEmpresa('reportes globales: membresías por vencer en todas las empresas', (tx) =>
        tx.membership
          .findMany({
            where: {
              estado: 'ACTIVA',
              fechaVencimiento: { gte: now, lte: in7Days },
            },
            select: {
              id: true,
              companyId: true,
              fechaVencimiento: true,
              plan: { select: { nombre: true } },
              cliente: { select: { nombre: true } },
            },
            orderBy: { fechaVencimiento: 'asc' },
            take: 500,
          })
          .catch(() => [])
      ),
    ])

  // Nombres de todos los planes referenciados, en una sola pasada.
  const planIds = [...new Set(activasPorEmpresaPlan.map((g) => g.planId))]
  const planes = planIds.length
    ? await sinEmpresa('reportes globales: nombres de planes referenciados', (tx) =>
        tx.plan
          .findMany({
            where: { id: { in: planIds } },
            select: { id: true, nombre: true },
          })
          .catch(() => [])
      )
    : []
  const planNombre = new Map(planes.map((p) => [p.id, p.nombre]))

  const ingresosDe = new Map(
    ingresosPorEmpresa.map((g) => [g.companyId, Number(g._sum.montoPagado ?? 0)])
  )
  const lavadosDe = new Map(lavadosPorEmpresa.map((r) => [r.companyId, r.total]))

  const empresas = companies.map((c) => {
    const porNombre = new Map<string, number>()
    for (const g of activasPorEmpresaPlan) {
      if (g.companyId !== c.id) continue
      const nombre = planNombre.get(g.planId) ?? 'Plan'
      porNombre.set(nombre, (porNombre.get(nombre) ?? 0) + g._count._all)
    }
    const activasPorPlan = Array.from(porNombre.entries())
      .map(([plan, count]) => ({ plan, count }))
      .sort((a, b) => b.count - a.count)

    const membresiasPorVencer = porVencerGlobal
      .filter((m) => m.companyId === c.id)
      .map((m) => ({
        id: m.id,
        cliente: m.cliente.nombre,
        plan: m.plan.nombre,
        fechaVencimiento: m.fechaVencimiento,
      }))

    return {
      companyId: c.id,
      nombre: c.name,
      data: {
        ingresosMes: ingresosDe.get(c.id) ?? 0,
        activasPorPlan,
        lavadosMes: lavadosDe.get(c.id) ?? 0,
        // La vista global no muestra clientes frecuentes por empresa;
        // omitirlo evita un top-5 (2 queries) por cada empresa.
        clientesFrecuentes: [],
        membresiasPorVencer,
      },
    }
  })

  return { total, empresas }
}
