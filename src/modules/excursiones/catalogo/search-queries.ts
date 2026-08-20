/**
 * EXCURSIONES · Catálogo — Queries de BÚSQUEDA PÚBLICA.
 *
 * Extiende public-queries.ts con capacidades de búsqueda cross-empresa,
 * filtros avanzados y paginación. Usa las mismas estructuras de datos
 * (ExcursionPublica, SalidaDisponible) y la lógica de disponibilidad.
 */

import { prisma } from '@/lib/prisma'
import type { Decimal } from '@prisma/client/runtime/library'
import { calcularDisponibilidad, mapRow, type ExcursionPublica, type SalidaDisponible } from './public-queries'

export interface FiltrosExcursion {
  companyId?: string
  query?: string
  fechaDesde?: Date
  fechaHasta?: Date
  soloConStock?: boolean
  excluirFinalizadas?: boolean
  categoria?: string
  pagina?: number
  porPagina?: number
}

export interface ResultadoBusqueda {
  excursiones: ExcursionPublica[]
  total: number
  pagina: number
  porPagina: number
  totalPaginas: number
  categorias: string[]
  empresas: { id: string; slug: string; name: string; logoUrl: string | null }[]
}

function toNum(d: Decimal | null): number | null {
  return d == null ? null : Number(d)
}

/**
 * Búsqueda principal de excursiones públicas con filtros y paginación.
 */
export async function buscarExcursionesPublicas(filtros: FiltrosExcursion = {}): Promise<ResultadoBusqueda> {
  const {
    companyId,
    query,
    fechaDesde,
    fechaHasta,
    soloConStock = false,
    excluirFinalizadas = true,
    categoria,
    pagina = 1,
    porPagina = 12,
  } = filtros

  const skip = (pagina - 1) * porPagina
  const take = porPagina

  // Construir where base: solo excursiones ACTIVAS
  const whereBase: Record<string, unknown> = {
    estado: 'ACTIVA',
    ...(companyId ? { companyId } : {}),
    ...(categoria ? { categoria } : {}),
  }

  // Búsqueda full-text en nombre, descripción, categoría, ubicación
  if (query?.trim()) {
    const q = query.trim()
    whereBase.OR = [
      { nombre: { contains: q, mode: 'insensitive' } },
      { descripcion: { contains: q, mode: 'insensitive' } },
      { categoria: { contains: q, mode: 'insensitive' } },
      { ubicacion: { contains: q, mode: 'insensitive' } },
    ]
  }

  // Obtener total para paginación
  const total = await prisma.excursion.count({ where: whereBase })

  // Obtener excursiones con select (sin include company)
  const rows = await prisma.excursion.findMany({
    where: whereBase,
    orderBy: { nombre: 'asc' },
    skip,
    take,
    select: {
      id: true,
      nombre: true,
      slug: true,
      descripcion: true,
      portadaUrl: true,
      galeria: true,
      duracionMin: true,
      ubicacion: true,
      categoria: true,
      moneda: true,
      impuestoPct: true,
      capacidad: true,
      puntoSalida: true,
      horaSalida: true,
      horaRegreso: true,
      incluye: true,
      noIncluye: true,
      politicas: true,
      companyId: true,
      variantes: {
        where: { activa: true },
        orderBy: { orden: 'asc' },
        select: { id: true, nombre: true, precioAdulto: true, precioNino: true, capacidad: true, orden: true },
      },
      horarios: {
        where: { activo: true },
        orderBy: { horaSalida: 'asc' },
        select: { id: true, diasSemana: true, horaSalida: true, cupo: true },
      },
    },
  })

  // Obtener empresas en bulk
  const companyIds = [...new Set(rows.map((r) => r.companyId))]
  const companies = await prisma.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, slug: true, name: true, logoUrl: true },
  })
  const companyMap = new Map(companies.map((c) => [c.id, c]))

  // Calcular disponibilidad para cada excursión
  const excursionesConDisponibilidad = await Promise.all(
    rows.map(async (exc) => {
      const disponibilidad = await calcularDisponibilidad(
        exc.companyId,
        exc.id,
        exc.capacidad,
        exc.horarios as { id: string; diasSemana: number[]; horaSalida: string; cupo: number | null }[],
        exc.horaRegreso
      )
      const company = companyMap.get(exc.companyId)
      const mapped = mapRow({
        ...exc,
        ...disponibilidad,
        company: company ? { id: company.id, slug: company.slug, name: company.name, logoUrl: company.logoUrl } : null,
      })
      return mapped
    })
  )

  // Filtrar por stock y finalizadas
  let filtradas = excursionesConDisponibilidad
  if (excluirFinalizadas) {
    filtradas = filtradas.filter((e) => !e.todasFechasPasadas)
  }
  if (soloConStock) {
    filtradas = filtradas.filter((e) => !e.agotadaGlobal)
  }

  // Filtrar por fecha de salidas (si se especifica)
  if (fechaDesde || fechaHasta) {
    filtradas = filtradas.filter((exc) => {
      if (exc.proximasSalidas.length === 0) return false
      const primeraSalida = new Date(exc.proximasSalidas[0].fecha)
      const ultimaSalida = new Date(exc.proximasSalidas[exc.proximasSalidas.length - 1].fecha)
      if (fechaDesde && ultimaSalida < fechaDesde) return false
      if (fechaHasta && primeraSalida > fechaHasta) return false
      return true
    })
  }

  // Obtener categorías únicas para filtros
  const categorias = [...new Set(rows.map((r) => r.categoria).filter((c): c is string => !!c))].sort()

  // Obtener empresas para filtros
  const empresas = Array.from(companyMap.values())

  return {
    excursiones: filtradas,
    total: filtradas.length,
    pagina,
    porPagina,
    totalPaginas: Math.ceil(filtradas.length / porPagina),
    categorias,
    empresas,
  }
}

