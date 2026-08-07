'use server'

import { revalidatePath } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRequestMeta } from '@/lib/server-utils'
import { normalizarNombre } from '@/modules/geo/catalogo/normalizar'

/**
 * SucursalGeoActions (docs/GEOLOCALIZACION.md §8.3 y §14 Fase 1).
 *
 * El admin registra la dirección con autocomplete (GeocodingService), ajusta
 * el pin en el mapa y confirma. Solo con esa confirmación explícita se marca
 * `ubicacionVerificada` y la sucursal entra a "búsquedas cercanas". El trigger
 * PostGIS sincroniza la columna `location` solo (migración manual).
 */

export interface SucursalGeoState {
  error?: string
  success?: boolean
}

/** Sanitiza y valida un radio de servicio (1–200 km). */
function radioValido(raw: string | null): number | null {
  const n = Number(raw)
  if (!raw || Number.isNaN(n)) return null
  return Math.min(200, Math.max(1, Math.round(n)))
}

/** ADMIN · Guarda la geolocalización de una sucursal de la empresa. */
export async function guardarSucursalGeo(
  _prev: SucursalGeoState,
  formData: FormData
): Promise<SucursalGeoState> {
  try {
    const user = await requireSection('sucursales')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }

    const sucursalId = String(formData.get('sucursalId') ?? '').trim()
    if (!sucursalId) return { error: 'Sucursal requerida.' }

    const latitudRaw = String(formData.get('latitud') ?? '').trim()
    const longitudRaw = String(formData.get('longitud') ?? '').trim()
    const latitud = latitudRaw ? Number(latitudRaw) : null
    const longitud = longitudRaw ? Number(longitudRaw) : null
    if (latitud !== null && (Number.isNaN(latitud) || latitud < -90 || latitud > 90)) {
      return { error: 'Coordenada de latitud inválida.' }
    }
    if (longitud !== null && (Number.isNaN(longitud) || longitud < -180 || longitud > 180)) {
      return { error: 'Coordenada de longitud inválida.' }
    }
    if (latitud !== null && longitud === null) {
      return { error: 'Falta la longitud.' }
    }

    // El `countryId` se normaliza en minúsculas como en `users.supabaseId` no:
    // aquí es la PK cuid de Country; la validación de consistencia con la
    // ciudad la hace la FK de la BD.
    const countryId = String(formData.get('countryId') ?? '').trim() || null
    const regionId = String(formData.get('regionId') ?? '').trim() || null
    const cityId = String(formData.get('cityId') ?? '').trim() || null
    const sectorId = String(formData.get('sectorId') ?? '').trim() || null
    const ciudadTexto = String(formData.get('ciudadTexto') ?? '').trim().slice(0, 120) || null
    const sectorTexto = String(formData.get('sectorTexto') ?? '').trim().slice(0, 120) || null
    const direccion = String(formData.get('direccion') ?? '').trim().slice(0, 300) || null
    const radioServicioKm = radioValido(String(formData.get('radioServicioKm') ?? '')) ?? null

    // Si el form no mandó ids del catálogo pero sí textos, se intenta resolver
    // por nombre normalizado (fallback idempotente para empresas que geocodificaron
    // antes de existir el catálogo o que escribieron manual).
    const idsResueltos = await resolverCatalogosPorTexto({
      countryId, regionId, cityId, sectorId,
      ciudadTexto, sectorTexto,
    })

    const { ipAddress, userAgent } = await getRequestMeta()

    const resultado = await conEmpresa(companyId, async (tx) => {
      const sucursal = await tx.sucursal.findFirst({
        where: { id: sucursalId, companyId },
        select: { id: true, nombre: true },
      })
      if (!sucursal) return null

      const data: import('@prisma/client').Prisma.SucursalUncheckedUpdateInput = {
        direccion: direccion ?? undefined,
        countryId: idsResueltos.countryId,
        regionId: idsResueltos.regionId,
        cityId: idsResueltos.cityId,
        sectorId: idsResueltos.sectorId,
        ciudadTexto: idsResueltos.ciudadTexto ?? ciudadTexto,
        sectorTexto: idsResueltos.sectorTexto ?? sectorTexto,
        latitud,
        longitud,
        radioServicioKm,
        // La coordenada se guarda; la VERIFICACIÓN visual es un paso aparte.
        ubicacionActualizadaAt: new Date(),
      }

      const guardada = await tx.sucursal.update({
        where: { id: sucursal.id },
        data,
        select: { id: true },
      })

      await tx.auditLog.create({
        data: {
          companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'SUCURSAL_UBICACION_GUARDADA',
          entidadTipo: 'Sucursal',
          entidadId: sucursal.id,
          payload: {
            nombre: sucursal.nombre,
            latitud: latitud ?? null,
            longitud: longitud ?? null,
            ciudadTexto: ciudadTexto ?? null,
          },
          ipAddress,
          userAgent,
        },
      })
      return guardada
    })

    if (!resultado) return { error: 'Sucursal no encontrada en esta empresa.' }
    revalidatePath(`/admin/sucursales/${sucursalId}`)
    revalidatePath('/admin/sucursales')
    return { success: true }
  } catch {
    return { error: 'No se pudo guardar la ubicación. Intenta de nuevo.' }
  }
}

