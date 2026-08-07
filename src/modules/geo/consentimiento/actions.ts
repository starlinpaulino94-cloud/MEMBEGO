'use server'

import { requireUser } from '@/lib/auth/guards'
import { LocationConsentService, type GeoConsentTipoValue } from './service'

/**
 * Aceptación de consentimientos de ubicación desde el mapa (canal "mapa").
 *
 * La privacidad es explícita (docs/GEOLOCALIZACION.md §9): el cliente ACEPTA
 * antes de que el mapa use su ubicación, y los tipos nunca se mezclan —
 * · FUNCTIONAL_USAGE         → usar vivienda/ubicación guardada para "cerca".
 * · DEVICE_LOCATION_SESSION  → usar el GPS puntual SOLO para la búsqueda actual.
 *
 * Solo se aceptan esos dos aquí; HOME_STORAGE y MARKETING_GEO tienen sus
 * propios flujos (onboarding / campañas) y no se tocan desde el mapa.
 */
const ACEPTABLES: GeoConsentTipoValue[] = ['FUNCTIONAL_USAGE', 'DEVICE_LOCATION_SESSION']

export interface ConsentGeoResult {
  ok: boolean
  error?: string
}

export async function aceptarConsentimientoGeo(
  tipo: GeoConsentTipoValue
): Promise<ConsentGeoResult> {
  if (!ACEPTABLES.includes(tipo)) {
    return { ok: false, error: 'Tipo de consentimiento no permitido.' }
  }
  const user = await requireUser()
  try {
    await LocationConsentService.otorgar(user.metadata.dbUserId, tipo, { canal: 'mapa' })
    return { ok: true }
  } catch {
    return { ok: false, error: 'No pudimos guardar tu autorización. Intenta de nuevo.' }
  }
}
