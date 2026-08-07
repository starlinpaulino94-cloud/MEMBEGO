import 'server-only'
import { prisma } from '@/lib/prisma'
import { conUsuario } from '@/lib/tenant'
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
      await conUsuario(ev.userId, (tx) => tx.locationSearchEvent.create({ data: row }))
    } else {
      await prisma.locationSearchEvent.create({ data: row })
    }
  } catch (e) {
    console.error('[geo] registrarBusquedaGeo:', e)
  }
}
