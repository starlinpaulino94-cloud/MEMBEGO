import type { CustomerLocationSource } from '@prisma/client'

/**
 * Parser del formulario de ubicación del registro (docs/GEOLOCALIZACION.md §4,
 * §8.1 y §30). Puro y sin BD a propósito: lo prueba `tests/registro-geo-form`
 * y lo consume `registrarCliente`/`registrarCuentaGeneral`.
 *
 * Reglas:
 *  - La ubicación es OPCIONAL. Si no viene nada, `ok:true`, `guardar:false`.
 *  - `guardar` es true SOLO si la ubicación está completa y el usuario autorizó
 *    guardarla (`geoConsentHome === 'on'` → HOME_STORAGE). Si la llenó pero no
 *    autorizó, no se guarda (fail-open: el registro nunca se bloquea por esto).
 *  - El consentimiento de marketing (`geoConsentMarketing`) es INDEPENDIENTE:
 *    aceptar marketing ≠ guardar la vivienda (§33).
 *  - Las coordenadas van juntas o no van: con una sola se rechaza.
 *  - La fuente indica cómo llegaron los datos: MAP_SELECTION/DEVICE_LOCATION
 *    cuando hay coordenadas; MANUAL si solo ciudad/sector.
 */

export interface UbicacionFormDatos {
  countryId: string
  regionId: string
  regionNameRaw: string
  cityId: string
  cityNameRaw: string
  sectorId: string
  sectorNameRaw: string
  latitud: string
  longitud: string
  geoSource: string
  geoConsentHome: string
  geoConsentMarketing: string
}

export const UBICACION_FORM_VACIO: UbicacionFormDatos = {
  countryId: '',
  regionId: '',
  regionNameRaw: '',
  cityId: '',
  cityNameRaw: '',
  sectorId: '',
  sectorNameRaw: '',
  latitud: '',
  longitud: '',
  geoSource: '',
  geoConsentHome: '',
  geoConsentMarketing: '',
}

export interface UbicacionFormValidada {
  ok: true
  /** ¿Vino alguna parte de la ubicación? (país, provincia, ciudad o sector). */
  completa: boolean
  /** completa && usuario autorizó guardarla (HOME_STORAGE). */
  guardar: boolean
  /** ¿El usuario autorizó usarla para campañas (MARKETING_GEO)? Independiente. */
  marketingGeo: boolean
  ubicacion: {
    countryId: string | null
    regionId: string | null
    regionNameRaw: string | null
    cityId: string | null
    cityNameRaw: string | null
    sectorId: string | null
    sectorNameRaw: string | null
    latitud: number | null
    longitud: number | null
    source: CustomerLocationSource
    consentForPersonalization: boolean
  }
}

export type UbicacionFormResultado =
  | UbicacionFormValidada
  | { ok: false; error: string }

function texto(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function coordenadaValida(raw: string): number | null {
  const n = Number(raw)
  if (!raw || Number.isNaN(n)) return null
  return n
}

/**
 * Convierte el `FormData` (ya convertido a `Record<string,string>`) en el
 * resultado validado. Lanza el error de forma tipada para que el caller decida
 * cómo tratarlo (fail-open vs. bloqueante).
 */
export function leerUbicacionDeForm(entradas: Readonly<Record<string, string>>): UbicacionFormResultado {
  const d: UbicacionFormDatos = { ...UBICACION_FORM_VACIO }
  d.countryId = texto(entradas.geoCountryId)
  d.regionId = texto(entradas.geoRegionId)
  d.regionNameRaw = texto(entradas.geoRegionName)
  d.cityId = texto(entradas.geoCityId)
  d.cityNameRaw = texto(entradas.geoCityName)
  d.sectorId = texto(entradas.geoSectorId)
  d.sectorNameRaw = texto(entradas.geoSectorName)
  d.latitud = texto(entradas.geoLat)
  d.longitud = texto(entradas.geoLng)
  d.geoSource = texto(entradas.geoSource)
  d.geoConsentHome = texto(entradas.geoConsentHome)
  d.geoConsentMarketing = texto(entradas.geoConsentMarketing)

  const completa =
    !!(d.countryId || d.regionId || d.regionNameRaw ||
      d.cityId || d.cityNameRaw || d.sectorId || d.sectorNameRaw)

  if (!completa) {
    return {
      ok: true,
      completa: false,
      guardar: false,
      marketingGeo: d.geoConsentMarketing === 'on',
      ubicacion: {
        countryId: null,
        regionId: null,
        regionNameRaw: null,
        cityId: null,
        cityNameRaw: null,
        sectorId: null,
        sectorNameRaw: null,
        latitud: null,
        longitud: null,
        source: 'MANUAL',
        consentForPersonalization: false,
      },
    }
  }

  const latitud = coordenadaValida(d.latitud)
  const longitud = coordenadaValida(d.longitud)
  if (d.latitud && !d.longitud) {
    return { ok: false, error: 'Falta la longitud de tu ubicación.' }
  }
  if (d.longitud && !d.latitud) {
    return { ok: false, error: 'Falta la latitud de tu ubicación.' }
  }
  if (latitud !== null && (latitud < -90 || latitud > 90)) {
    return { ok: false, error: 'La latitud de tu ubicación no es válida.' }
  }
  if (longitud !== null && (longitud < -180 || longitud > 180)) {
    return { ok: false, error: 'La longitud de tu ubicación no es válida.' }
  }

  const conCoordenadas = latitud !== null && longitud !== null
  const source: CustomerLocationSource =
    d.geoSource === 'DEVICE_LOCATION'
      ? 'DEVICE_LOCATION'
      : d.geoSource === 'MAP_SELECTION'
        ? 'MAP_SELECTION'
        : 'MANUAL'

  return {
    ok: true,
    completa: true,
    guardar: d.geoConsentHome === 'on',
    marketingGeo: d.geoConsentMarketing === 'on',
    ubicacion: {
      countryId: d.countryId || null,
      regionId: d.regionId || null,
      regionNameRaw: d.regionNameRaw || null,
      cityId: d.cityId || null,
      cityNameRaw: d.cityNameRaw || null,
      sectorId: d.sectorId || null,
      sectorNameRaw: d.sectorNameRaw || null,
      latitud: conCoordenadas ? latitud : null,
      longitud: conCoordenadas ? longitud : null,
      source,
      consentForPersonalization: d.geoConsentMarketing === 'on',
    },
  }
}
