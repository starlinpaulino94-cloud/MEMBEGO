import { conEmpresa } from '@/lib/tenant'
import { normalizarBusqueda } from '@/modules/busqueda/normalizar'
import type { Prisma } from '@prisma/client'
import type { Paginacion } from '@/lib/paginacion'
import { condicionDeEstadoVendedores, condicionesDeCaptados, type FiltrosCaptados, type VerVendedores } from './lista'

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

/**
 * El equipo comercial PAGINADO por el servidor (06 · T-04): el estado, la búsqueda y la página los resuelve la base y devuelve el
 * total real. Antes se traían todos los vendedores y se filtraban en el navegador.
 */
export async function listarVendedores(
  companyId: string,
  opciones: { q?: string; ver?: VerVendedores; paginacion: Pick<Paginacion, 'saltar' | 'tomar'> }
) {
  const { q = '', ver = 'activos', paginacion } = opciones
  const like = { contains: q, mode: 'insensitive' as const }
  const where: Prisma.VendedorWhereInput = {
    companyId,
    ...condicionDeEstadoVendedores(ver),
    ...(q ? { OR: [{ nombre: like }, { apellido: like }, { codigo: like }, { tipo: like }, { telefono: { contains: q } }] } : {}),
  }
  return conEmpresa(companyId, async (tx) => {
    const [filas, total] = await Promise.all([
      tx.vendedor.findMany({
        where,
        orderBy: [{ estado: 'asc' }, { nombre: 'asc' }],
        skip: paginacion.saltar,
        take: paginacion.tomar,
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
      }),
      tx.vendedor.count({ where }),
    ])
    const hayAlgunoSinFiltro = filas.length === 0 ? (await tx.vendedor.count({ where: { companyId } })) > 0 : true
    return { filas, total, hayAlgunoSinFiltro }
  })
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

/**
 * Una página de los clientes que entraron por el enlace del vendedor: quién, en qué etapa del embudo, por qué canal y cuándo.
 *
 * Los filtros y la página los resuelve la base (`total` es el de los filtros). `hayAlguna` distingue «este vendedor todavía no
 * ha captado a nadie» de «ningún captado coincide con el filtro».
 */
export async function clientesCaptados(
  companyId: string,
  vendedorId: string,
  opciones: { filtros: FiltrosCaptados; paginacion: Pick<Paginacion, 'saltar' | 'tomar'> }
) {
  const { filtros, paginacion } = opciones

  return conEmpresa(companyId, async (tx) => {
    const base: Prisma.VendedorAtribucionWhereInput = { companyId, vendedorId, clienteId: { not: null } }
    const condiciones = condicionesDeCaptados(filtros)

    if (filtros.q) {
      const qLimpia = normalizarBusqueda(filtros.q)
      const coincidentes = await tx.cliente.findMany({
        where: {
          companyId,
          OR: [
            { nombreBusqueda: { contains: qLimpia } },
            { telefono: { contains: filtros.q } },
            { email: { contains: filtros.q, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      })
      condiciones.push({ clienteId: { in: coincidentes.map((c) => c.id) } })
    }
    const where: Prisma.VendedorAtribucionWhereInput = { ...base, AND: condiciones }

    const [total, filas] = await Promise.all([
      tx.vendedorAtribucion.count({ where }),
      tx.vendedorAtribucion.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: paginacion.saltar,
        take: paginacion.tomar,
        select: { id: true, clienteId: true, etapa: true, canal: true, createdAt: true },
      }),
    ])
    // Solo si no salió nada: ¿es que no ha captado a nadie, o es que el filtro los esconde? La pantalla dice cosas distintas.
    const hayAlguna = filas.length === 0 ? (await tx.vendedorAtribucion.count({ where: base })) > 0 : true
    if (filas.length === 0) return { filas: [], total, hayAlguna }

    const ids = [...new Set(filas.map((f) => f.clienteId!))]
    const clientes = await tx.cliente.findMany({
      where: { id: { in: ids }, companyId },
      select: { id: true, nombre: true, telefono: true, email: true },
    })
    const porId = new Map(clientes.map((c) => [c.id, c]))

    return {
      filas: filas.map((f) => ({
        id: f.id,
        etapa: f.etapa,
        canal: f.canal,
        createdAt: f.createdAt,
        nombre: porId.get(f.clienteId!)?.nombre ?? 'Cliente',
        telefono: porId.get(f.clienteId!)?.telefono ?? null,
        email: porId.get(f.clienteId!)?.email ?? null,
      })),
      total,
      hayAlguna,
    }
  })
}