/** ADMIN · Marca las coordenadas como verificadas visualmente (§8). */
export async function verificarCoordenadasSucursal(
  _prev: SucursalGeoState,
  formData: FormData
): Promise<SucursalGeoState> {
  try {
    const user = await requireSection('sucursales')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }

    const sucursalId = String(formData.get('sucursalId') ?? '').trim()
    const { ipAddress, userAgent } = await getRequestMeta()

    const resultado = await conEmpresa(companyId, async (tx) => {
      const sucursal = await tx.sucursal.findFirst({
        where: { id: sucursalId, companyId },
        select: { id: true, latitud: true, longitud: true, nombre: true },
      })
      if (!sucursal) return null
      if (sucursal.latitud === null || sucursal.longitud === null) return false

      await tx.sucursal.update({
        where: { id: sucursal.id },
        data: { ubicacionVerificada: true, ubicacionActualizadaAt: new Date() },
      })
      await tx.auditLog.create({
        data: {
          companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'SUCURSAL_UBICACION_VERIFICADA',
          entidadTipo: 'Sucursal',
          entidadId: sucursal.id,
          payload: { nombre: sucursal.nombre },
          ipAddress,
          userAgent,
        },
      })
      return true
    })

    if (resultado === null) return { error: 'Sucursal no encontrada en esta empresa.' }
    if (resultado === false) {
      return { error: 'La sucursal aún no tiene coordenadas para verificar.' }
    }
    revalidatePath(`/admin/sucursales/${sucursalId}`)
    return { success: true }
  } catch {
    return { error: 'No se pudo verificar. Intenta de nuevo.' }
  }
}

/** ADMIN · Enciende/apaga la visibilidad de la sucursal en el mapa. */
export async function toggleMostrarEnMapa(
  _prev: SucursalGeoState,
  formData: FormData
): Promise<SucursalGeoState> {
  try {
    const user = await requireSection('sucursales')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }

    const sucursalId = String(formData.get('sucursalId') ?? '').trim()
    const mostrar = formData.getAll('mostrarEnMapa').at(-1) === 'on'

    const resultado = await conEmpresa(companyId, async (tx) => {
      const sucursal = await tx.sucursal.findFirst({
        where: { id: sucursalId, companyId },
        select: { id: true },
      })
      if (!sucursal) return null
      await tx.sucursal.update({
        where: { id: sucursal.id },
        data: { mostrarEnMapa: mostrar },
      })
      return true
    })
    if (!resultado) return { error: 'Sucursal no encontrada en esta empresa.' }
    revalidatePath(`/admin/sucursales/${sucursalId}`)
    return { success: true }
  } catch {
    return { error: 'No se pudo actualizar. Intenta de nuevo.' }
  }
}

/**
 * Resuelve las claves del catálogo a partir de ids o textos. Si llegan ids,
 * se usan tal cual (la FK valida). Si llega texto ("escribir otra"):
 *
 *  - Ciudad: se busca por `normalizedName`; si no existe se DEJA como texto
 *    bruto (`ciudadTexto`) — crear una ciudad requiere su provincia (FK), así
 *    que el alta formal la hace el superadmin al aprobar el catálogo.
 *  - Sector: si la ciudad se resolvió y el sector no existe, se crea con
 *    `isVerified: false` para revisión del superadmin (regla §30).
 */
async function resolverCatalogosPorTexto(input: {
  countryId: string | null
  regionId: string | null
  cityId: string | null
  sectorId: string | null
  ciudadTexto: string | null
  sectorTexto: string | null
}) {
  const resultado: {
    countryId: string | null
    regionId: string | null
    cityId: string | null
    sectorId: string | null
    ciudadTexto: string | null
    sectorTexto: string | null
  } = {
    countryId: input.countryId,
    regionId: input.regionId,
    cityId: input.cityId,
    sectorId: input.sectorId,
    ciudadTexto: null,
    sectorTexto: null,
  }

  const { prisma } = await import('@/lib/prisma')

  // Sin país no hay a dónde resolver; los textos quedan como respaldo.
  if (!resultado.countryId) return resultado

  // Ciudad por texto → buscar; si no existe, respaldo de texto.
  if (!resultado.cityId && input.ciudadTexto) {
    const norm = normalizarNombre(input.ciudadTexto)
    const existente = await prisma.city.findFirst({ where: { normalizedName: norm } })
    resultado.cityId = existente?.id ?? null
    if (!resultado.cityId) {
      resultado.ciudadTexto = input.ciudadTexto
      resultado.sectorTexto = input.sectorTexto ?? null
      return resultado
    }
    resultado.ciudadTexto = input.ciudadTexto
  }

  // Sector por texto → buscar o crear (verificado=false) bajo la ciudad.
  if (resultado.cityId && !resultado.sectorId && input.sectorTexto) {
    const norm = normalizarNombre(input.sectorTexto)
    const existente = await prisma.sector.findFirst({
      where: { cityId: resultado.cityId, normalizedName: norm },
    })
    if (existente) {
      resultado.sectorId = existente.id
    } else {
      const nueva = await prisma.sector.create({
        data: {
          cityId: resultado.cityId,
          name: input.sectorTexto,
          normalizedName: norm,
          isVerified: false,
        },
      })
      resultado.sectorId = nueva.id
    }
    resultado.sectorTexto = input.sectorTexto
  }

  return resultado
}
