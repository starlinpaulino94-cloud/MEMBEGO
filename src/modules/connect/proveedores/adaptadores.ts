import 'server-only'
import { cardnetTokensConfigurado } from '@/lib/payments/cardnet-tokens'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import type { EstadoIntegracion } from '@/modules/connect/proveedores/tipos'

/**
 * ADAPTADORES: cómo Connect LEE el estado de una integración que vive en otro
 * subsistema de Membego, sin duplicarlo (ajuste 3 del rediseño).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE NO SE PUEDE ROMPER
 *
 * Un adaptador SOLO LEE. No escribe, no crea fila en `conexiones_empresa`, no
 * guarda credenciales, no toca el subsistema que adapta. Si algún día un
 * adaptador escribiera, existirían dos verdades sobre el mismo hecho — que es
 * exactamente el problema que este diseño viene a evitar.
 *
 * La consecuencia práctica: «Gestionar» sobre una integración adaptada no
 * abre una pantalla de Connect, lleva al módulo que de verdad la administra.
 * El usuario ve un catálogo unificado; el estado sigue teniendo un solo dueño.
 */

export interface EstadoAdaptado {
  estado: EstadoIntegracion
  /** Qué contar debajo del estado, en lenguaje de negocio. */
  detalle: string
}

/**
 * CARDNET. Su verdad son dos cosas que ya existen y que NO se replican aquí:
 *
 *   1. la capacidad PAGO_CARDNET de la empresa (¿está encendida para ella?)
 *   2. las credenciales de plataforma (¿puede el servidor cobrar?)
 *
 * Nótese que «conectada» aquí no significa lo mismo que en una integración
 * nativa: no hay credencial de la empresa que guardar. Significa «esta empresa
 * puede cobrar con tarjeta», que es la pregunta que su dueño se hace.
 */
async function estadoCardnet(companyId: string): Promise<EstadoAdaptado> {
  // `tieneCapacidad` es fail-open por diseño (si la columna no está migrada,
  // responde que todo lo actual está permitido). Aquí se pide lo contrario:
  // ante la duda, NO afirmar que la empresa cobra con tarjeta.
  const encendida = await tieneCapacidad(companyId, 'PAGO_CARDNET').catch(() => false)
  const credenciales = cardnetTokensConfigurado()

  if (!credenciales) {
    return {
      estado: 'NO_DISPONIBLE',
      detalle: 'Faltan las credenciales de CardNET en el servidor.',
    }
  }
  if (!encendida) {
    return {
      estado: 'SIN_PLAN',
      detalle: 'El cobro con tarjeta no está habilitado para tu negocio.',
    }
  }
  return { estado: 'CONECTADA', detalle: 'Cobrando con tarjeta.' }
}

const ADAPTADORES: Record<string, (companyId: string) => Promise<EstadoAdaptado>> = {
  cardnet: estadoCardnet,
}

/**
 * El estado de una integración adaptada, o null si ese slug no tiene
 * adaptador. Devolver null y no lanzar es deliberado: el ensamblador del
 * catálogo trata la ausencia como «no disponible» en vez de tumbar la página
 * entera de integraciones por un proveedor.
 */
export async function estadoAdaptado(
  slug: string,
  companyId: string
): Promise<EstadoAdaptado | null> {
  const fn = ADAPTADORES[slug]
  if (!fn) return null
  return fn(companyId)
}
