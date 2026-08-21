import { prisma } from '@/lib/prisma'
import { sinEmpresa } from '@/lib/tenant'
import type { ExcursionCardData } from '@/components/public/ExcursionCard'
import { calcularDisponibilidad, mapRow } from './public-queries'

export interface ExcursionFeed {
  misEmpresas: ExcursionCardData[]
  destacadas: ExcursionCardData[]
  nuevas: ExcursionCardData[]
  proximasSalidas: ExcursionCardData[]
}

const EXCURSION_SELECT = {
  id: true,
  nombre: true,
  slug: true,
  descripcion: true,
  portadaUrl: true,
  duracionMin: true,
  ubicacion: true,
  categoria: true,
  moneda: true,
  capacidad: true,
  horaSalida: true,
  horaRegreso: true,
  companyId: true,
  createdAt: true,
  variantes: {
    where: { activa: true },
    orderBy: { orden: 'asc' as const },
    select: { id: true, nombre: true, precioAdulto: true, precioNino: true, capacidad: true, orden: true },
  },
  horarios: {
    where: { activo: true },
    orderBy: { horaSalida: 'asc' as const },
    select: { id: true, diasSemana: true, horaSalida: true, cupo: true },
  },
}

/**
 * Convierte un array de excursiones raw de Prisma a ExcursionCardData calculando
 * disponibilidad y asignando la información de la empresa.
 */
async function mapearExcursionesConDisponibilidad(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[]
): Promise<ExcursionCardData[]> {
  if (rows.length === 0) return []

  const companyIds = [...new Set(rows.map((r) => r.companyId))]
  const companies = await prisma.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, slug: true, name: true, logoUrl: true, moneda: true },
  })
  const companyMap = new Map(companies.map((c) => [c.id, c]))

  const mapped = await Promise.all(
    rows.map(async (exc) => {
      const disponibilidad = await calcularDisponibilidad(
        exc.companyId,
        exc.id,
        exc.capacidad,
        exc.horarios,
        exc.horaRegreso,
        exc.horaSalida
      )
      const company = companyMap.get(exc.companyId)
      const rowMapped = mapRow(exc)
      const precioDesde = rowMapped.variantes[0]?.precioAdulto ?? null

      const cardData: ExcursionCardData = {
        id: exc.id,
        nombre: exc.nombre,
        slug: exc.slug,
        descripcion: exc.descripcion,
        portadaUrl: exc.portadaUrl,
        categoria: exc.categoria,
        duracionMin: exc.duracionMin,
        ubicacion: exc.ubicacion,
        precioDesde,
        moneda: company?.moneda || exc.moneda || 'DOP',
        agotadaGlobal: disponibilidad.agotadaGlobal,
        todasFechasPasadas: disponibilidad.todasFechasPasadas,
        cupoDisponible: disponibilidad.proximasSalidas[0]?.cupoDisponible ?? null,
        proximasSalidas: disponibilidad.proximasSalidas,
        empresa: company
          ? {
              id: company.id,
              slug: company.slug,
              name: company.name,
              logoUrl: company.logoUrl,
            }
          : null,
      }
      return cardData
    })
  )

  return mapped
}

/**
 * Obtiene todas las categorías únicas disponibles en excursiones activas.
 */
export async function getCategoriasExcursiones(): Promise<{ slug: string; name: string }[]> {
  const rows = await prisma.excursion.findMany({
    where: { estado: 'ACTIVA' },
    select: { categoria: true },
    distinct: ['categoria'],
  })

  return rows
    .map((r) => r.categoria)
    .filter((c): c is string => Boolean(c && c.trim()))
    .sort()
    .map((cat) => ({ slug: cat, name: cat }))
}

/**
 * Búsqueda de excursiones para la vitrina del cliente.
 */
