import { base64url, jwtVerify } from 'jose'
import { getSupabaseJwtSecret, getSupabaseUrl } from '@/lib/env'
import type { AppMetadata } from '@/types'

/**
 * Local access-token verification (edge-safe, no Prisma, no network).
 *
 * The Supabase SSR client stores the whole session in the `sb-<ref>-auth-token`
 * cookie (optionally chunked as `<name>.0`, `<name>.1`, ...). The cookie value
 * is either the raw session JSON (`cookieEncoding: 'raw'`) or, by default,
 * `base64-` + base64url(JSON.stringify(session)). We read that cookie, extract
 * `access_token`, and verify its HS256 signature against `SUPABASE_JWT_SECRET`.
 *
 * This lets the middleware and `getUser` trust a session without calling
 * Supabase Auth, and closes the gap where `getSession()` decoded a cookie
 * without checking its signature (a forged cookie could pass UX redirects).
 *
 * Any failure (missing secret, unreadable cookie, bad signature, expired
 * token) returns `null` so callers fall back to the SDK path.
 */

const BASE64_PREFIX = 'base64-'

export interface LocalVerifiedUser {
  id: string
  email: string
  appMetadata: Partial<AppMetadata>
}

export interface LocalSession {
  user: LocalVerifiedUser
  /** Unix seconds when the access token expires (0 if unknown). */
  expiresAt: number
}

export interface CookieLike {
  name: string
  value: string
}

interface StoredSession {
  access_token?: string
  expires_at?: number | null
}

function supabaseProjectRef(): string {
  const hostname = new URL(getSupabaseUrl()).hostname
  return hostname.split('.')[0]
}

function authTokenCookieName(): string {
  return `sb-${supabaseProjectRef()}-auth-token`
}

/** Reads a cookie value, reassembling chunked cookies (`name.0`, `name.1`, ...). */
function findCookieValue(name: string, cookies: readonly CookieLike[]): string | null {
  const exact = cookies.find((c) => c.name === name)
  if (exact?.value) return exact.value

  const chunks: string[] = []
  for (let i = 0; ; i++) {
    const chunk = cookies.find((c) => c.name === `${name}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
  }
  return chunks.length > 0 ? chunks.join('') : null
}

function decodeStoredSession(value: string): StoredSession | null {
  try {
    const raw = value.startsWith(BASE64_PREFIX)
      ? new TextDecoder().decode(base64url.decode(value.slice(BASE64_PREFIX.length)))
      : value
    const parsed = JSON.parse(raw) as StoredSession
    if (typeof parsed.access_token !== 'string' || parsed.access_token.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Verifies the access token stored in the Supabase session cookie against the
 * local JWT secret. Returns `null` when the session cannot be trusted.
 */
export async function verifyLocalSession(
  cookies: readonly CookieLike[]
): Promise<LocalSession | null> {
  try {
    const secret = getSupabaseJwtSecret()
    const raw = findCookieValue(authTokenCookieName(), cookies)
    if (!raw) return null

    const stored = decodeStoredSession(raw)
    if (!stored?.access_token) return null

    const { payload } = await jwtVerify(stored.access_token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
    })
    if (!payload.sub) return null

    const appMetadata = (payload.app_metadata ?? {}) as Partial<AppMetadata>
    return {
      user: {
        id: String(payload.sub),
        email: typeof payload.email === 'string' ? payload.email : '',
        appMetadata,
      },
      expiresAt: stored.expires_at ?? (typeof payload.exp === 'number' ? payload.exp : 0),
    }
  } catch {
    return null
  }
}
