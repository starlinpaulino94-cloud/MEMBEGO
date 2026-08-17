import { prisma } from '@/lib/prisma'
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
 * PÚBLICO · destino del enlace /e/[slug]: la página de registro de la empresa
 * con el código del vendedor (`v`) y el enlace usado (`e` — distingue QRs de
 * campaña). Enlace inactivo, vendedor no activo o empresa apagada → null.
 * La Fase 4 registra aquí la atribución de VISITA.
 */
export async function destinoDeEnlace(slug: string): Promise<string | null> {
  const enlace = await prisma.vendedorEnlace
    .findUnique({
      where: { slug },
      select: {
        activo: true,
        slug: true,
        vendedor: { select: { codigo: true, estado: true, companyId: true } },
      },
    })
    .catch(() => null)
  if (!enlace || !enlace.activo || enlace.vendedor.estado !== 'ACTIVO') return null
  const empresa = await prisma.company
    .findUnique({ where: { id: enlace.vendedor.companyId }, select: { slug: true, isActive: true } })
    .catch(() => null)
  if (!empresa?.isActive) return null
  return `/registro/${empresa.slug}?v=${encodeURIComponent(enlace.vendedor.codigo)}&e=${encodeURIComponent(enlace.slug)}`
}
