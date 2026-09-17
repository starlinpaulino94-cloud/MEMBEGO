/**
 * CONTRATOS · capabilities y scopes.
 *
 * Lo que un sistema vertical declara necesitar del Core, y el permiso concreto
 * que cada declaración concede.
 *
 * En inglés a propósito: estos valores viajan por el cable —van en el manifest
 * del satélite, en los scopes de su credencial y en su documentación—. Un
 * identificador de protocolo no se traduce. El resto del dominio de MembeGo sí
 * está en español, y ese contraste es deliberado.
 */

export const CAPABILITIES = [
  'CUSTOMER_LOOKUP',
  'CUSTOMER_REGISTRATION',
  'MEMBERSHIP_LOOKUP',
  'BENEFIT_EVALUATION',
  'BENEFIT_REDEMPTION',
  'PROMOTION_LOOKUP',
  'APPOINTMENT_LOOKUP',
  'QR_VALIDATION',
  'BRANCH_LOOKUP',
  'VISIT_SYNC',
  'TRANSACTION_SYNC',
  'LOYALTY_EVENT',
  /**
   * Administrar las SUSCRIPCIONES DE WEBHOOK de la propia empresa.
   *
   * Es lo que necesita una app de Zapier (o Make, o cualquier constructor de
   * flujos) para funcionar como se espera: al montar un Zap crea la
   * suscripción, y al apagarlo la retira. Sin esto habría que entrar al panel a
   * mano cada vez, que es justo lo que nadie hace.
   *
   * NO es una escritura de negocio: no crea clientes ni consume beneficios, así
   * que no necesita decir qué sistema la respalda. Toca la configuración de
   * avisos de quien presenta la clave, y de nadie más.
   */
  'WEBHOOK_SUBSCRIPTION',
  /**
   * EDITAR la ficha de contacto de un cliente que YA existe (nombre, teléfono,
   * correo). No crea ni consume nada.
   *
   * Es escritura, pero de otra clase que `CUSTOMER_REGISTRATION`: aquélla la
   * hace un satélite —el punto de venta que registra a quien llega sin cuenta—
   * y queda atada al sistema que la respalda, para que se pueda auditar de
   * dónde salió la ficha. Ésta la hace una clave de EMPRESA —una integración de
   * trastienda, un Zapier que mantiene los datos al día— sobre clientes que la
   * empresa ya tiene. No mueve valor, así que no necesita un sistema detrás.
   *
   * Por eso su scope es `customers:manage` y no `customers:write`: el `:write`
   * es de los satélites y arrastra idempotencia y canal de origen; el `:manage`
   * es «ordena tus propios registros», concedible a una clave de empresa.
   */
  'CUSTOMER_UPDATE',
] as const

export type Capability = (typeof CAPABILITIES)[number]

/**
 * Scope OAuth que cada capability exige. Concesión mínima: declarar que solo se
 * consultan clientes NO da permiso de escribir transacciones.
 *
 * `BENEFIT_REDEMPTION` incluye `benefits:read` además de `benefits:redeem`
 * porque un sistema que puede consumir pero no evaluar consumiría a ciegas.
 *
 * `CUSTOMER_REGISTRATION` incluye `customers:read` por el mismo motivo: el alta
 * deduplica, y cuando el cliente ya existía devuelve SU ficha. Conceder escribir
 * sin leer sería conceder un camino por el que se leen clientes igual, sin que
 * el scope lo diga — y un permiso que miente es peor que uno amplio.
 */
export const SCOPES_POR_CAPABILITY: Record<Capability, readonly string[]> = {
  CUSTOMER_LOOKUP: ['customers:read'],
  CUSTOMER_REGISTRATION: ['customers:read', 'customers:write'],
  MEMBERSHIP_LOOKUP: ['memberships:read'],
  BENEFIT_EVALUATION: ['benefits:read'],
  BENEFIT_REDEMPTION: ['benefits:read', 'benefits:redeem'],
  PROMOTION_LOOKUP: ['promotions:read'],
  APPOINTMENT_LOOKUP: ['appointments:read'],
  QR_VALIDATION: ['qr:validate'],
  BRANCH_LOOKUP: ['branches:read'],
  VISIT_SYNC: ['visits:write'],
  TRANSACTION_SYNC: ['transactions:write'],
  LOYALTY_EVENT: ['events:publish'],
  WEBHOOK_SUBSCRIPTION: ['webhooks:manage'],
  // `customers:read` va incluido por el mismo motivo que en el alta: la
  // respuesta de una edición devuelve la ficha, así que conceder editar sin
  // leer sería un scope que miente sobre lo que de verdad deja hacer.
  CUSTOMER_UPDATE: ['customers:read', 'customers:manage'],
}

/** Scopes que corresponden a un conjunto de capabilities, sin repetidos. */
export function scopesDe(capabilities: readonly Capability[]): string[] {
  return [...new Set(capabilities.flatMap((c) => SCOPES_POR_CAPABILITY[c]))].sort()
}

/** Todos los scopes que el estándar reconoce. */
export const SCOPES = scopesDe(CAPABILITIES)
