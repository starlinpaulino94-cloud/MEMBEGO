import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sinEmpresa } from '@/lib/tenant'
import { estaAbierto, textoHorarioHoy, type HorarioDetallado } from './horario'
import type {
  FiltrosCercanos,
  SucursalCercana,
  ViewportMapa,
} from './tipos'

// ────────────────────────────────────────────────────────────────────────────
// BÚSQUEDA GEOESPACIAL · "Cerca de mí" (docs/GEOLOCALIZACION.md §13, §16)
//
// DOS MOTORES, UNA CONTRATA:
//  · POSTGIS (G-4): columna `sucursales.location` (geography) sincronizada por
//    trigger (2026-08-postgis.sql). `ST_DWithin`/`ST_Intersects` sobre el
//    índice GiST. Exacto en metros sobre el elipsoide.
//  · FALLBACK HAVERSINE: si PostGIS no está instalado o falta la columna, la
//    distancia se calcula en SQL con la fórmula de Haversine sobre un
//    prefiltro de bounding box. Resultado equivalente (en línea recta), mismo
//    shape de respuesta. Nunca rompe la lista.
//
// La búsqueda cruza inquilinos POR DISEÑO (el mapa es público, como el
// marketplace), así que se ejecuta bajo `sinEmpresa`. RLS con
// `app.omnisciente` ve todas las sucursales publicadas.
// ────────────────────────────────────────────────────────────────────────────

export interface FilaSucursalCercana {
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
  cantidadOfertas: number
  ofertaTitulo: string | null
  promedioRating: number | null
  esFavorita: boolean
  horarioDetallado: string | null
  categorias: string[]
}

export interface BaseBusqueda {
  filtros?: FiltrosCercanos
  userId?: string | null
  ahora?: Date
}

/** Etiqueta para las consultas `sinEmpresa` (auditoría de aislamiento). */
const MOTIVO = 'mapa cerca-de-mi: catálogo público de sucursales publicado'

// PostGIS no cambia en caliente: se detecta una vez por proceso.
let postgisDisponible: Promise<boolean> | null = null

function detectarPostGIS(): Promise<boolean> {
  postgisDisponible ??= (async () => {
    try {
      const res = await prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT (
          EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis')
          AND EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'sucursales' AND column_name = 'location')
        ) AS ok
      `
      return Boolean(res[0]?.ok)
    } catch {
      return false
    }
  })()
  return postgisDisponible
}

/** Promoción vigente, pública y activa — la "oferta" de la tarjeta del mapa. */
function condicionPromo(alias: Prisma.Sql, ahora: Date, gratis: boolean): Prisma.Sql {
  return Prisma.sql`
    ${alias}."companyId" = c.id
      AND ${alias}.activo AND NOT ${alias}.archivada
      AND ${alias}."visibilidad" = 'publica'
      AND ${alias}."vigenciaDesde" <= ${ahora}
      AND (${alias}."vigenciaHasta" IS NULL OR ${alias}."vigenciaHasta" >= ${ahora})
      ${gratis ? Prisma.sql`AND (NOT ${alias}."esComprable" OR ${alias}.precio = 0)` : Prisma.empty}`
}

/** Condiciones compartidas de negocio (sin parte geográfica). */
function condicionesFiltros(f: FiltrosCercanos, ahora: Date): Prisma.Sql[] {
  const conds: Prisma.Sql[] = [
    Prisma.sql`s.activa = true`,
    Prisma.sql`s."mostrarEnMapa" = true`,
    Prisma.sql`s.latitud IS NOT NULL AND s.longitud IS NOT NULL`,
    Prisma.sql`c."isActive" = true`,
    Prisma.sql`c."isPublished" = true`,
    Prisma.sql`c."esDemo" = false`,
  ]

  if (f.tiposNegocio?.length) {
    conds.push(Prisma.sql`c.type IN (${Prisma.join(f.tiposNegocio)})`)
  }
  if (f.categorias?.length) {
    conds.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "company_to_categories" ctc
      WHERE ctc."companyId" = c.id AND ctc."categoryId" IN (${Prisma.join(f.categorias)})
    )`)
  }
  if (f.soloMembresias) {
    conds.push(Prisma.sql`EXISTS (SELECT 1 FROM "plans" pl WHERE pl."companyId" = c.id AND pl.activo)`)
  }
  return conds
}

