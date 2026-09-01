import 'server-only'
import { conEmpresa } from '@/lib/tenant'

/**
 * BITÁCORA de Membego Connect: el rastro operativo de conexiones y claves.
 *
 * Best-effort A PROPÓSITO: anotar jamás rompe la operación que se está
 * anotando — un INSERT de log fallido no puede tumbar un refresh de OAuth.
 * El mismo contrato que el bus de eventos («nunca lanza»).
 *
 * AQUÍ NUNCA ENTRA UN SECRETO. Ni tokens, ni claves, ni payloads de clientes:
 * `detalle` lleva metadatos operativos (códigos de estado, duraciones,
 * contadores). Quien anote algo más está creando una segunda copia sin cifrar
 * de lo que `credenciales_conexion` guarda sellado.
 */

export type NivelBitacora = 'INFO' | 'WARN' | 'ERROR'
export type OrigenBitacora = 'CONEXION' | 'CLAVE_API' | 'BUS' | 'SISTEMA'

export interface ApunteConector {
  companyId: string
  origen: OrigenBitacora
  /** Id suelto de la fuente (conexionId, claveApiId…), según `origen`. */
  origenId?: string | null
  nivel?: NivelBitacora
  /** Vocabulario estable: "credencial.guardada", "oauth.refresh"… */
  evento: string
  detalle?: Record<string, unknown>
}

export async function anotarConector(apunte: ApunteConector): Promise<void> {
  try {
    await conEmpresa(apunte.companyId, (tx) =>
      tx.registroConector.create({
        data: {
          companyId: apunte.companyId,
          origen: apunte.origen,
          origenId: apunte.origenId ?? null,
          nivel: apunte.nivel ?? 'INFO',
          evento: apunte.evento,
          detalle: (apunte.detalle ?? undefined) as object | undefined,
        },
      })
    )
  } catch (e) {
    // La bitácora degrada a consola, nunca a excepción.
    console.error('[connect] bitácora no pudo anotar', apunte.evento, e)
  }
}

/**
 * Lectura para las pantallas de actividad.
 *
 * `origen` se añadió en la Fase 11: el historial de UNA integración pide solo
 * los apuntes de conexiones, y filtrarlo aquí evita traerse las claves de API
 * y los webhooks de toda la empresa para descartarlos después en memoria.
 */
export async function registrosDeEmpresa(
  companyId: string,
  opciones?: { origenId?: string; origen?: OrigenBitacora; limite?: number }
) {
  return conEmpresa(companyId, (tx) =>
    tx.registroConector.findMany({
      where: {
        companyId,
        ...(opciones?.origenId ? { origenId: opciones.origenId } : {}),
        ...(opciones?.origen ? { origen: opciones.origen } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opciones?.limite ?? 50, 200),
    })
  )
}
