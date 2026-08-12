import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { whereCobrado } from '@/modules/pagos/cobrado'
import { membresiaVigente } from '@/modules/membresia/vigencia'

export interface CategoryOption {
  id: string
  name: string
  icon: string | null
}

/** Categorías de negocio activas para poblar selectores del panel. */
export async function getActiveCategories(): Promise<CategoryOption[]> {
  try {
    const cats = await sinEmpresa('empresas: categorías de negocio (catálogo global)', (tx) =>
      tx.businessCategory.findMany({
        where: { active: true },
        orderBy: { order: 'asc' },
        select: { id: true, name: true, icon: true },
      })
    )
    return cats
  } catch (e) {
    console.error('[getActiveCategories]', e)
    return []
  }
}

/** IDs de las categorías asignadas a una empresa. */
export async function getCompanyCategoryIds(companyId: string): Promise<string[]> {
  try {
    const rows = await conEmpresa(companyId, (tx) =>
      tx.companyToCategory.findMany({
        where: { companyId },
        select: { categoryId: true },
      })
    )
    return rows.map((r) => r.categoryId)
  } catch (e) {
    console.error('[getCompanyCategoryIds]', e)
    return []
  }
}

export interface EmpresaDashboard {
  company: {
    id: string
    name: string
    slug: string
    type: string
    description: string | null
    logoUrl: string | null
    email: string | null
    telefono: string | null
    direccion: string | null
    ciudad: string | null
    categoria: string | null
    website: string | null
    isActive: boolean
    createdAt: Date
  }
  stats: {
    totalClientes: number
    totalUsuarios: number
    totalSucursales: number
    totalPlanes: number
    planesActivos: number
    totalPromociones: number
    promocionesActivas: number
    totalReferidos: number
    membresiasActivas: number
    membresiasPendientes: number
    membresiasTotal: number
    pagosConfirmados: number
    ingresosTotales: number
    ingresosEsteMes: number
  }
  actividadReciente: {
    id: string
    accion: string
    detalle: string | null
    createdAt: Date
    userName: string | null
  }[]
  topPlanes: {
    id: string
    nombre: string
    precio: number
    membresiaCount: number
  }[]
  membresiasPorEstado: { estado: string; count: number }[]
}

export async function getEmpresaDashboard(companyId: string): Promise<EmpresaDashboard | null> {
  return conEmpresa(companyId, async (tx) => {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: {
        id: true, name: true, slug: true, type: true,
        description: true, logoUrl: true, isActive: true, createdAt: true,
      },
    })
    if (!company) return null

    const now = new Date()
    const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1)

    const safeCount = (p: Promise<number>) => p.catch(() => 0)

    const [
      totalClientes,
      totalUsuarios,
      totalPlanes,
      planesActivos,
      membresiasActivas,
      membresiasTotal,
    ] = await Promise.all([
      safeCount(tx.cliente.count({ where: { companyId } })),
      safeCount(tx.user.count({ where: { companyId } })),
      safeCount(tx.plan.count({ where: { companyId } })),
      safeCount(tx.plan.count({ where: { companyId, activo: true } })),
      safeCount(tx.membership.count({ where: { ...membresiaVigente(), cliente: { companyId } } })),
      safeCount(tx.membership.count({ where: { cliente: { companyId } } })),
    ])

    let totalSucursales = 0
    let totalPromociones = 0
    let promocionesActivas = 0
    let totalReferidos = 0
    let membresiasPendientes = 0
    let pagosConfirmados = 0
    let ingresosTotales = 0
    let ingresosEsteMes = 0

    try { totalSucursales = await tx.sucursal.count({ where: { companyId } }) } catch (e) { console.error('[empresas-dash] Error counting sucursales:', e) }
    try { totalPromociones = await tx.promocion.count({ where: { companyId } }) } catch (e) { console.error('[empresas-dash] Error counting promociones:', e) }
    try { promocionesActivas = await tx.promocion.count({ where: { companyId, activo: true } }) } catch (e) { console.error('[empresas-dash] Error counting active promociones:', e) }
    try { totalReferidos = await tx.referido.count({ where: { companyId, sospechoso: false } }) } catch (e) { console.error('[empresas-dash] Error counting referidos:', e) }
    try { membresiasPendientes = await tx.membership.count({ where: { estado: 'PENDIENTE_PAGO', cliente: { companyId } } }) } catch (e) { console.error('[empresas-dash] Error counting pending memberships:', e) }
    try { pagosConfirmados = await tx.membership.count({ where: { pagoConfirmado: true, cliente: { companyId } } }) } catch (e) { console.error('[empresas-dash] Error counting confirmed payments:', e) }
    try {
      const agg = await tx.membership.aggregate({
        where: whereCobrado(new Date(0), undefined, { cliente: { companyId } }),
        _sum: { montoPagado: true },
      })
      ingresosTotales = Number(agg._sum.montoPagado ?? 0)
    } catch (e) { console.error('[empresas-dash] Error aggregating total ingresos:', e) }
    try {
      const agg = await tx.membership.aggregate({
        where: whereCobrado(inicioMes, undefined, { cliente: { companyId } }),
        _sum: { montoPagado: true },
      })
      ingresosEsteMes = Number(agg._sum.montoPagado ?? 0)
    } catch (e) { console.error('[empresas-dash] Error aggregating monthly ingresos:', e) }

    let actividadReciente: EmpresaDashboard['actividadReciente'] = []
    try {
      const logs = await tx.auditLog.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 15,
        include: { user: { select: { name: true } } },
      })
      actividadReciente = (logs as { id: string; accion: string; entidadTipo: string; createdAt: Date; user: { name: string } | null }[]).map((a) => ({
        id: a.id,
        accion: String(a.accion),
        detalle: a.entidadTipo,
        createdAt: a.createdAt,
        userName: a.user?.name ?? null,
      }))
    } catch (e) { console.error('[empresas-dash] Error fetching audit logs:', e) }

    let topPlanes: EmpresaDashboard['topPlanes'] = []
    try {
      const planes = await tx.plan.findMany({
        where: { companyId, activo: true },
        include: { _count: { select: { memberships: true } } },
        orderBy: { createdAt: 'asc' },
      })
      topPlanes = planes.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        precio: Number(p.precio),
        membresiaCount: p._count.memberships,
      }))
    } catch (e) { console.error('[empresas-dash] Error fetching top planes:', e) }

    let membresiasPorEstado: EmpresaDashboard['membresiasPorEstado'] = []
    try {
      const grouped = await tx.membership.groupBy({
        by: ['estado'],
        where: { cliente: { companyId } },
        _count: { _all: true },
      })
      membresiasPorEstado = grouped.map((m) => ({ estado: m.estado, count: m._count._all }))
    } catch (e) { console.error('[empresas-dash] Error grouping memberships by estado:', e) }

    return {
      company: {
        ...company,
        email: null,
        telefono: null,
        direccion: null,
        ciudad: null,
        categoria: null,
        website: null,
      },
      stats: {
        totalClientes,
        totalUsuarios,
        totalSucursales,
        totalPlanes,
        planesActivos,
        totalPromociones,
        promocionesActivas,
        totalReferidos,
        membresiasActivas,
        membresiasPendientes,
        membresiasTotal,
        pagosConfirmados,
        ingresosTotales,
        ingresosEsteMes,
      },
      actividadReciente,
      topPlanes,
      membresiasPorEstado,
    }
  })
}