/** Expresión SQL de la distancia en metros desde (lat, lng), según el motor. */
function distanciaDesde(postgis: boolean, lat: Prisma.Sql, lng: Prisma.Sql, alias: Prisma.Sql): Prisma.Sql {
  if (postgis) {
    return Prisma.sql`ST_Distance(${alias}.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography)::int`
  }
  return Prisma.sql`(6371008.8 * acos(least(1.0,
    cos(radians(${lat})) * cos(radians(${alias}.latitud)) *
    cos(radians(${alias}.longitud) - radians(${lng})) +
    sin(radians(${lat})) * sin(radians(${alias}.latitud))
  )))::int`
}

const COLUMNAS_BASE = Prisma.sql`
  s.id, s.nombre, s."companyId" AS "empresaId",
  c.name AS "empresaNombre", c.slug AS "empresaSlug", c."logoUrl",
  c.type AS tipo, s.direccion, s.telefono, s.latitud, s.longitud,
  s."ciudadTexto" AS ciudad, s."sectorTexto" AS sector,
  COALESCE(of.cnt, 0)::int AS "cantidadOfertas", of.titulo AS "ofertaTitulo",
  c."averageRating"::float8 AS "promedioRating",
  s."horarioDetallado"::text AS "horarioDetallado",
  COALESCE(cat.nombres, ARRAY[]::text[]) AS categorias
`

/** JOINs compartidos: empresa, lateral de ofertas y categorías, favorita. */
function joinsSucursales(f: FiltrosCercanos, ahora: Date, userId: string | null): Prisma.Sql {
  const promo = condicionPromo(Prisma.sql`p`, ahora, f.soloGratis ?? false)
  const promo2 = condicionPromo(Prisma.sql`p2`, ahora, f.soloGratis ?? false)
  const fav = userId
    ? Prisma.sql`LEFT JOIN "company_follows" cf ON cf."companyId" = c.id AND cf."userId" = ${userId}`
    : Prisma.empty
  return Prisma.sql`
    FROM "sucursales" s
    JOIN "companies" c ON c.id = s."companyId"
    LEFT JOIN LATERAL (
      SELECT (SELECT count(*)::int FROM "promociones" p WHERE ${promo}) AS cnt,
             (SELECT p2.titulo FROM "promociones" p2
              WHERE ${promo2}
              ORDER BY p2.prioridad DESC, p2."isFeatured" DESC, p2."publicadaEn" DESC
              LIMIT 1) AS titulo
    ) of ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(bc.name ORDER BY bc.name) AS nombres
      FROM "company_to_categories" ctc
      JOIN "business_categories" bc ON bc.id = ctc."categoryId"
      WHERE ctc."companyId" = c.id AND bc.active
    ) cat ON true
    ${fav}
  `
}

function columnaFavorita(userId: string | null): Prisma.Sql {
  return userId ? Prisma.sql`(cf.id IS NOT NULL) AS "esFavorita"` : Prisma.sql`false AS "esFavorita"`
}

/**
 * Búsqueda por radio alrededor de un punto (contexto CURRENT/HOME/MANUAL).
 * Ordena por distancia. `hayMas` marca si existe la siguiente página.
 */
export async function buscarCercanosRaw(
  params: BaseBusqueda & { lat: number; lng: number; radioKm: number; limit: number; offset?: number },
  postgis = false
): Promise<{ filas: FilaSucursalCercana[]; hayMas: boolean }> {
  const { lat, lng, radioKm, limit, offset = 0, filtros = {}, userId = null, ahora = new Date() } = params
  // "Abierto ahora" se filtra en el mapeo (zona horaria local): se piden más
  // filas de las necesarias para no devolver páginas medio vacías.
  const internoLimit = Math.min((filtros.abiertosAhora ?? false) ? limit * 4 : limit + 1, 300)

  const filas = await sinEmpresa(MOTIVO, (tx) => {
    return tx.$queryRaw<FilaSucursalCercana[]>`
      SELECT
        ${COLUMNAS_BASE},
        ${distanciaDesde(postgis, Prisma.sql`${lat}`, Prisma.sql`${lng}`, Prisma.sql`s`)} AS "distanciaM",
        ${columnaFavorita(userId)}
      ${joinsSucursales(filtros, ahora, userId)}
      WHERE ${Prisma.join(condicionesFiltros(filtros, ahora), ' AND ')}
      AND ${postgis
        ? Prisma.sql`s.location IS NOT NULL AND ST_DWithin(
            s.location,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
            ${radioKm * 1000}
          )`
        : Prisma.sql`(${distanciaDesde(false, Prisma.sql`${lat}`, Prisma.sql`${lng}`, Prisma.sql`s`)}) <= ${radioKm * 1000}`}
      ORDER BY "distanciaM" ASC NULLS LAST
      LIMIT ${internoLimit} OFFSET ${offset}
    `
  })

  return { filas, hayMas: filas.length > limit }
}

