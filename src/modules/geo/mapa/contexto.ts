import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import { LocationService } from '@/modules/geo/ubicaciones/service'
import {
  RADIO_POR_DEFECTO,
  RADIO_POR_DEFECTO_CURRENT,
  type ContextoUbicacion,
  type UbicacionBusqueda,
} from '@/modules/geo/cercanos/tipos'

/**
 * Resolutor de la ubicación activa del mapa "Cerca de mí" (§13, G-7).
 *
 * TRES CONTEXTOS, TRES CONTRATOS:
 *  · CURRENT  → el GPS puntual de la sesión. Nunca se guarda. Exige
 *               consentimiento DEVICE_LOCATION_SESSION (se otorga en la UI
 *               al pulsar "Usar mi ubicación actual").
 *  · HOME     → la ubicación primaria de la persona (CustomerLocation).
 *               Solo ciudad/sector (UNVERIFIED) no da radio: se usa el punto
 *               de referencia del sector o se avisa.
 *  · MANUAL   → una zona del catálogo (sector con punto de referencia) o un
 *               punto elegido/geocodificado por el usuario.
 *
 * El resultado SIEMPRE tiene coordenadas: la búsqueda por radio las exige.
 */
export type ErrorContextoCodigo =
  | 'ubicacion_invalida'
  | 'sin_ubicacion_vivienda'
  | 'sin_coordenadas'

export class ErrorContextoUbicacion extends Error {
  readonly codigo: ErrorContextoCodigo
  constructor(codigo: ErrorContextoCodigo, message: string) {
    super(message)
    this.codigo = codigo
  }
}

export interface EntradaContexto {
  contexto: ContextoUbicacion
  /** `dbUserId` de la sesión (null si el visitante no ha iniciado sesión). */
  dbUserId: string | null
  /** Coordenadas del dispositivo (CURRENT) o punto elegido (MANUAL). */
  lat?: number | null
  lng?: number | null
  cityId?: string | null
  sectorId?: string | null
  /** Radio solicitado por la UI (validado aparte por la ruta). */
  radioKm?: number | null
}

export function coordenadasValidas(
  lat: unknown,
  lng: unknown
): { lat: number; lng: number } | null {
  const okLat = typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90
  const okLng = typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180
  return okLat && okLng ? { lat, lng } : null
}

/**
 * Ciudad y sector son catálogo MUNDIAL: no tienen `companyId`, así que no hay
 * inquilino al que acotar la consulta. Solo se leen nombres y el punto de
 * referencia de la zona — nunca la ubicación de una persona (esa va por
 * `LocationService`, que sí acota con `conUsuario`).
 */
const MOTIVO = 'geo: catálogo mundial (ciudad/sector), sin dueño por empresa'

/** Punto de referencia de un sector del catálogo, con etiqueta completa. */
async function buscarSectorConEtiqueta(sectorId: string) {
  return sinEmpresa(MOTIVO, (tx) =>
    tx.sector.findUnique({
      where: { id: sectorId },
      select: {
        id: true,
        name: true,
        latitud: true,
        longitud: true,
        city: { select: { id: true, name: true, region: { select: { id: true, name: true } } } },
      },
    })
  )
}

