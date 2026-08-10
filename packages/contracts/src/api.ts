/**
 * CONTRATOS · lo que devuelve cada endpoint de `/api/platform/v1`.
 *
 * Los DTOs son EXACTAMENTE los campos que el contrato de proyección permite
 * copiar. Nada de identidad del proveedor, datos de pago ni preferencias: un
 * vertical opera con esto y lo demás es de MembeGo.
 */

// ── DTOs ────────────────────────────────────────────────────────────────────

export interface CompanyDTO {
  id: string
  nombre: string
  slug: string
  logoUrl: string | null
  moneda: string
  zonaHoraria: string
  idioma: string
}

export interface BranchDTO {
  id: string
  companyId: string
  nombre: string
  direccion: string | null
  activa: boolean
}

export interface CustomerDTO {
  id: string
  nombre: string
  /** Puede venir vacío: los clientes de mostrador no tienen correo. */
  email: string
  telefono: string | null
}

/**
 * RESUMEN, y el nombre es la advertencia: sirve para PINTAR «cliente con
 * membresía activa». **No autoriza nada.** Para saber si se puede consumir un
 * beneficio, `benefits.evaluate`.
 */
export interface MembershipSummaryDTO {
  id: string
  customerId: string
  companyId: string
  planNombre: string
  estado: string
  vigenteHasta: string | null
}

// ── Respuestas ──────────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  scope: string
}

export interface SystemMeResponse {
  slug: string
  nombre: string
  estado: string
  businessTypes: string[]
  /** Scopes EFECTIVOS de este token, no los de la credencial. */
  scopes: string[]
}

export interface EntitlementsResponse {
  entitlements: {
    companyId: string
    nombre: string | null
    slug: string | null
    plan: string | null
    habilitadoDesde: string | null
  }[]
}

export interface BranchesResponse {
  branches: BranchDTO[]
}

export interface MembershipsActiveResponse {
  memberships: MembershipSummaryDTO[]
  /** Siempre `false`. Está aquí para que quien lea el JSON tenga el aviso. */
  autoriza: false
}

export type TipoBeneficio = 'MEMBERSHIP' | 'PROMOTION'

export interface BeneficioEvaluado {
  type: TipoBeneficio
  id: string
  nombre: string
  eligible: boolean
  usesLeft: number
  expiresAt: string | null
  /** `SIN_USOS`, `EXPIRED`, `DAY_NOT_ALLOWED`… `null` si es elegible. */
  reason: string | null
}

export interface EvaluateResponse {
  customerId: string
  companyId: string
  eligible: boolean
  benefits: BeneficioEvaluado[]
  evaluatedAt: string
  /** Siempre `false`: evaluar NO reserva nada. El canje vuelve a decidir. */
  reserved: false
}

export interface RedemptionResponse {
  redemptionId: string
  visitId: string
  codigo: string
  ticketNumero: string
  customerId: string
  companyId: string
  servicio: string
  /** `null` en planes ilimitados. */
  usesLeft: number | null
  unlimited: boolean
  redeemedAt: string
}

export interface TransactionResponse {
  transactionId: string
  codigo: string
  ticketNumero: string
  companyId: string
  amount: number
  recordedAt: string
}

/** Lo que devuelve `POST /sso/redeem`. */
export interface SsoRedeemResponse {
  sub: string
  email: string
  nombre: string | null
  /** Rol en MembeGo (ADMIN_EMPRESA, CAJERO…). NO es el puesto del vertical. */
  membegoRole: string
  /**
   * Puesto DENTRO de tu sistema: `MESERO`, `COCINA`… Cadena libre que MembeGo
   * transporta y no interpreta. `null` si nadie se lo asignó a esta persona.
   */
  systemRole: string | null
  permisos: Record<string, unknown> | null
  companyId: string
  /** A dónde llevar al usuario. Ya validada contra tu `urlBase`. */
  returnUrl: string | null
  expiresAt: string
}

export interface KeysResponse {
  keys: { kid: string; alg: string; use: string; publicKeyPem: string }[]
  algorithm: string | null
  signedHeaders?: { signature: string; timestamp: string; eventId: string }
  signedMaterial?: string
  replayWindowSeconds?: number
}

// ── Peticiones ──────────────────────────────────────────────────────────────

export interface EvaluateRequest {
  companyId: string
  customerId: string
}

export interface RedemptionRequest {
  companyId: string
  membershipId: string
  servicio: string
  vehiculoId?: string | null
  sucursalId?: string | null
  qrTokenId?: string | null
  notas?: string | null
}

export interface TransactionRequest {
  companyId: string
  customerId?: string | null
  branchId?: string | null
  amount: number
  description?: string
  /** Tu referencia interna, para poder cruzar informes. */
  externalId?: string | null
}
