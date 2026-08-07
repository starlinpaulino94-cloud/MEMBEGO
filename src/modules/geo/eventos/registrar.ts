import 'server-only'
import { conUsuario, sinEmpresa } from '@/lib/tenant'
import { redondearCoordenada } from './core'

/**
 * Registro de eventos de búsqueda en el mapa (analítica AGREGADA ·
 * docs/GEOLOCALIZACION.md §35). Nunca guarda recorridos ni coordenadas
 * exactas: latitud/longitud se redondean (≈1km). Si falla, no rompe la
 * búsqueda (es analítica, no operación).
 */

export interface BusquedaGeoEvent {
  userId?: string | null
  contexto: 'CURRENT' | 'HOME' | 'MANUAL'
  countryId?: string | null
  cityId?: string | null
  sectorId?: string | null
  latitud?: number | null
  longitud?: number | null
  radioKm?: number | null
  filtros?: Record<string, unknown>
  resultCount?: number
}

export async function registrarBusquedaGeo(ev: BusquedaGeoEvent): Promise<void> {
  try {
    const latitud = typeof ev.latitud === 'number' ? redondearCoordenada(ev.latitud) : null
    const longitud = typeof ev.longitud === 'number' ? redondearCoordenada(ev.longitud) : null

    const row = {
      userId: ev.userId ?? null,
      contexto: ev.contexto,
      countryId: ev.countryId ?? null,
      cityId: ev.cityId ?? null,
      sectorId: ev.sectorId ?? null,
      latitud,
      longitud,
      radioKm: ev.radioKm ?? null,
      filtros: (ev.filtros ?? {}) as never,
      resultCount: ev.resultCount ?? 0,
    }

    if (ev.userId) {
      // Con dueño: `app.user_id` puesto, la fila queda bajo la RLS de la persona.
      await conUsuario(ev.userId, (tx) => tx.locationSearchEvent.create({ data: row }))
    } else {
      // Visitante sin sesión: la fila no tiene dueño (ni `userId` ni `companyId`),
      // así que no hay inquilino ni persona a la que acotarla. Es analítica
      // anónima y agregada — coordenadas ya redondeadas arriba.
      await sinEmpresa(
        'geo: evento de búsqueda anónimo (sin usuario ni empresa), coordenadas redondeadas',
        (tx) => tx.locationSearchEvent.create({ data: row })
      )
    }
  } catch (e) {
    console.error('[geo] registrarBusquedaGeo:', e)
  }
}