export async function resolverUbicacionActiva(
  input: EntradaContexto
): Promise<UbicacionBusqueda> {
  const { contexto, dbUserId, radioKm } = input

  if (contexto === 'CURRENT') {
    const coords = coordenadasValidas(input.lat, input.lng)
    if (!coords) {
      throw new ErrorContextoUbicacion(
        'ubicacion_invalida',
        'No recibimos una ubicación válida de tu dispositivo. Intenta de nuevo.'
      )
    }
    return {
      contexto,
      lat: coords.lat,
      lng: coords.lng,
      etiqueta: 'Mi ubicación actual',
      radioKm: radioKm ?? RADIO_POR_DEFECTO_CURRENT,
    }
  }

  if (contexto === 'HOME') {
    if (!dbUserId) {
      throw new ErrorContextoUbicacion(
        'sin_ubicacion_vivienda',
        'Inicia sesión para buscar cerca de tu vivienda.'
      )
    }
    const loc = await LocationService.primaria(dbUserId)
    if (!loc) {
      throw new ErrorContextoUbicacion(
        'sin_ubicacion_vivienda',
        'Aún no has guardado tu vivienda. Añádela en tu perfil o busca por zona.'
      )
    }
    const lat =
      typeof loc.latitud === 'number' ? loc.latitud : (loc.sector?.latitud ?? null)
    const lng =
      typeof loc.longitud === 'number' ? loc.longitud : (loc.sector?.longitud ?? null)
    if (lat === null || lng === null) {
      throw new ErrorContextoUbicacion(
        'sin_coordenadas',
        'Tu vivienda no tiene un punto en el mapa. Edítala o elige una zona.'
      )
    }
    const partes = [loc.sector?.name, loc.city?.name].filter(Boolean)
    return {
      contexto,
      lat,
      lng,
      etiqueta: loc.label ?? (partes.length ? partes.join(', ') : 'Mi vivienda'),
      radioKm: radioKm ?? RADIO_POR_DEFECTO,
      cityId: loc.cityId,
      sectorId: loc.sectorId,
    }
  }

  // MANUAL
  const coordsManual = coordenadasValidas(input.lat, input.lng)
  if (coordsManual) {
    const partesEtiqueta: string[] = []
    if (input.sectorId) {
      const sector = await buscarSectorConEtiqueta(input.sectorId)
      if (sector) partesEtiqueta.push(sector.name, sector.city.name)
    } else if (input.cityId) {
      const city = await sinEmpresa(MOTIVO, (tx) =>
        tx.city.findUnique({
          where: { id: input.cityId as string },
          select: { id: true, name: true },
        })
      )
      if (city) partesEtiqueta.push(city.name)
    }
    return {
      contexto,
      lat: coordsManual.lat,
      lng: coordsManual.lng,
      etiqueta: partesEtiqueta.length ? partesEtiqueta.join(', ') : 'Esta zona',
      radioKm: radioKm ?? RADIO_POR_DEFECTO,
      cityId: input.cityId,
      sectorId: input.sectorId,
    }
  }

  if (input.sectorId) {
    const sector = await buscarSectorConEtiqueta(input.sectorId)
    if (sector && typeof sector.latitud === 'number' && typeof sector.longitud === 'number') {
      return {
        contexto,
        lat: sector.latitud,
        lng: sector.longitud,
        etiqueta: [sector.name, sector.city.name].filter(Boolean).join(', '),
        radioKm: radioKm ?? RADIO_POR_DEFECTO,
        cityId: sector.city.id,
        sectorId: sector.id,
      }
    }
    throw new ErrorContextoUbicacion(
      'sin_coordenadas',
      'Ese sector aún no tiene un punto en el mapa. Prueba con otro.'
    )
  }

  if (input.cityId) {
    const city = await sinEmpresa(MOTIVO, (tx) =>
      tx.city.findUnique({
        where: { id: input.cityId as string },
        select: {
          id: true,
          name: true,
          sectors: {
            where: { isOperative: true, latitud: { not: null }, longitud: { not: null } },
            orderBy: { name: 'asc' },
            take: 1,
            select: { id: true, name: true, latitud: true, longitud: true },
          },
        },
      })
    )
    if (city) {
      const ref = city.sectors[0]
      if (ref && typeof ref.latitud === 'number' && typeof ref.longitud === 'number') {
        return {
          contexto,
          lat: ref.latitud,
          lng: ref.longitud,
          etiqueta: city.name,
          radioKm: radioKm ?? RADIO_POR_DEFECTO,
          cityId: city.id,
          sectorId: ref.id,
        }
      }
    }
    throw new ErrorContextoUbicacion(
      'sin_coordenadas',
      'Esa ciudad aún no tiene un punto de referencia. Elige un sector.'
    )
  }

  throw new ErrorContextoUbicacion(
    'ubicacion_invalida',
    'Elige una ubicación en el mapa o una zona de la lista.'
  )
}