/**
 * Búsqueda por viewport del mapa (pan/zoom, §13). Devuelve las sucursales
 * visibles; la distancia se mide desde el centro del rectángulo.
 */
export async function buscarEnViewportRaw(
  params: BaseBusqueda & { viewport: ViewportMapa; limit?: number },
  postgis = false
): Promise<FilaSucursalCercana[]> {
  const { viewport, limit = 100, filtros = {}, userId = null, ahora = new Date() } = params
  const { west, south, east, north } = viewport
  const latCentro = (south + north) / 2
  const lngCentro = (west + east) / 2

  return sinEmpresa(MOTIVO, (tx) => {
    return tx.$queryRaw<FilaSucursalCercana[]>`
      SELECT
        ${COLUMNAS_BASE},
        ${distanciaDesde(postgis, Prisma.sql`${latCentro}`, Prisma.sql`${lngCentro}`, Prisma.sql`s`)} AS "distanciaM",
        ${columnaFavorita(userId)}
      ${joinsSucursales(filtros, ahora, userId)}
      WHERE ${Prisma.join(condicionesFiltros(filtros, ahora), ' AND ')}
      AND ${postgis
        ? Prisma.sql`ST_Intersects(s.location::geometry, ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326))`
        : Prisma.sql`(s.latitud BETWEEN ${south} AND ${north} AND s.longitud BETWEEN ${west} AND ${east})`}
      ORDER BY "distanciaM" ASC NULLS LAST
      LIMIT ${limit}
    `
  })
}

// ────────────────────────────────────────────────────────────────────────────
// ORQUESTADOR · mapeo de filas → tarjetas + filtro de horario (§13)
// ────────────────────────────────────────────────────────────────────────────

function filaADto(f: FilaSucursalCercana): SucursalCercana {
  let horario: HorarioDetallado | null = null
  if (f.horarioDetallado) {
    try {
      horario = JSON.parse(f.horarioDetallado) as HorarioDetallado
    } catch {
      horario = null
    }
  }
  return {
    id: f.id,
    nombre: f.nombre,
    empresaId: f.empresaId,
    empresaNombre: f.empresaNombre,
    empresaSlug: f.empresaSlug,
    logoUrl: f.logoUrl,
    tipo: f.tipo,
    direccion: f.direccion,
    telefono: f.telefono,
    latitud: f.latitud,
    longitud: f.longitud,
    ciudad: f.ciudad,
    sector: f.sector,
    distanciaM: f.distanciaM,
    tieneOfertas: f.cantidadOfertas > 0,
    ofertaDestacada: f.ofertaTitulo,
    cantidadOfertas: f.cantidadOfertas,
    abierto: estaAbierto(horario),
    horarioTexto: textoHorarioHoy(horario),
    categorias: Array.isArray(f.categorias) ? f.categorias : [],
    promedioRating: f.promedioRating,
    esFavorita: f.esFavorita,
    urlDetalle: `/cliente/empresas/${f.empresaSlug}?sucursal=${f.id}&origen=cerca`,
  }
}

/**
 * Punto de entrada del módulo: busca, ordena, filtra "abierto ahora" y devuelve
 * las tarjetas listas para la UI. `hayMas` marca si existe la siguiente página.
 */
export async function buscarCercanos(
  params: BaseBusqueda & { lat: number; lng: number; radioKm: number; limit?: number; offset?: number }
): Promise<{ resultados: SucursalCercana[]; hayMas: boolean; total: number }> {
  const { limit = 20, offset = 0, filtros = {} } = params
  const postgis = await detectarPostGIS()
  const { filas, hayMas } = await buscarCercanosRaw({ ...params, limit, offset }, postgis)

  const dto = filas.map(filaADto)
  const resultados = filtros.abiertosAhora ? dto.filter((r) => r.abierto === true) : dto
  return { resultados: resultados.slice(0, limit), hayMas, total: resultados.length }
}

/** Punto de entrada para la vista de mapa (toda la región visible). */
export async function buscarEnViewport(
  params: BaseBusqueda & { viewport: ViewportMapa; limit?: number }
): Promise<{ resultados: SucursalCercana[] }> {
  const postgis = await detectarPostGIS()
  const filas = await buscarEnViewportRaw(params, postgis)
  return { resultados: filas.map(filaADto) }
}
