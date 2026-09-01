/**
 * NÚCLEO PURO de Membego Connect: vocabulario y máquina de estados de las
 * conexiones. Sin Prisma, sin red, sin `server-only` — importable desde las
 * pruebas y desde cualquier capa.
 */

export const ESTADOS_CONECTOR = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'RETIRED'] as const
export type EstadoConector = (typeof ESTADOS_CONECTOR)[number]

export const ESTADOS_CONEXION = ['PENDING', 'CONNECTED', 'ERROR', 'DISCONNECTED'] as const
export type EstadoConexion = (typeof ESTADOS_CONEXION)[number]

/**
 * Transiciones legales de una conexión. Un estado que puede saltar a
 * cualquier otro no es un estado, es un string.
 *
 *   PENDING      → CONNECTED (la credencial validó) | DISCONNECTED (abandono)
 *   CONNECTED    → ERROR (el proveedor revocó/caducó) | DISCONNECTED
 *   ERROR        → CONNECTED (reconexión) | DISCONNECTED
 *   DISCONNECTED → PENDING (la empresa vuelve a empezar el alta)
 *
 * Nótese lo que NO hay: nada vuelve a CONNECTED sin pasar por una validación
 * (anotarSalud con éxito o reconexión), y DISCONNECTED no se abandona más que
 * empezando el alta de nuevo — un éxito rezagado de un job viejo no resucita
 * una conexión que la empresa apagó.
 */
const TRANSICIONES: Record<EstadoConexion, readonly EstadoConexion[]> = {
  PENDING: ['CONNECTED', 'DISCONNECTED'],
  CONNECTED: ['ERROR', 'DISCONNECTED'],
  ERROR: ['CONNECTED', 'DISCONNECTED'],
  DISCONNECTED: ['PENDING'],
}

export function puedeTransicionar(de: EstadoConexion, a: EstadoConexion): boolean {
  return TRANSICIONES[de]?.includes(a) ?? false
}

/**
 * VOCABULARIO de features de Connect y su valor por defecto.
 *
 * Vive aquí y no en la base: dar de alta una feature nueva es añadir una línea
 * y su default, sin migrar nada.
 *
 * SIN FILA = EL DEFAULT, y los defaults son deliberadamente generosos en lo
 * gratis y cerrados en lo que costará dinero de verdad: las features que
 * consumen servicios externos de pago nacen apagadas y se encienden empresa a
 * empresa. Eso evita el clásico «lanzamos y a los tres días todo el mundo
 * tenía WhatsApp ilimitado».
 */
export const FEATURES_CONNECT = {
  /** Cuántas conexiones a conectores puede tener la empresa. */
  'conexiones.max': { default: 2 },
  /** Cuántas claves de API activas puede tener la empresa. */
  'api_keys.max': { default: 0 },
  /** Cuántas suscripciones de webhook salientes. */
  'webhooks.max': { default: 0 },
} as const

export type FeatureConnect = keyof typeof FEATURES_CONNECT
