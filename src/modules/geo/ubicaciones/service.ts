import 'server-only'
import { conUsuario } from '@/lib/tenant'
import {
  CustomerLocationSource,
  CustomerLocationType,
  LocationVerificationStatus,
  type Prisma,
} from '@prisma/client'
import { verificarConsentimiento } from '@/modules/geo/consentimiento/service'

export interface UbicacionInput {
  label?: string | null
  type?: CustomerLocationType
  countryId?: string | null
  regionId?: string | null
  cityId?: string | null
  sectorId?: string | null
  regionNameRaw?: string | null
  cityNameRaw?: string | null
  sectorNameRaw?: string | null
  formattedAddress?: string | null
  latitud?: number | null
  longitud?: number | null
  isPrimary?: boolean
  source?: CustomerLocationSource
  consentForPersonalization?: boolean
}

export class LocationServiceError extends Error {}

/**
 * LocationService (G-1 · docs/GEOLOCALIZACION.md §7.2).
 *
 * CRUD de `CustomerLocation`. La ubicación es de la PERSONA (cross-empresa):
 * todas las consultas corren dentro de `conUsuario` (RLS de dueño) y NUNCA
 * pasan por un contexto de empresa. Las empresas jamás leen esta tabla.
 *
 * Reglas:
 *  - Una sola primaria por usuario (se desmarcan las demás en la misma tx).
 *  - Guardar una ubicación exige consentimiento HOME_STORAGE activo.
 *  - Solo ciudad/sector → UNVERIFIED y sin coordenadas de precisión.
 */
export const LocationService = {
  /** Guarda una ubicación nueva (la primera suele ser la primaria). */
  async guardar(userId: string, input: UbicacionInput): Promise<string> {
    return conUsuario(userId, async (tx) => {
      await exigirConsentimientoHome(tx, userId)

      const data = normalizarInput(input)
      if (data.esPrimaria) {
        await tx.customerLocation.updateMany({
          where: { userId, isPrimary: true },
          data: { isPrimary: false },
        })
      }
      const row = await tx.customerLocation.create({
        data: {
          userId,
          ...data.campos,
          source: data.campos.source ?? CustomerLocationSource.MANUAL,
        },
      })
      return row.id
    })
  },

  /** Actualiza una ubicación propia (verifica propiedad). */
  async actualizar(userId: string, locationId: string, input: UbicacionInput): Promise<void> {
    await conUsuario(userId, async (tx) => {
      const existente = await tx.customerLocation.findFirst({ where: { id: locationId, userId } })
      if (!existente) throw new LocationServiceError('Ubicación no encontrada.')

      const data = normalizarInput(input)
      if (data.esPrimaria) {
        await tx.customerLocation.updateMany({
          where: { userId, isPrimary: true, id: { not: locationId } },
          data: { isPrimary: false },
        })
      }
      await tx.customerLocation.update({ where: { id: locationId }, data: data.campos })
    })
  },

  /** Elimina una ubicación propia. */
  async eliminar(userId: string, locationId: string): Promise<void> {
    await conUsuario(userId, async (tx) => {
      const existente = await tx.customerLocation.findFirst({ where: { id: locationId, userId } })
      if (!existente) throw new LocationServiceError('Ubicación no encontrada.')
      await tx.customerLocation.delete({ where: { id: locationId } })
    })
  },

  /** Marca una ubicación como primaria (desmarca las demás). */
  async cambiarPrimaria(userId: string, locationId: string): Promise<void> {
    await conUsuario(userId, async (tx) => {
      const existente = await tx.customerLocation.findFirst({ where: { id: locationId, userId } })
      if (!existente) throw new LocationServiceError('Ubicación no encontrada.')
      await tx.customerLocation.updateMany({
        where: { userId, isPrimary: true, id: { not: locationId } },
        data: { isPrimary: false },
      })
      await tx.customerLocation.update({ where: { id: locationId }, data: { isPrimary: true } })
    })
  },

  /** Ubicaciones de la persona con los nombres del catálogo. */
  async listar(userId: string) {
    return conUsuario(userId, (tx) =>
      tx.customerLocation.findMany({
        where: { userId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
        include: {
          country: { select: { id: true, isoCode: true, name: true, regionLabel: true } },
          region: { select: { id: true, name: true } },
          city: { select: { id: true, name: true } },
          sector: { select: { id: true, name: true, latitud: true, longitud: true } },
        },
      })
    )
  },

  /** Ubicación primaria (o null). Usa `sinEmpresa` de respaldo en el registro. */
  async primaria(userId: string) {
    return conUsuario(userId, (tx) =>
      tx.customerLocation.findFirst({
        where: { userId, isPrimary: true },
        include: {
          country: { select: { id: true, isoCode: true, name: true, regionLabel: true } },
          region: { select: { id: true, name: true } },
          city: { select: { id: true, name: true } },
          sector: { select: { id: true, name: true, latitud: true, longitud: true } },
        },
      })
    )
  },
}

async function exigirConsentimientoHome(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<void> {
  const ok = await verificarConsentimiento(tx, userId, 'HOME_STORAGE')
  if (!ok) {
    throw new LocationServiceError(
      'Para guardar tu ubicación necesitamos tu autorización. Actívala en Privacidad y ubicación.'
    )
  }
}

function normalizarInput(input: UbicacionInput) {
  const tieneCoordenadas = typeof input.latitud === 'number' && typeof input.longitud === 'number'
  // Fuente: quien confirma un pin o una dirección geocodificada declara
  // coordenadas APROXIMADAS verificadas visualmente.
  const confirmado =
    input.source === CustomerLocationSource.MAP_SELECTION ||
    input.source === CustomerLocationSource.GEOCODED_ADDRESS ||
    input.source === CustomerLocationSource.DEVICE_LOCATION

  return {
    esPrimaria: input.isPrimary === true,
    campos: {
      label: input.label ?? null,
      type: input.type ?? CustomerLocationType.HOME,
      countryId: input.countryId ?? null,
      regionId: input.regionId ?? null,
      cityId: input.cityId ?? null,
      sectorId: input.sectorId ?? null,
      regionNameRaw: input.regionNameRaw ?? null,
      cityNameRaw: input.cityNameRaw ?? null,
      sectorNameRaw: input.sectorNameRaw ?? null,
      formattedAddress: input.formattedAddress ?? null,
      latitud: input.latitud ?? null,
      longitud: input.longitud ?? null,
      source: input.source ?? CustomerLocationSource.MANUAL,
      verificationStatus: confirmado && tieneCoordenadas
        ? LocationVerificationStatus.CONFIRMED
        : LocationVerificationStatus.UNVERIFIED,
      consentForPersonalization: input.consentForPersonalization ?? false,
    } satisfies Prisma.CustomerLocationUncheckedUpdateInput,
  }
}
