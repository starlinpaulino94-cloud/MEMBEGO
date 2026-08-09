/**
 * Contrato del módulo "Cerca de mí" (§13 del mapa). Tipos compartidos entre la
 * capa de datos (`queries.ts`), la API (`/api/geo/*`) y la UI (MapaCercaDeMi).
 */

/** Contexto del que se obtiene la ubicación de búsqueda (§13, G-7). */
export type ContextoUbicacion = 'CURRENT' | 'HOME' | 'MANUAL'

export interface UbicacionBusqueda {
  contexto: ContextoUbicacion
  lat: number
  lng: number
  /** Etiqueta para la UI: "Mi ubicación actual", "Mi vivienda", "El Play".
      Proviene del catálogo para MANUAL. */
  etiqueta?: string
  /** radio por defecto sugerido para este contexto (km). */
  radioKm?: number
  cityId?: string | null
  sectorId?: string | null
}

export type FiltroOfertas = 'con_ofertas' | 'gratis' | 'membresias'

export interface FiltrosCercanos {
  /** Tipos de negocio (Company.type), p.ej. ['carwash', 'spa']. */
  tiposNegocio?: string[]
  /** Categorías de negocio (BusinessCategory.id). */
  categorias?: string[]
  /** Solo negocios con ofertas vigentes (true). */
  soloConOfertas?: boolean
  /** Solo promociones gratuitas (no comprables / precio 0). Implica con ofertas. */
  soloGratis?: boolean
  /** Solo negocios con planes de membresía activos. */
  soloMembresias?: boolean
  /** Solo negocios abiertos ahora (filtro en tiempo de respuesta, §13). */
  abiertosAhora?: boolean
}

export interface SucursalCercana {
  id: string
  nombre: string
  empresaId: string
  empresaNombre: string
  empresaSlug: string
  logoUrl: string | null
  tipo: string
  direccion: string | null
  telefono: string | null
  latitud: number
  longitud: number
  ciudad: string | null
  sector: string | null
  distanciaM: number | null
  tieneOfertas: boolean
  ofertaDestacada: string | null
  cantidadOfertas: number
  abierto: boolean | null
  horarioTexto: string | null
  categorias: string[]
  promedioRating: number | null
  esFavorita: boolean
  /** Ruta de detalle dentro de la app (tarjeta del mapa). */
  urlDetalle: string
}

export interface ResultadoCercanos {
  resultados: SucursalCercana[]
  hayMas: boolean
  total: number
  ubicacion: UbicacionBusqueda
}

export interface ViewportMapa {
  west: number
  south: number
  east: number
  north: number
}

/** Resultado de autocompletar para la búsqueda de zonas/direcciones (§13). */
export interface SugerenciaUbicacion {
  id: string
  tipo: 'ciudad' | 'sector' | 'direccion'
  etiqueta: string
  contexto: 'MANUAL'
  lat: number | null
  lng: number | null
  cityId?: string | null
  sectorId?: string | null
}

/** Radios permitidos para el mapa (km). null = "Toda la ciudad". */
export const RADIOS_CERCANOS = [1, 3, 5, 10, 20, null] as const
export type RadioCercano = (typeof RADIOS_CERCANOS)[number]

export const RADIO_POR_DEFECTO = 5
export const RADIO_POR_DEFECTO_CURRENT = 3

/**
 * ¿Sale esta sucursal en "Cerca de mí"?
 *
 * ESPEJO EN TYPESCRIPT DEL FILTRO SQL de `condicionesFiltros`
 * (modules/geo/cercanos/queries.ts). Las condiciones que dependen de la EMPRESA
 * —activa, publicada, no demo— no están aquí: esto responde por la sucursal,
 * que es lo que el admin puede arreglar desde `/admin/sucursales`.
 *
 * Existe porque el panel prometía "para que aparezcan en el mapa de tus
 * clientes" y luego no decía cuáles lo hacían. Una sucursal sin coordenadas se
 * veía idéntica a una que sí las tiene, y el mapa respondía "0 negocios" —que
 * parece una respuesta correcta, no un fallo—, así que no había forma de
 * enterarse. La prueba `geo-visibilidad` vigila que este espejo no se separe
 * del SQL.
 */
export function sucursalVisibleEnMapa(s: {
  activa: boolean
  mostrarEnMapa: boolean
  latitud: number | null
  longitud: number | null
}): boolean {
  return s.activa && s.mostrarEnMapa && s.latitud !== null && s.longitud !== null
}
