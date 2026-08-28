import { sinEmpresa } from '@/lib/tenant'
import type { ExcursionCardData } from '@/components/public/ExcursionCard'
import { calcularDisponibilidad, mapRow } from './public-queries'

/** Empresas no demo y activas — las que pueden aparecer en la vitrina del cliente. */
async function empresasVisibles(): Promise<string[]> {
  const rows = await sinEmpresa('excursiones: catálogo del cliente (empresas visibles)', (tx) =>
    tx.company.findMany({
      where: { isActive: true, esDemo: false },
      select: { id: true },
    })
  )
  return rows.map((r) => r.id)
}

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
  tipoItem: true,
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
  comboItems: {
    orderBy: { orden: 'asc' as const },
    select: {
      horaSalida: true,
      permitirSolapamiento: true,
      horarioFijo: true,
      actividad: {
        select: {
          id: true,
          nombre: true,
          tipoItem: true,
          capacidad: true,
          horaSalida: true,
          horaRegreso: true,
          horarios: {
            where: { activo: true },
            select: { id: true, horaSalida: true, diasSemana: true, cupo: true },
          },
        },
      },
    },
  },
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
  const companies = await sinEmpresa('excursiones: catálogo del cliente', (tx) =>
      tx.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, slug: true, name: true, logoUrl: true, moneda: true },
  })
    )
  const companyMap = new Map(companies.map((c) => [c.id, c]))

  const mapped = await Promise.all(
    rows.map(async (exc) => {
      const disponibilidad = await calcularDisponibilidad(
        exc.companyId,
        exc.id,
        exc.capacidad,
        exc.horarios,
        exc.horaRegreso,
        exc.horaSalida,
        exc.tipoItem,
        exc.comboItems
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
  const visibles = await empresasVisibles()
  const rows = await sinEmpresa('excursiones: catálogo del cliente', (tx) =>
      tx.excursion.findMany({
    where: { estado: 'ACTIVA', companyId: { in: visibles } },
    select: { categoria: true },
    distinct: ['categoria'],
  })
    )

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

  const visibles = await empresasVisibles()

  const whereBase: Record<string, unknown> = {
    estado: 'ACTIVA',
    companyId: { in: visibles },
    ...(empresaId && visibles.includes(empresaId) ? { companyId: empresaId } : {}),
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

  const rows = await sinEmpresa('excursiones: catálogo del cliente', (tx) =>
      tx.excursion.findMany({
    where: whereBase,
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: EXCURSION_SELECT,
  })
    )

  // Las filas crudas no sirven a la tarjeta: hay que resolver empresa y
  // disponibilidad. El mapeador ya existe en este archivo — faltaba llamarlo.
  const conDisponibilidad = await mapearExcursionesConDisponibilidad(rows)

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
  const dbUser = await sinEmpresa('excursiones: catálogo del cliente', (tx) =>
      tx.user.findUnique({
    where: { id: dbUserId },
    select: { supabaseId: true },
  })
    )

  const supabaseId = dbUser?.supabaseId

  // 1. Obtener empresas donde el cliente está afiliado o sigue
  let companyIdsCliente: string[] = []
  if (supabaseId) {
    const [fichas, follows] = await Promise.all([
      sinEmpresa('excursiones: catálogo del cliente', (tx) =>
      tx.cliente.findMany({
        where: { supabaseId, company: { isActive: true } },
        select: { companyId: true },
      })
    ),
      sinEmpresa('excursiones: catálogo del cliente', (tx) =>
      tx.companyFollow.findMany({
        where: { userId: dbUserId, company: { isActive: true } },
        select: { companyId: true },
      })
    ),
    ])
    companyIdsCliente = [...new Set([...fichas.map((f) => f.companyId), ...follows.map((f) => f.companyId)])]
  }

  // 2. Filtrar empresas de demo
  const visibles = await empresasVisibles()
  const companyIdsClienteVisibles = companyIdsCliente.filter((id) => visibles.includes(id))

  // 3. Traer excursiones en paralelo
  const [rowsMisEmpresas, rowsDestacadas, rowsNuevas] = await Promise.all([
    companyIdsClienteVisibles.length > 0
      ? sinEmpresa('excursiones: catálogo del cliente', (tx) =>
      tx.excursion.findMany({
          where: {
            companyId: { in: companyIdsClienteVisibles },
            estado: 'ACTIVA',
          },
          orderBy: { createdAt: 'desc' },
          take: 16,
          select: EXCURSION_SELECT,
        })
    )
      : Promise.resolve([]),
    sinEmpresa('excursiones: catálogo del cliente', (tx) =>
      tx.excursion.findMany({
      where: { estado: 'ACTIVA', companyId: { in: visibles } },
      orderBy: { createdAt: 'desc' },
      take: 16,
      select: EXCURSION_SELECT,
    })
    ),
    sinEmpresa('excursiones: catálogo del cliente', (tx) =>
      tx.excursion.findMany({
      where: {
        estado: 'ACTIVA',
        companyId: { in: visibles },
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
      take: 16,
      select: EXCURSION_SELECT,
    })
    ),
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
