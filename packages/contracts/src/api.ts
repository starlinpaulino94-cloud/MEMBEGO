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
 * Vehículo de un cliente.
 *
 * Es una entidad COMPARTIDA: MembeGo es su dueño —las membresías se atan a
 * vehículos concretos (§13)— y a la vez un lavadero no puede operar sin ella.
 * Por eso está en el contrato en vez de que cada vertical se invente la suya.
 *
 * Sin color, sin año y sin la categoría tarifaria: un vertical identifica el
 * coche con la matrícula y lo nombra con marca y modelo. Lo demás es de MembeGo.
 */
export interface VehicleDTO {
  id: string
  customerId: string
  /** Puede ser null: hay vehículos históricos sin matrícula registrada. */
  placa: string | null
  marca: string
  modelo: string
}

export interface VehiclesResponse {
  vehicles: VehicleDTO[]
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

/**
 * Una promoción de la empresa, para que el satélite la LISTE y la muestre.
 *
 * Sin las tripas del motor de reglas (`PromotionRule`, versiones, auditoría):
 * un satélite pinta el título, la vigencia y si sigue activa; decidir si un
 * cliente concreto puede canjearla es de `benefits.evaluate`, no de esta lista.
 */
export interface PromotionDTO {
  id: string
  titulo: string
  descripcion: string
  imagenUrl: string | null
  activo: boolean
  vigenciaDesde: string
  vigenciaHasta: string | null
}

/**
 * Una cita/reservación de la empresa. Sin notas internas ni datos del cliente
 * más allá de su id: el satélite pinta la agenda; la ficha la pide aparte.
 */
export interface AppointmentDTO {
  id: string
  customerId: string
  branchId: string | null
  vehicleId: string | null
  inicio: string
  duracionMin: number
  servicio: string | null
  estado: string
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

export interface MembershipsResponse {
  memberships: MembershipSummaryDTO[]
}

export interface PromotionsResponse {
  promotions: PromotionDTO[]
}

export interface AppointmentsResponse {
  appointments: AppointmentDTO[]
}

export type TipoBeneficio = 'MEMBERSHIP' | 'PROMOTION'

/** Un vehículo que la membresía protege. */
export interface VehiculoCubiertoDTO {
  vehiculoId: string
  placa: string | null
  /** Nivel congelado al asociarlo (ver `vehicleLevelMax`). */
  nivelTarifario: number
}

export type MotivoNoCubre =
  | 'VEHICLE_LEVEL_ABOVE_PLAN'
  | 'VEHICLE_NOT_IN_MEMBERSHIP'
  | 'NO_USES_LEFT'

/**
 * QUÉ cubre la membresía. Solo en los beneficios de tipo `MEMBERSHIP`.
 *
 * NO lleva importes, y no es un olvido: MembeGo no conoce la tarifa del
 * satélite. Dice hasta qué vehículo llega el plan y cuántos lavados quedan; lo
 * que cuesta un lavado de SUV en ESE car wash lo pone el car wash, con su
 * propio catálogo. Un precio inventado que sale por una API acaba cobrado.
 */
export interface CoberturaMembresia {
  /** Tope de vehículo del plan. `null` = acepta cualquiera. */
  vehicleLevelMax: number | null
  unlimited: boolean
  washesIncluded: number
  vehicles: VehiculoCubiertoDTO[]
  /**
   * `true` cubre · `false` no cubre · `null` NO SE PREGUNTÓ (la llamada no
   * mandó `context`). Los tres son distintos: tratar `null` como `false` cobra
   * de más, y como `true` regala el lavado.
   */
  covers: boolean | null
  reason: MotivoNoCubre | null
}

export interface BeneficioEvaluado {
  type: TipoBeneficio
  id: string
  nombre: string
  eligible: boolean
  usesLeft: number
  expiresAt: string | null
  /** `SIN_USOS`, `EXPIRED`, `DAY_NOT_ALLOWED`… `null` si es elegible. */
  reason: string | null
  /** Solo en `MEMBERSHIP`; `null` en las promociones. */
  coverage: CoberturaMembresia | null
}

/**
 * Contexto opcional de `POST /benefits/evaluate`: qué carro hay delante.
 *
 * Sin él, la respuesta es la de siempre y `coverage.covers` viene `null`. Con
 * él, cada membresía dice si cubre ESE vehículo.
 */
export interface EvaluateContext {
  /** Nivel tarifario del vehículo que llegó. */
  vehicleLevel?: number | null
  /** Placa del vehículo, normalizada por el satélite. */
  plate?: string | null
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

/**
 * Lo que devuelve `POST /redemptions/{visitId}/reverse`.
 *
 * El identificador que se revierte es el `visitId` del canje, no el
 * `redemptionId`: lo que consumió el lavado fue la visita; la transacción
 * comercial se arrastra a `REVERTED` detrás.
 */
export interface ReversalResponse {
  visitId: string
  membershipId: string
  customerId: string
  companyId: string
  /** Saldo tras devolver el lavado. `null` en planes ilimitados. */
  usesLeft: number | null
  /**
   * `false` = ya estaba revertida y esta llamada no cambió nada. Revertir dos
   * veces devuelve 200 y un lavado, no dos.
   */
  applied: boolean
  reversedAt: string
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
  /** Qué carro hay delante. Sin él, `coverage.covers` viene `null`. */
  context?: EvaluateContext
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

/** Cuerpo de `POST /redemptions/{visitId}/reverse`. */
export interface ReversalRequest {
  companyId: string
  /**
   * Por qué se revierte. OBLIGATORIO: una reversa sin motivo es un descuadre
   * que nadie puede explicar tres meses después.
   */
  reason: string
}

/**
 * Alta de alguien que llegó sin cuenta.
 *
 * SOLO EL NOMBRE ES OBLIGATORIO, y es una decisión: exigir correo o documento
 * en la puerta es la forma más rápida de que el encargado deje de usar el
 * sistema. Un cliente registrado con solo su nombre vale más que uno no
 * registrado.
 *
 * Lo que NO se manda es igual de importante: no hay `id`, ni `esLocal`, ni
 * canal. Quien decide cómo queda la fila es el Core (§14) — el vertical pide un
 * alta, no escribe un registro.
 */
export interface CreateCustomerRequest {
  companyId: string
  name: string
  phone?: string | null
  email?: string | null
}

export interface CreateCustomerResponse {
  customer: CustomerDTO
  /**
   * `false` cuando ese identificador ya estaba y se devuelve el cliente que ya
   * existe. Míralo: un cliente que ya existía puede tener membresía, y darle la
   * bienvenida como si fuera nuevo es un sistema que no lo reconoce.
   */
  created: boolean
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
