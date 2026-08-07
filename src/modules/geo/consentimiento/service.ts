import 'server-only'
import { conUsuario } from '@/lib/tenant'
import { GeoConsentEstado, GeoConsentTipo, type Prisma } from '@prisma/client'

/**
 * LocationConsentService (docs/GEOLOCALIZACION.md §7.2 y §9).
 *
 * Rastro auditable de cada autorización/revocación de ubicación. Separación
 * estricta: aceptar marketing general (`User.marketingConsent`) o usar el mapa
 * (`FUNCTIONAL_USAGE`) NUNCA implica `MARKETING_GEO` ni `HOME_STORAGE`.
 *
 * Un registro por tipo por usuario; revocar = marcar REVOKED con `revokedAt`
 * (nunca se borra, la auditoría lo exige).
 */

export const GEO_CONSENT_VERSION = '1.0'

export type GeoConsentTipoValue =
  | 'FUNCTIONAL_USAGE'
  | 'HOME_STORAGE'
  | 'MARKETING_GEO'
  | 'DEVICE_LOCATION_SESSION'

export const TIPOS_GEO: GeoConsentTipoValue[] = [
  'FUNCTIONAL_USAGE',
  'HOME_STORAGE',
  'MARKETING_GEO',
  'DEVICE_LOCATION_SESSION',
]

export interface OtorgarOpts {
  canal: string // "onboarding" | "perfil" | "mapa" | "campana"
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * Verifica si la persona tiene ACTIVE el consentimiento `tipo`. Acepta un tx
 * para usarse DENTRO de la transacción de quien la llama (p. ej. guardar la
 * vivienda durante el registro), o sin él para consultas sueltas.
 */
export async function verificarConsentimiento(
  tx: Prisma.TransactionClient,
  userId: string,
  tipo: GeoConsentTipoValue
): Promise<boolean> {
  const row = await tx.geoConsent.findUnique({
    where: { userId_tipo: { userId, tipo: tipo as GeoConsentTipo } },
    select: { estado: true },
  })
  return row?.estado === GeoConsentEstado.ACTIVE
}

export const LocationConsentService = {
  /** Registra (o reactiva) un consentimiento ACTIVE. Idempotente por tipo. */
  async otorgar(userId: string, tipo: GeoConsentTipoValue, opts: OtorgarOpts): Promise<void> {
    await conUsuario(userId, async (tx) => {
      await tx.geoConsent.upsert({
        where: { userId_tipo: { userId, tipo: tipo as GeoConsentTipo } },
        update: {
          estado: GeoConsentEstado.ACTIVE,
          version: GEO_CONSENT_VERSION,
          canal: opts.canal,
          grantedAt: new Date(),
          revokedAt: null,
          ipAddress: opts.ipAddress ?? null,
          userAgent: opts.userAgent ?? null,
        },
        create: {
          userId,
          tipo: tipo as GeoConsentTipo,
          estado: GeoConsentEstado.ACTIVE,
          version: GEO_CONSENT_VERSION,
          canal: opts.canal,
          ipAddress: opts.ipAddress ?? null,
          userAgent: opts.userAgent ?? null,
        },
      })
    })
  },

  /** Revoca un consentimiento (marca REVOKED + revokedAt; no borra). */
  async revocar(userId: string, tipo: GeoConsentTipoValue): Promise<void> {
    await conUsuario(userId, async (tx) => {
      const existente = await tx.geoConsent.findUnique({
        where: { userId_tipo: { userId, tipo: tipo as GeoConsentTipo } },
      })
      if (existente && existente.estado === GeoConsentEstado.ACTIVE) {
        await tx.geoConsent.update({
          where: { userId_tipo: { userId, tipo: tipo as GeoConsentTipo } },
          data: { estado: GeoConsentEstado.REVOKED, revokedAt: new Date() },
        })
      }
    })
  },

  /** Estado ACTIVE/REVOKED por tipo (para la pantalla "Privacidad y ubicación"). */
  async estadoDe(userId: string): Promise<Record<GeoConsentTipoValue, boolean>> {
    return conUsuario(userId, async (tx) => {
      const rows = await tx.geoConsent.findMany({ where: { userId } })
      const activo: Record<GeoConsentTipoValue, boolean> = {
        FUNCTIONAL_USAGE: false,
        HOME_STORAGE: false,
        MARKETING_GEO: false,
        DEVICE_LOCATION_SESSION: false,
      }
      for (const r of rows) {
        if (r.estado === GeoConsentEstado.ACTIVE) {
          activo[r.tipo as GeoConsentTipoValue] = true
        }
      }
      return activo
    })
  },
}
