import { createHash } from 'node:crypto'
import { z } from 'zod'
import { desenvolverRespuesta, interpretarCompraToken, TRANSACTION_STATUS, type PerfilPagoCardnet } from '@/lib/payments/cardnet-tokens-core'

const idSchema = z.string().trim().min(1).max(128)

export const cardnetSessionInputSchema = z
  .object({
    membershipId: idSchema.optional(),
    compraId: idSchema.optional(),
    guardarParaRenovacion: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const hasMembership = input.membershipId !== undefined
    const hasPurchase = input.compraId !== undefined
    if (hasMembership === hasPurchase) {
      ctx.addIssue({ code: 'custom', message: 'Debe indicar un solo objetivo.' })
    }
    if (input.guardarParaRenovacion && !hasMembership) {
      ctx.addIssue({ code: 'custom', message: 'El consentimiento solo aplica a membresías.' })
    }
  })

export const cardnetConfirmInputSchema = z
  .object({
    sessionId: z.string().min(32).max(80),
    captureNonce: z.string().min(32).max(80),
    token: z.string().trim().min(8).max(512).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
  })
  .strict()

export const cardnetActivationInputSchema = z
  .object({
    sessionId: z.string().min(32).max(80),
    activationCode: z.string().trim().regex(/^[A-Za-z0-9]{6}$/),
  })
  .strict()

export const cardnetStatusInputSchema = z.string().min(32).max(80)

export type CardnetSessionInput = z.infer<typeof cardnetSessionInputSchema>
export type CardnetConfirmInput = z.infer<typeof cardnetConfirmInputSchema>
export type CardnetActivationInput = z.infer<typeof cardnetActivationInputSchema>

export const CARDNET_SESSION_STATES = {
  STARTING: 'STARTING',
  CAPTURE_OPEN: 'CAPTURE_OPEN',
  CAPTURE_CONSUMED: 'CAPTURE_CONSUMED',
  PROFILE_PENDING: 'PROFILE_PENDING',
  ACTIVATION_REQUIRED: 'ACTIVATION_REQUIRED',
  ACTIVATION_PROCESSING: 'ACTIVATION_PROCESSING',
  PURCHASE_PENDING: 'PURCHASE_PENDING',
  FULFILLMENT_PENDING: 'FULFILLMENT_PENDING',
  ASSOCIATION_PENDING: 'ASSOCIATION_PENDING',
  APPROVED: 'APPROVED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
  FAILED: 'FAILED',
} as const

export type CardnetSessionState = (typeof CARDNET_SESSION_STATES)[keyof typeof CARDNET_SESSION_STATES]
export type CardnetClientStatus = 'pending' | 'approved' | 'declined' | 'activation_required' | 'expired'

export type CardnetPurchaseDecision =
  | { readonly kind: 'approved'; readonly authorization: string | null }
  | { readonly kind: 'declined' }
  | { readonly kind: 'activation_required' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'ambiguous' }

export function clientStatus(state: CardnetSessionState): CardnetClientStatus {
  switch (state) {
    case 'APPROVED':
      return 'approved'
    case 'DECLINED':
      return 'declined'
    case 'ACTIVATION_REQUIRED':
      return 'activation_required'
    case 'EXPIRED':
      return 'expired'
    case 'STARTING':
    case 'CAPTURE_OPEN':
    case 'CAPTURE_CONSUMED':
    case 'PROFILE_PENDING':
    case 'ACTIVATION_PROCESSING':
    case 'PURCHASE_PENDING':
    case 'FULFILLMENT_PENDING':
    case 'ASSOCIATION_PENDING':
    case 'FAILED':
      return 'pending'
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}

export function cardnetReservationKey(companyId: string, clienteId: string): string {
  return createHash('sha256').update(`${companyId}:${clienteId}`).digest('hex')
}

export function perfilIdentidad(perfil: PerfilPagoCardnet): string | null {
  if (perfil.paymentProfileId) return `id:${perfil.paymentProfileId}`
  if (!perfil.token) return null
  return `token:${createHash('sha256').update(perfil.token).digest('hex')}`
}

export function perfilesBase(perfiles: readonly PerfilPagoCardnet[]): string[] {
  return perfiles.map(perfilIdentidad).filter((identity): identity is string => identity !== null)
}

export type PerfilNuevoResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'missing_token' }
  | { readonly kind: 'selected'; readonly perfil: PerfilPagoCardnet }

