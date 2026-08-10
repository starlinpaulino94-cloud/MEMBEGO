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
  'MEMBERSHIP_LOOKUP',
  'BENEFIT_EVALUATION',
  'BENEFIT_REDEMPTION',
  'PROMOTION_LOOKUP',
  'QR_VALIDATION',
  'BRANCH_LOOKUP',
  'VISIT_SYNC',
  'TRANSACTION_SYNC',
  'LOYALTY_EVENT',
] as const

export type Capability = (typeof CAPABILITIES)[number]

/**
 * Scope OAuth que cada capability exige. Concesión mínima: declarar que solo se
 * consultan clientes NO da permiso de escribir transacciones.
 *
 * `BENEFIT_REDEMPTION` incluye `benefits:read` además de `benefits:redeem`
 * porque un sistema que puede consumir pero no evaluar consumiría a ciegas.
 */
export const SCOPES_POR_CAPABILITY: Record<Capability, readonly string[]> = {
  CUSTOMER_LOOKUP: ['customers:read'],
  MEMBERSHIP_LOOKUP: ['memberships:read'],
  BENEFIT_EVALUATION: ['benefits:read'],
  BENEFIT_REDEMPTION: ['benefits:read', 'benefits:redeem'],
  PROMOTION_LOOKUP: ['promotions:read'],
  QR_VALIDATION: ['qr:validate'],
  BRANCH_LOOKUP: ['branches:read'],
  VISIT_SYNC: ['visits:write'],
  TRANSACTION_SYNC: ['transactions:write'],
  LOYALTY_EVENT: ['events:publish'],
}

/** Scopes que corresponden a un conjunto de capabilities, sin repetidos. */
export function scopesDe(capabilities: readonly Capability[]): string[] {
  return [...new Set(capabilities.flatMap((c) => SCOPES_POR_CAPABILITY[c]))].sort()
}

/** Todos los scopes que el estándar reconoce. */
export const SCOPES = scopesDe(CAPABILITIES)
