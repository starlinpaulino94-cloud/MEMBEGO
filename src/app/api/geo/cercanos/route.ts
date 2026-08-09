import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { createRateLimiter, getClientIdentifier } from '@/lib/rate-limit'
import {
  ErrorContextoUbicacion,
  resolverUbicacionActiva,
} from '@/modules/geo/mapa/contexto'
import { buscarCercanos, buscarEnViewport } from '@/modules/geo/cercanos/queries'
import type {
  ContextoUbicacion,
  FiltrosCercanos,
  ResultadoCercanos,
  ViewportMapa,
} from '@/modules/geo/cercanos/tipos'
import { registrarBusquedaGeo } from '@/modules/geo/eventos/registrar'
import { conUsuario } from '@/lib/tenant'
import { verificarConsentimiento } from '@/modules/geo/consentimiento/service'
import { registrarEvento } from '@/modules/observabilidad/eventos'

export const dynamic = 'force-dynamic'

/**
 * GET /api/geo/cercanos — negocios cercanos para el mapa "Cerca de mí" (§13).
 *
 * Parámetros (query):
 *  · contexto   "CURRENT" | "HOME" | "MANUAL"  (obligatorio)
 *  · lat, lng   coordenadas (CURRENT / MANUAL por punto)
 *  · cityId, sectorId  zona del catálogo (MANUAL por zona)
 *  · radioKm    radio en km (se valida; null = por defecto del contexto)
 *  · filtros    JSON: FiltrosCercanos
 *  · viewport   JSON {west,south,east,north} → búsqueda por región visible
 *  · limit, offset  paginación (offset, no cursor: el mapa ordena por distancia)
 *
 * Autenticación opcional: con sesión se marca `esFavorita` y se registra la
 * analítica de búsqueda agregada (§35). Sin sesión el mapa sigue funcionando
 * (catálogo público). RLS: la búsqueda cruza inquilinos bajo `sinEmpresa`.
 */

const CONTEXTOS = ['CURRENT', 'HOME', 'MANUAL'] as const

// Freno por IP: el mapa es público; 60 búsquedas/minuto por visitante bastan
// (cada pan del mapa dispara una petición, así que el límite es generoso).
const cercanosLimiter = createRateLimiter({
  interval: 60 * 1000,
  maxRequests: 60,
  name: 'geo-cercanos',
})

function jsonError(status: number, codigo: string, mensaje: string) {
  return NextResponse.json({ codigo, mensaje }, { status })
}

function parseFiltros(raw: string | null): FiltrosCercanos | null {
  if (!raw) return {}
  try {
    const p = JSON.parse(raw) as Record<string, unknown>
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 20) : undefined
    return {
      tiposNegocio: strings(p.tiposNegocio),
      categorias: strings(p.categorias),
      soloConOfertas: p.soloConOfertas === true,
      soloGratis: p.soloGratis === true,
      soloMembresias: p.soloMembresias === true,
      abiertosAhora: p.abiertosAhora === true,
    }
  } catch {
    return null
  }
}

