'use server'

import {
  getPaisesOperativos,
  getRegionesDePais,
  getCiudadesDeRegion,
  getSectoresDeCiudad,
  buscarCiudades,
  buscarSectores,
} from './queries'

/**
 * Server actions del catálogo geográfico para el ASISTENTE DE REGISTRO y el
 * perfil. `queries.ts` es server-only (no importable desde componentes
 * cliente); estas acciones son la frontera: el navegador solo pide países,
 * provincias, ciudades y sectores — nunca datos de personas.
 *
 * Lecturas de catálogo global, sin rate limit agresivo: son pocas y livianas
 * (cada una es una SELECT con índice). El catálogo es público por diseño.
 */

export interface OpcionCatalogo {
  id: string
  name: string
}

export async function listarPaisesOperativos() {
  return getPaisesOperativos()
}

export async function listarRegionesDePais(countryId: string): Promise<OpcionCatalogo[]> {
  if (!countryId) return []
  return getRegionesDePais(countryId).then((rs) =>
    rs.map((r) => ({ id: r.id, name: r.name }))
  )
}

export async function listarCiudadesDeRegion(regionId: string): Promise<OpcionCatalogo[]> {
  if (!regionId) return []
  return getCiudadesDeRegion(regionId).then((cs) =>
    cs.map((c) => ({ id: c.id, name: c.name }))
  )
}

export interface OpcionSector extends OpcionCatalogo {
  latitud: number | null
  longitud: number | null
}

export async function listarSectoresDeCiudad(cityId: string): Promise<OpcionSector[]> {
  if (!cityId) return []
  return getSectoresDeCiudad(cityId, { soloVerificados: true }).then((ss) =>
    ss.map((s) => ({ id: s.id, name: s.name, latitud: s.latitud, longitud: s.longitud }))
  )
}

export async function buscarCiudadesCat(q: string): Promise<OpcionCatalogo[]> {
  return buscarCiudades(q, 8).then((cs) => cs.map((c) => ({ id: c.id, name: c.name })))
}

export async function buscarSectoresCat(q: string, cityId?: string): Promise<OpcionCatalogo[]> {
  return buscarSectores(q, cityId, 8).then((ss) => ss.map((s) => ({ id: s.id, name: s.name })))
}
