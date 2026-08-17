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
  const vendedor = await conEmpresa(companyId, (tx) =>
    tx.vendedor.findFirst({
      where: { id: vendedorId, companyId },
      include: {
        // Sin filtrar por activo: el perfil enseña el enlace aunque esté
        // suspendido (el redirect público es quien deja de captar).
        enlaces: { orderBy: { createdAt: 'asc' }, take: 1 },
        supervisor: { select: { id: true, nombre: true, apellido: true } },
      },
    })
  )
  if (!vendedor) return null

  // Correo de la cuenta con la que entra a su panel, si tiene acceso.
  const cuenta = vendedor.userId
    ? await conEmpresa(companyId, (tx) =>
        tx.user.findFirst({
          where: { id: vendedor.userId!, companyId },
          select: { email: true },
        })
      )
    : null

  const embudo = await conEmpresa(companyId, (tx) =>
    tx.vendedorAtribucion.groupBy({
      by: ['etapa'],
      where: { companyId, vendedorId },
      _count: { _all: true },
    })
  )
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
}

/** Vendedores activos, para el selector de supervisor. */
export async function vendedoresParaSupervisor(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.vendedor.findMany({
      where: { companyId, estado: 'ACTIVO' },
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true, apellido: true, codigo: true },
    })
  )
}

/**
 * Últimos clientes captados por el vendedor: quién entró por su enlace, en qué
 * etapa y cuándo. Es el detalle del embudo — el nombre detrás del número.
 */
export async function clientesCaptados(companyId: string, vendedorId: string, limite = 15) {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.vendedorAtribucion.findMany({
      where: { companyId, vendedorId, clienteId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: limite,
      select: { id: true, clienteId: true, etapa: true, canal: true, createdAt: true },
    })
  )
  if (filas.length === 0) return []

  const ids = [...new Set(filas.map((f) => f.clienteId!))]
  const clientes = await conEmpresa(companyId, (tx) =>
    tx.cliente.findMany({
      where: { id: { in: ids }, companyId },
      select: { id: true, nombre: true, telefono: true },
    })
  )
  const porId = new Map(clientes.map((c) => [c.id, c]))
  return filas.map((f) => ({
    id: f.id,
    etapa: f.etapa,
    canal: f.canal,
    createdAt: f.createdAt,
    nombre: porId.get(f.clienteId!)?.nombre ?? 'Cliente',
    telefono: porId.get(f.clienteId!)?.telefono ?? null,
  }))
}
