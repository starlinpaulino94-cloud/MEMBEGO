import { conEmpresa, sinEmpresa } from '@/lib/tenant'

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

export interface EmpresaListItem {
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
  updatedAt: Date
  _count: {
    clientes: number
    users: number
    sucursales: number
    plans: number
    promociones: number
  }
  _membresiaActivas: number
  _ingresos: number
  _ultimaActividad: Date | null
}

export async function listEmpresas(): Promise<EmpresaListItem[]> {
  return sinEmpresa('superadmin: listar todas las empresas', async (tx) => {
    const companies = await tx.company.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        description: true,
        logoUrl: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            clientes: true,
            users: true,
            plans: true,
          },
        },
      },
    })

    // Agregaciones globales por companyId en 5 queries fijas (antes 5 queries
    // POR empresa). Cada bloque conserva su fallback ante drift de esquema.
    const [activasGrupos, ingresosGrupos, actividadGrupos, sucursalesGrupos, promocionesGrupos] =
      await Promise.all([
        tx.membership
          .groupBy({
            by: ['companyId'],
            where: { estado: 'ACTIVA' },
            _count: { _all: true },
          })
          .catch((e) => {
            console.error('[empresas] Error counting active memberships:', e)
            return []
          }),
        tx.membership
          .groupBy({
            by: ['companyId'],
            where: { montoPagado: { not: null } },
            _sum: { montoPagado: true },
          })
          .catch((e) => {
            console.error('[empresas] Error aggregating ingresos:', e)
            return []
          }),
        tx.auditLog
          .groupBy({
            by: ['companyId'],
            where: { companyId: { not: null } },
            _max: { createdAt: true },
          })
          .catch((e) => {
            console.error('[empresas] Error getting ultima actividad:', e)
            return []
          }),
        tx.sucursal.groupBy({ by: ['companyId'], _count: { _all: true } }).catch(() => []),
        tx.promocion.groupBy({ by: ['companyId'], _count: { _all: true } }).catch(() => []),
      ])

    const activasDe = new Map(activasGrupos.map((g) => [g.companyId, g._count._all]))
    const ingresosDe = new Map(
      ingresosGrupos.map((g) => [g.companyId, Number(g._sum.montoPagado ?? 0)])
    )
    const actividadDe = new Map(
      actividadGrupos.map((g) => [g.companyId, g._max.createdAt ?? null])
    )
    const sucursalesDe = new Map(sucursalesGrupos.map((g) => [g.companyId, g._count._all]))
    const promocionesDe = new Map(promocionesGrupos.map((g) => [g.companyId, g._count._all]))

    const enriched = companies.map((c) => {
        const activas = activasDe.get(c.id) ?? 0
        const ingresos = ingresosDe.get(c.id) ?? 0
        const ultimaActividad = actividadDe.get(c.id) ?? null
        const sucursalesCount = sucursalesDe.get(c.id) ?? 0
        const promocionesCount = promocionesDe.get(c.id) ?? 0

        return {
          id: c.id,
          name: c.name,
          slug: c.slug,
          type: c.type,
          description: c.description,
          logoUrl: c.logoUrl,
          email: (c as Record<string, unknown>).email as string | null ?? null,
          telefono: (c as Record<string, unknown>).telefono as string | null ?? null,
          direccion: (c as Record<string, unknown>).direccion as string | null ?? null,
          ciudad: (c as Record<string, unknown>).ciudad as string | null ?? null,
          categoria: (c as Record<string, unknown>).categoria as string | null ?? null,
          website: (c as Record<string, unknown>).website as string | null ?? null,
          isActive: c.isActive,
          createdAt: c.createdAt,
          updatedAt: (c as Record<string, unknown>).updatedAt as Date ?? c.createdAt,
          _count: {
            clientes: c._count.clientes,
            users: c._count.users,
            sucursales: sucursalesCount,
            plans: c._count.plans,
            promociones: promocionesCount,
          },
          _membresiaActivas: activas,
          _ingresos: ingresos,
          _ultimaActividad: ultimaActividad,
        }
    })

    return enriched
  })
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
      safeCount(tx.membership.count({ where: { estado: 'ACTIVA', cliente: { companyId } } })),
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
        where: { cliente: { companyId }, montoPagado: { not: null } },
        _sum: { montoPagado: true },
      })
      ingresosTotales = Number(agg._sum.montoPagado ?? 0)
    } catch (e) { console.error('[empresas-dash] Error aggregating total ingresos:', e) }
    try {
      const agg = await tx.membership.aggregate({
        where: { cliente: { companyId }, montoPagado: { not: null }, updatedAt: { gte: inicioMes } },
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
