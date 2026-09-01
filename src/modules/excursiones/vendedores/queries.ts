import { conEmpresa } from '@/lib/tenant'

/** Listado del equipo comercial con su embudo (captados = atribuciones). */
export async function listadoVendedores(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.vendedor.findMany({
      where: { companyId },
      orderBy: [{ estado: 'asc' }, { nombre: 'asc' }],
      select: {
        id: true,
        nombre: true,
        apellido: true,
        codigo: true,
        tipo: true,
        telefono: true,
        estado: true,
        _count: { select: { atribuciones: true } },
      },
    })
  )
}

/** Perfil completo: datos + enlace + embudo real por etapa. */
export async function vendedorDetalle(companyId: string, vendedorId: string) {
  return conEmpresa(companyId, async (tx) => {
    const vendedor = await tx.vendedor.findFirst({
      where: { id: vendedorId, companyId },
      include: {
        // Sin filtrar por activo: el perfil enseña el enlace aunque esté
        // suspendido (el redirect público es quien deja de captar).
        enlaces: { orderBy: { createdAt: 'asc' }, take: 1 },
        supervisor: { select: { id: true, nombre: true, apellido: true } },
      },
    })
    if (!vendedor) return null

    // Correo de la cuenta y embudo en paralelo dentro de la misma transacción
    const [cuenta, embudo] = await Promise.all([
      vendedor.userId
        ? tx.user.findFirst({
            where: { id: vendedor.userId, companyId },
            select: { email: true },
          })
        : Promise.resolve(null),
      tx.vendedorAtribucion.groupBy({
        by: ['etapa'],
        where: { companyId, vendedorId },
        _count: { _all: true },
      }),
    ])

    const porEtapa = new Map(embudo.map((e) => [e.etapa, e._count._all]))
    return {
      vendedor,
      correoAcceso: cuenta?.email ?? null,
      embudo: {
        visitas: porEtapa.get('VISITA') ?? 0,
        registros: porEtapa.get('REGISTRO') ?? 0,
        reservas: porEtapa.get('RESERVA') ?? 0,
        compras: porEtapa.get('COMPRA') ?? 0,
      },
    }
  })
}

/** Vendedores activos, para el selector de supervisor. */
export async function vendedoresParaSupervisor(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.vendedor.findMany({
      where: { companyId, estado: 'ACTIVO' },
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true, apellido: true, codigo: true, tipo: true },
    })
  )
}

export interface ClientesCaptadosFiltros {
  q?: string
  etapa?: string
  canal?: string
  desde?: string
  hasta?: string
  page?: number
  limit?: number
}

export interface ClientesCaptadosResultado {
  items: {
    id: string
    etapa: string
    canal: string | null
    createdAt: Date
    nombre: string
    telefono: string | null
    email?: string | null
  }[]
  total: number
  totalPages: number
  currentPage: number
}

/**
 * Últimos clientes captados por el vendedor: quién entró por su enlace, en qué
 * etapa y cuándo con soporte para filtros multicriterio y paginación.
 */
export async function clientesCaptados(
  companyId: string,
  vendedorId: string,
  filtros: ClientesCaptadosFiltros = {}
): Promise<ClientesCaptadosResultado> {
  const page = Math.max(1, Number(filtros.page) || 1)
  const limit = Math.max(1, Math.min(100, Number(filtros.limit) || 15))
  const skip = (page - 1) * limit

  return conEmpresa(companyId, async (tx) => {
    let clienteIdsFiltrados: string[] | undefined = undefined

    // Si hay búsqueda por texto (nombre, teléfono o email)
    if (filtros.q && filtros.q.trim()) {
      const qClean = filtros.q.trim()
      const clientesCoincidentes = await tx.cliente.findMany({
        where: {
          companyId,
          OR: [
            { nombre: { contains: qClean, mode: 'insensitive' } },
            { telefono: { contains: qClean } },
            { email: { contains: qClean, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      })
      clienteIdsFiltrados = clientesCoincidentes.map((c) => c.id)
      if (clienteIdsFiltrados.length === 0) {
        return { items: [], total: 0, totalPages: 1, currentPage: page }
      }
    }

    // Armar condiciones de fecha
    const dateFilter: { gte?: Date; lte?: Date } = {}
    if (filtros.desde) {
      const d = new Date(filtros.desde)
      if (!isNaN(d.getTime())) dateFilter.gte = d
    }
    if (filtros.hasta) {
      const h = new Date(filtros.hasta)
      if (!isNaN(h.getTime())) {
        h.setHours(23, 59, 59, 999)
        dateFilter.lte = h
      }
    }

    const whereClause = {
      companyId,
      vendedorId,
      clienteId: clienteIdsFiltrados ? { in: clienteIdsFiltrados } : { not: null },
      ...(filtros.etapa && filtros.etapa !== 'TODAS' ? { etapa: filtros.etapa } : {}),
      ...(filtros.canal && filtros.canal !== 'TODOS' ? { canal: filtros.canal } : {}),
      ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
    }

    const [total, filas] = await Promise.all([
      tx.vendedorAtribucion.count({ where: whereClause }),
      tx.vendedorAtribucion.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: { id: true, clienteId: true, etapa: true, canal: true, createdAt: true },
      }),
    ])

    if (filas.length === 0) {
      return { items: [], total, totalPages: Math.max(1, Math.ceil(total / limit)), currentPage: page }
    }

    const ids = [...new Set(filas.map((f) => f.clienteId!))]
    const clientes = await tx.cliente.findMany({
      where: { id: { in: ids }, companyId },
      select: { id: true, nombre: true, telefono: true, email: true },
    })
    const porId = new Map(clientes.map((c) => [c.id, c]))

    const items = filas.map((f) => ({
      id: f.id,
      etapa: f.etapa,
      canal: f.canal,
      createdAt: f.createdAt,
      nombre: porId.get(f.clienteId!)?.nombre ?? 'Cliente',
      telefono: porId.get(f.clienteId!)?.telefono ?? null,
      email: porId.get(f.clienteId!)?.email ?? null,
    }))

    return {
      items,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      currentPage: page,
    }
  })
}
