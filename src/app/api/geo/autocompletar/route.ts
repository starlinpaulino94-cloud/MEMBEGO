import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createRateLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { normalizarNombre } from '@/modules/geo/catalogo/normalizar'
import { GeocodingService } from '@/modules/geo/geocodificacion/service'
import type { SugerenciaUbicacion } from '@/modules/geo/cercanos/tipos'
import { registrarEvento } from '@/modules/observabilidad/eventos'

export const dynamic = 'force-dynamic'

/**
 * GET /api/geo/autocompletar — búsqueda de zonas y direcciones (§13).
 *
 * Parámetros:
 *  · q       término (2–100 caracteres)
 *  · cityId  opcional: acotar sectores a una ciudad
 *
 * Devuelve `SugerenciaUbicacion[]` en tres grupos ordenados por relevancia:
 *  · ciudades  del catálogo (sin coordenadas → el resolver elige un sector)
 *  · sectores  del catálogo (con su punto de referencia)
 *  · direcciones  geocodificadas por el proveedor (Geoapify/Nominatim). Si el
 *    proveedor externo falla (sin clave, sin red), se devuelven las del
 *    catálogo: la búsqueda por zona nunca depende del externo.
 */

const autocompleteLimiter = createRateLimiter({
  interval: 60 * 1000,
  maxRequests: 30,
  name: 'geo-autocompletar',
})

function jsonError(status: number, codigo: string, mensaje: string) {
  return NextResponse.json({ codigo, mensaje }, { status })
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now()
  const ip = getClientIdentifier(req)
  if (!(await autocompleteLimiter(`autocompletar:${ip}`))) {
    return jsonError(429, 'limite_alcanzado', 'Demasiadas búsquedas. Espera un momento.')
  }

  const sp = req.nextUrl.searchParams
  const qRaw = sp.get('q')?.trim() ?? ''
  if (qRaw.length < 2 || qRaw.length > 100) {
    return jsonError(400, 'params_invalidos', 'Escribe al menos 2 caracteres.')
  }
  const cityId = sp.get('cityId') || null
  const termino = normalizarNombre(qRaw)

  const sugerencias: SugerenciaUbicacion[] = []

  // 1) Ciudades del catálogo.
  const ciudades = await prisma.city.findMany({
    where: { isOperative: true, normalizedName: { contains: termino } },
    orderBy: { normalizedName: 'asc' },
    take: 4,
    select: { id: true, name: true },
  })
  for (const c of ciudades) {
    sugerencias.push({
      id: `ciudad:${c.id}`,
      tipo: 'ciudad',
      etiqueta: c.name,
      contexto: 'MANUAL',
      lat: null,
      lng: null,
      cityId: c.id,
    })
  }

  // 2) Sectores del catálogo (con punto de referencia para centrar el mapa).
  const sectores = await prisma.sector.findMany({
    where: {
      isOperative: true,
      ...(cityId ? { cityId } : {}),
      normalizedName: { contains: termino },
    },
    orderBy: [{ isVerified: 'desc' }, { name: 'asc' }],
    take: 6,
    select: {
      id: true,
      name: true,
      latitud: true,
      longitud: true,
      city: { select: { id: true, name: true } },
    },
  })
  for (const s of sectores) {
    sugerencias.push({
      id: `sector:${s.id}`,
      tipo: 'sector',
      etiqueta: [s.name, s.city.name].filter(Boolean).join(', '),
      contexto: 'MANUAL',
      lat: s.latitud,
      lng: s.longitud,
      cityId: s.city.id,
      sectorId: s.id,
    })
  }

  // 3) Direcciones del proveedor de geocodificación (mejora no bloqueante).
  try {
    const direcciones = await GeocodingService.autocomplete(qRaw, { limit: 5 })
    for (const d of direcciones) {
      if (typeof d.lat !== 'number' || typeof d.lng !== 'number') continue
      sugerencias.push({
        id: `dir:${d.placeId ?? `${d.lat},${d.lng}`}`,
        tipo: 'direccion',
        etiqueta: d.formattedAddress,
        contexto: 'MANUAL',
        lat: d.lat,
        lng: d.lng,
      })
    }
  } catch {
    // Sin proveedor disponible: solo catálogo. No es un error de petición.
  }

  registrarEvento({
    dominio: 'sistema',
    accion: 'geo_autocompletar',
    ok: true,
    ms: Date.now() - startedAt,
    extra: { sugerencias: sugerencias.length, proveedor: 'catalogo_y_geocodificador' },
  })

  return NextResponse.json({ sugerencias })
}