/**
 * Búsqueda simplificada para autocompletar / sugerencias.
 */
export async function sugerenciasExcursiones(texto: string, limite = 5): Promise<Pick<ExcursionPublica, 'id' | 'nombre' | 'slug' | 'categoria'>[]> {
  if (!texto.trim() || texto.length < 2) return []

  const rows = await prisma.excursion.findMany({
    where: {
      estado: 'ACTIVA',
      OR: [
        { nombre: { contains: texto, mode: 'insensitive' } },
        { categoria: { contains: texto, mode: 'insensitive' } },
      ],
    },
    orderBy: { nombre: 'asc' },
    take: limite,
    select: {
      id: true,
      nombre: true,
      slug: true,
      categoria: true,
      companyId: true,
    },
  })

  const companyIds = [...new Set(rows.map((r) => r.companyId))]
  const companies = await prisma.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, slug: true, name: true },
  })
  const companyMap = new Map(companies.map((c) => [c.id, c]))

  return rows.map((r) => {
    const c = companyMap.get(r.companyId)
    return {
      id: r.id,
      nombre: r.nombre,
      slug: r.slug,
      categoria: r.categoria,
      company: c ? { id: c.id, slug: c.slug, name: c.name } : null,
    }
  })
}

/**
 * Excursiones destacadas para homepage / landing.
 */
export async function excursionesDestacadas(limite = 6): Promise<ExcursionPublica[]> {
  const rows = await prisma.excursion.findMany({
    where: { estado: 'ACTIVA' },
    orderBy: { createdAt: 'desc' },
    take: limite,
    select: {
      id: true,
      nombre: true,
      slug: true,
      descripcion: true,
      portadaUrl: true,
      galeria: true,
      duracionMin: true,
      ubicacion: true,
      categoria: true,
      moneda: true,
      impuestoPct: true,
      capacidad: true,
      puntoSalida: true,
      horaSalida: true,
      horaRegreso: true,
      incluye: true,
      noIncluye: true,
      politicas: true,
      companyId: true,
      variantes: {
        where: { activa: true },
        orderBy: { orden: 'asc' },
        select: { id: true, nombre: true, precioAdulto: true, precioNino: true, capacidad: true, orden: true },
      },
      horarios: {
        where: { activo: true },
        orderBy: { horaSalida: 'asc' },
        select: { id: true, diasSemana: true, horaSalida: true, cupo: true },
      },
    },
  })

  const companyIds = [...new Set(rows.map((r) => r.companyId))]
  const companies = await prisma.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, slug: true, name: true, logoUrl: true },
  })
  const companyMap = new Map(companies.map((c) => [c.id, c]))

  const excursionesConDisponibilidad = await Promise.all(
    rows.map(async (exc) => {
      const disponibilidad = await calcularDisponibilidad(
        exc.companyId,
        exc.id,
        exc.capacidad,
        exc.horarios as { id: string; diasSemana: number[]; horaSalida: string; cupo: number | null }[],
        exc.horaRegreso
      )
      const company = companyMap.get(exc.companyId)
      return mapRow({
        ...exc,
        ...disponibilidad,
        company: company ? { id: company.id, slug: company.slug, name: company.name, logoUrl: company.logoUrl } : null,
      })
    })
  )

  return excursionesConDisponibilidad.filter((e) => !e.todasFechasPasadas && !e.agotadaGlobal)
}