export async function buscarExcursionesCliente(filtros: {
  texto?: string
  categoria?: string
  empresaId?: string
  soloConStock?: boolean
}): Promise<ExcursionCardData[]> {
  const { texto, categoria, empresaId, soloConStock } = filtros

  const whereBase: Record<string, unknown> = {
    estado: 'ACTIVA',
    ...(empresaId ? { companyId: empresaId } : {}),
    ...(categoria ? { categoria: { equals: categoria, mode: 'insensitive' } } : {}),
  }

  if (texto?.trim()) {
    const q = texto.trim()
    whereBase.OR = [
      { nombre: { contains: q, mode: 'insensitive' } },
      { descripcion: { contains: q, mode: 'insensitive' } },
      { categoria: { contains: q, mode: 'insensitive' } },
      { ubicacion: { contains: q, mode: 'insensitive' } },
    ]
  }

  const rows = await prisma.excursion.findMany({
    where: whereBase,
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: EXCURSION_SELECT,
  })

  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)

  // Filtrar estrictamente excursiones atrasadas (sin salidas futuras vigentes o todas pasadas)
  const vigentes = conDisponibilidad.filter(
    (e) =>
      !e.todasFechasPasadas &&
      (e.proximasSalidas || []).some((s) => !s.fechaPasada && new Date(s.fecha) >= hoy)
  )

  if (soloConStock) {
    return vigentes.filter((e) => !e.agotadaGlobal && (e.cupoDisponible ?? 0) > 0)
  }

  return vigentes
}

/**
 * Obtiene el feed curado de excursiones para un cliente autenticado:
 * - De tus empresas
 * - Destacadas
 * - Nuevas
 * - Próximas salidas
 */
export async function getExcursionFeed(dbUserId: string): Promise<ExcursionFeed> {
  const dbUser = await prisma.user.findUnique({
    where: { id: dbUserId },
    select: { supabaseId: true },
  })

  const supabaseId = dbUser?.supabaseId

  // 1. Obtener empresas donde el cliente está afiliado o sigue
  let companyIdsCliente: string[] = []
  if (supabaseId) {
    const [fichas, follows] = await Promise.all([
      prisma.cliente.findMany({
        where: { supabaseId, company: { isActive: true } },
        select: { companyId: true },
      }),
      prisma.companyFollow.findMany({
        where: { userId: dbUserId, company: { isActive: true } },
        select: { companyId: true },
      }),
    ])
    companyIdsCliente = [...new Set([...fichas.map((f) => f.companyId), ...follows.map((f) => f.companyId)])]
  }

  // 2. Traer excursiones en paralelo
  const [rowsMisEmpresas, rowsDestacadas, rowsNuevas] = await Promise.all([
    companyIdsCliente.length > 0
      ? prisma.excursion.findMany({
          where: {
            companyId: { in: companyIdsCliente },
            estado: 'ACTIVA',
          },
          orderBy: { createdAt: 'desc' },
          take: 16,
          select: EXCURSION_SELECT,
        })
      : Promise.resolve([]),
    prisma.excursion.findMany({
      where: { estado: 'ACTIVA' },
      orderBy: { createdAt: 'desc' },
      take: 16,
      select: EXCURSION_SELECT,
    }),
    prisma.excursion.findMany({
      where: {
        estado: 'ACTIVA',
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
      take: 16,
      select: EXCURSION_SELECT,
    }),
  ])

  const [misEmpresas, destacadas, nuevas] = await Promise.all([
    mapearExcursionesConDisponibilidad(rowsMisEmpresas),
    mapearExcursionesConDisponibilidad(rowsDestacadas),
    mapearExcursionesConDisponibilidad(rowsNuevas),
  ])

  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const esVigente = (e: ExcursionCardData) =>
    !e.todasFechasPasadas &&
    (e.proximasSalidas || []).some((s) => !s.fechaPasada && new Date(s.fecha) >= hoy)

  const misEmpresasVigentes = misEmpresas.filter(esVigente)
  const destacadasVigentes = destacadas.filter(esVigente)
  const nuevasVigentes = nuevas.filter(esVigente)

  const proximasSalidas = [...destacadasVigentes]
    .filter((e) => !e.agotadaGlobal && (e.cupoDisponible ?? 0) > 0)
    .slice(0, 12)

  return {
    misEmpresas: misEmpresasVigentes.slice(0, 12),
    destacadas: destacadasVigentes.slice(0, 12),
    nuevas: nuevasVigentes.slice(0, 12),
    proximasSalidas,
  }
}
