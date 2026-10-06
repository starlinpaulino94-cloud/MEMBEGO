import 'server-only'
import { createHash } from 'node:crypto'
import { getApiClientUser } from '@/lib/auth/api-guard'
import type { SessionUser } from '@/types'

export const CAPTURE_TTL_MS = 10 * 60 * 1000
export const CLAIM_STALE_MS = 45 * 1000
export const ACTIVATION_CLAIM_STALE_MS = 120 * 1000
export const PURCHASE_RETRY_MS = 60 * 1000

export type CardnetReply = {
  readonly status: number
  readonly body: Record<string, unknown>
}

export async function getCardnetBearerUser(request: Request): Promise<SessionUser | null> {
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ') || !authorization.slice(7).trim()) return null
  const user = await getApiClientUser(request)
  return user?.metadata.role === 'CLIENTE' && user.metadata.clienteId ? user : null
}

export function fail(status: number, error: string): CardnetReply {
  return { status, body: { ok: false, error } }
}

export function success(status: number, fields: Record<string, unknown> = {}): CardnetReply {
  return { status, body: { ok: true, ...fields } }
}

export function ownRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return Object.fromEntries(Object.entries(value))
}

export function requestIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const realIp = request.headers.get('x-real-ip')?.trim()
  return forwarded || realIp || 'unknown'
}

export function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex')
}

export function sessionPayload(session: {
  readonly id: string
  readonly venceAt: Date
  readonly monto: unknown
  readonly moneda: string
  readonly captureUrl: string | null
  readonly scriptUrl: string | null
  readonly publicKey: string | null
  readonly customerUniqueId: string | null
}, nonce: string): CardnetReply | null {
  if (
    !session.captureUrl ||
    !session.scriptUrl ||
    !session.publicKey ||
    !session.customerUniqueId
  ) return null
  return success(200, {
    sessionId: session.id,
    captureNonce: nonce,
    expiresAt: session.venceAt.toISOString(),
    amount: Number(session.monto),
    currency: session.moneda,
    captureUrl: session.captureUrl,
    scriptUrl: session.scriptUrl,
    publicKey: session.publicKey,
    uniqueId: session.customerUniqueId,
  })
}