export function seleccionarPerfilNuevo(
  perfiles: readonly PerfilPagoCardnet[],
  baseline: readonly string[]
): PerfilNuevoResult {
  const previous = new Set(baseline)
  const nuevos = perfiles.filter((perfil) => {
    const identity = perfilIdentidad(perfil)
    return identity !== null && !previous.has(identity)
  })
  if (nuevos.length === 0) return { kind: 'missing' }
  if (nuevos.length !== 1) return { kind: 'ambiguous' }
  const perfil = nuevos[0]
  if (!perfil?.token) return { kind: 'missing_token' }
  return { kind: 'selected', perfil }
}

export function validarCaptureUrl(captureUrl: string, expectedBase: string): boolean {
  try {
    const actual = new URL(captureUrl)
    const expected = new URL(expectedBase)
    const actualPath = actual.pathname.endsWith('/') ? actual.pathname : `${actual.pathname}/`
    const expectedPath = expected.pathname.endsWith('/') ? expected.pathname : `${expected.pathname}/`
    return (
      actual.protocol === 'https:' &&
      actual.origin === expected.origin &&
      actualPath === expectedPath &&
      actual.username === '' &&
      actual.password === '' &&
      actual.hash === ''
    )
  } catch {
    return false
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

function field(value: unknown, ...keys: readonly string[]): string | null {
  const row = record(value)
  if (!row) return null
  for (const key of keys) {
    const item = row[key]
    if (typeof item === 'string' || typeof item === 'number') {
      const normalized = String(item).trim()
      if (normalized) return normalized
    }
  }
  return null
}

export function purchaseDecision(httpStatus: number, payload: unknown): CardnetPurchaseDecision {
  if (httpStatus < 200 || httpStatus >= 300) return { kind: 'ambiguous' }
  const raw = record(payload) ?? {}
  const { datos, errores } = desenvolverRespuesta(raw)
  const transaction = record(datos.Transaction) ?? {}
  const transactionState = Number(
    transaction.TransactionStatusId ?? datos.TransactionStatusId ?? transaction.TransactionStatus ?? NaN
  )
  const interpreted = interpretarCompraToken(raw)
  if (interpreted.requiereActivacion) return { kind: 'activation_required' }
  if (transactionState === TRANSACTION_STATUS.PENDIENTE || transactionState === TRANSACTION_STATUS.PREAUTORIZADA) {
    return { kind: 'pending' }
  }
  if (transactionState === TRANSACTION_STATUS.APROBADA && interpreted.aprobada && errores.length === 0) {
    return { kind: 'approved', authorization: interpreted.autorizacion }
  }
  if (transactionState === TRANSACTION_STATUS.RECHAZADA && errores.length === 0) return { kind: 'declined' }
  if (!Number.isFinite(transactionState) && interpreted.aprobada && errores.length === 0) {
    return { kind: 'approved', authorization: interpreted.autorizacion }
  }
  return { kind: 'pending' }
}

export function purchaseList(payload: unknown): readonly unknown[] | null {
  const outer = record(payload)
  if (!outer) return null
  const response = outer.Response ?? outer.response
  if (Array.isArray(response)) return response
  const nested = record(response)
  if (!nested) return null
  const values = nested.Purchases ?? nested.purchases ?? nested.Items ?? nested.items
  return Array.isArray(values) ? values : null
}

export function matchingPurchases(
  purchases: readonly unknown[],
  expected: { readonly customerId: string; readonly orderNumber: string; readonly uniqueId: string; readonly from: Date; readonly to: Date }
): readonly unknown[] {
  return purchases.filter((purchase) => {
    const customer = record(record(purchase)?.Customer ?? record(purchase)?.customer)
    const customerId = field(purchase, 'CustomerId', 'customerId') ?? field(customer, 'CustomerId', 'customerId')
    const created = field(purchase, 'Created', 'created')
    const createdAt = created ? new Date(created) : null
    return (
      field(purchase, 'Order', 'OrderNumber', 'order') === expected.orderNumber &&
      field(purchase, 'UniqueID', 'UniqueId', 'uniqueId') === expected.uniqueId &&
      customerId === expected.customerId &&
      createdAt !== null &&
      !Number.isNaN(createdAt.getTime()) &&
      createdAt >= expected.from &&
      createdAt <= expected.to
    )
  })
}
