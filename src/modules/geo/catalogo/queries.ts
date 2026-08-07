import 'server-only'
import { prisma } from '@/lib/prisma'
import { normalizarNombre } from './normalizar'

/**
 * Catálogo geográfico normalizado (lecturas públicas). Son CATÁLOGOS
 * GLOBALES: cualquier inquilino los lee (RLS: lectura abierta) y solo el
 * superadmin escribe. Nada de esto expone ubicaciones de personas.
 */

export interface CatalogoItem {
  id: string
  name: string
  normalizedName: string
  isOperative: boolean
}

/** Países donde opera MembeGo (solo `isOperative`). */
export async function getPaisesOperativos(): Promise<
  { id: string; isoCode: string; name: string; regionLabel: string }[]
> {
  return prisma.country.findMany({
    where: { isOperative: true },
    orderBy: { name: 'asc' },
    select: { id: true, isoCode: true, name: true, regionLabel: true },
  })
}

/** Provincias/estados de un país (etiqueta: `Country.regionLabel`). */
export async function getRegionesDePais(countryId: string): Promise<CatalogoItem[]> {
  return prisma.region.findMany({
    where: { countryId, isOperative: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, normalizedName: true, isOperative: true },
  })
}

/** Ciudades/municipios de una provincia. */
export async function getCiudadesDeRegion(regionId: string): Promise<CatalogoItem[]> {
  return prisma.city.findMany({
    where: { regionId, isOperative: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, normalizedName: true, isOperative: true },
  })
}

/** Sectores/barrios de una ciudad, con su punto de referencia aproximado. */
export async function getSectoresDeCiudad(
  cityId: string,
  opts?: { soloVerificados?: boolean }
): Promise<(CatalogoItem & { latitud: number | null; longitud: number | null })[]> {
  return prisma.sector.findMany({
    where: { cityId, isOperative: true, ...(opts?.soloVerificados ? { isVerified: true } : {}) },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      normalizedName: true,
      isOperative: true,
      latitud: true,
      longitud: true,
    },
  })
}

/** Búsqueda de ciudades por nombre normalizado (autocomplete del onboarding). */
export async function buscarCiudades(q: string, limit = 8): Promise<CatalogoItem[]> {
  const termino = normalizarNombre(q)
  if (!termino) return []
  return prisma.city.findMany({
    where: {
      isOperative: true,
      normalizedName: { contains: termino },
    },
    orderBy: { normalizedName: 'asc' },
    take: limit,
    select: { id: true, name: true, normalizedName: true, isOperative: true },
  })
}

/** Búsqueda de sectores por nombre normalizado. */
export async function buscarSectores(q: string, cityId?: string, limit = 8): Promise<CatalogoItem[]> {
  const termino = normalizarNombre(q)
  if (!termino) return []
  return prisma.sector.findMany({
    where: {
      isOperative: true,
      ...(cityId ? { cityId } : {}),
      normalizedName: { contains: termino },
    },
    orderBy: { isVerified: 'desc' },
    take: limit,
    select: { id: true, name: true, normalizedName: true, isOperative: true },
  })
}