function parseViewport(raw: string | null): ViewportMapa | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as ViewportMapa
    if (
      ![v.west, v.south, v.east, v.north].every((n) => typeof n === 'number' && Number.isFinite(n)) ||
      v.west >= v.east || v.south >= v.north ||
      v.west < -180 || v.east > 180 || v.south < -90 || v.north > 90
    ) {
      return null
    }
    return v
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now()
  const ip = getClientIdentifier(req)
  if (!(await cercanosLimiter(`cercanos:${ip}`))) {
    return jsonError(429, 'limite_alcanzado', 'Demasiadas búsquedas. Espera un momento e inténtalo de nuevo.')
  }

  const sp = req.nextUrl.searchParams
  const contexto = sp.get('contexto')
  if (!contexto || !(CONTEXTOS as readonly string[]).includes(contexto)) {
    return jsonError(400, 'params_invalidos', 'Parámetro "contexto" inválido.')
  }

  const numero = (v: string | null, min: number, max: number): number | null => {
    if (v === null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) && n >= min && n <= max ? n : null
  }

  const lat = numero(sp.get('lat'), -90, 90)
  const lng = numero(sp.get('lng'), -180, 180)
  const radioKm = numero(sp.get('radioKm'), 0.1, 50)
  const cityId = sp.get('cityId') ?? null
  const sectorId = sp.get('sectorId') ?? null
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? '20') || 20, 1), 50)
  const offset = Math.max(Number(sp.get('offset') ?? '0') || 0, 0)

  if (radioKm === null && sp.get('radioKm') !== null) {
    return jsonError(400, 'params_invalidos', 'Parámetro "radioKm" inválido.')
  }

  const filtros = parseFiltros(sp.get('filtros'))
  if (filtros === null) {
    return jsonError(400, 'params_invalidos', 'Parámetro "filtros" inválido.')
  }
  const viewport = parseViewport(sp.get('viewport'))
  if (sp.get('viewport') !== null && viewport === null) {
    return jsonError(400, 'params_invalidos', 'Parámetro "viewport" inválido.')
  }

  // Sesión opcional: marca de favorita + analítica. Nunca bloquea la búsqueda.
  const sessionUser = await getUser().catch(() => null)
  const dbUserId = sessionUser?.metadata.dbUserId || null

  // Privacidad explícita (§9): con sesión, usar la ubicación ACTUAL exige
  // DEVICE_LOCATION_SESSION y usar la VIVIENDA exige FUNCTIONAL_USAGE. Sin
  // sesión (visitante anónimo) no hay dato personal que proteger y el mapa
  // sigue funcionando; la zona MANUAL nunca exige consentimiento.
  if (dbUserId) {
    const tipoNecesario =
      contexto === 'CURRENT' ? ('DEVICE_LOCATION_SESSION' as const)
      : contexto === 'HOME' ? ('FUNCTIONAL_USAGE' as const)
      : null
    if (tipoNecesario) {
      const ok = await conUsuario(dbUserId, (tx) =>
        verificarConsentimiento(tx, dbUserId, tipoNecesario)
      ).catch(() => false)
      if (!ok) {
        return jsonError(
          422,
          'consentimiento_requerido',
          'Autoriza el uso de tu ubicación para ver negocios cercanos.'
        )
      }
    }
  }

  let ubicacion
  try {
    ubicacion = await resolverUbicacionActiva({
      contexto: contexto as ContextoUbicacion,
      dbUserId,
      lat,
      lng,
      cityId,
      sectorId,
      radioKm,
    })
  } catch (e) {
    /**
     * MOVER EL MAPA NO PUEDE FALLAR.
     *
     * Una búsqueda por viewport ya dice dónde mirar: el rectángulo visible. No
     * necesita el ancla del contexto para nada —`buscarEnViewport` ni la usa—,
     * así que si el ancla no resuelve, se sigue con el centro del rectángulo.
     *
     * Sin esto, el mapa se rompía en cuanto alguien pulsaba "Mi ubicación" y
     * después arrastraba: el refresco por viewport viaja con `contexto=CURRENT`
     * y sin coordenadas, y el resolutor respondía "No recibimos una ubicación
     * válida de tu dispositivo" — un mensaje que además culpaba al GPS, que no
     * tenía nada que ver.
     *
     * Sin viewport (búsqueda por radio) el error SÍ es real: sin ancla no hay
     * centro desde el que medir, y ahí el aviso es legítimo.
     */
    if (!viewport) {
      if (e instanceof ErrorContextoUbicacion) {
        return jsonError(422, e.codigo, e.message)
      }
      return jsonError(500, 'error_interno', 'No pudimos resolver la ubicación.')
    }
    ubicacion = {
      contexto: 'MANUAL' as const,
      lat: (viewport.south + viewport.north) / 2,
      lng: (viewport.west + viewport.east) / 2,
      // Sin etiqueta a propósito: el cliente solo pisa la suya cuando llega
      // una, así que "Mi ubicación actual" sobrevive al arrastre.
      radioKm: undefined,
    }
  }

  const base = { filtros, userId: dbUserId }
  let result: ResultadoCercanos
  if (viewport) {
    // La distancia se mide desde donde está la persona (el ancla ya resuelta),
    // no desde el centro de lo que se esté mirando: es lo que hace que "a 2 km"
    // signifique algo cuando decides si vas.
    const { resultados } = await buscarEnViewport({
      ...base,
      viewport,
      ancla: { lat: ubicacion.lat, lng: ubicacion.lng },
    })
    result = { resultados, hayMas: false, total: resultados.length, ubicacion }
  } else {
    const { resultados, hayMas, total } = await buscarCercanos({
      ...base,
      lat: ubicacion.lat,
      lng: ubicacion.lng,
      radioKm: ubicacion.radioKm ?? 5,
      limit,
      offset,
    })
    result = { resultados, hayMas, total, ubicacion }
  }

  // Analítica agregada (fire-and-forget): nunca rompe la respuesta del mapa.
  void registrarBusquedaGeo({
    userId: dbUserId,
    contexto: ubicacion.contexto,
    cityId: ubicacion.cityId,
    sectorId: ubicacion.sectorId,
    latitud: ubicacion.lat,
    longitud: ubicacion.lng,
    radioKm: ubicacion.radioKm,
    filtros: filtros as unknown as Record<string, unknown>,
    resultCount: result.resultados.length,
  })

  registrarEvento({
    dominio: 'sistema',
    accion: 'geo_cercanos',
    ok: true,
    ms: Date.now() - startedAt,
    extra: { resultados: result.resultados.length, viewport: viewport !== null },
  })

  return NextResponse.json(result)
}
