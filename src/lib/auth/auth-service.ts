import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { isTransientAuthError } from '@/lib/auth/transient'
import { verifyLocalSession } from '@/lib/auth/jwt'
import type { AppMetadata, SessionUser } from '@/types'

/**
 * Auth provider abstraction.
 *
 * Isolates the Supabase SDK calls behind a small interface so the UI,
 * middleware and server actions do not depend on the identity provider. Keeps
 * the door open to swap Supabase for another provider (Clerk, Auth0, ...)
 * without touching call sites.
 *
 * `getUser` is intentionally NOT cached here: the `React.cache()` wrapper lives
 * in `src/lib/auth/index.ts` (the cache must wrap the exported function).
 */

export interface LoginInput {
  email: string
  password: string
}

export interface LoginResult {
  ok: boolean
  user?: SessionUser
  /** HTTP status of the auth failure; undefined for network failures. */
  status?: number
  /** Raw provider message. Never surface it directly to users. */
  providerMessage?: string
}

export interface AuthService {
  getUser(): Promise<SessionUser | null>
  login(input: LoginInput): Promise<LoginResult>
  logout(): Promise<void>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface AuthUserLike {
  id: string
  email?: string | null
  app_metadata?: unknown
}

function toSessionUser(user: AuthUserLike): SessionUser {
  const metadata = (user.app_metadata ?? {}) as Partial<AppMetadata>
  return {
    supabaseId: user.id,
    email: user.email ?? '',
    metadata: {
      role: metadata.role ?? 'CLIENTE',
      dbUserId: metadata.dbUserId ?? '',
      clienteId: metadata.clienteId ?? null,
      companyId: metadata.companyId ?? null,
    },
  }
}

/**
 * AUTO-REPAIR (see git history / docs/AUDITORIA_ESTABILIDAD.md): a CLIENTE
 * session without clienteId/companyId (general signup, half-finished signup,
 * metadata never set) breaks EVERY module with a different error each. It is
 * repaired here once per request. Dynamic import so Prisma is not dragged into
 * contexts that only read the session.
 */
async function repairClientSession(session: SessionUser): Promise<SessionUser> {
  if (
    session.metadata.role === 'CLIENTE' &&
    (!session.metadata.clienteId || !session.metadata.companyId)
  ) {
    try {
      const { repararContextoCliente } = await import('@/lib/auth/reparar-contexto')
      return await repararContextoCliente(session)
    } catch (e) {
      console.error('[auth] context repair failed:', e)
    }
  }
  return session
}

/** Reads the session cookie and verifies it locally against the JWT secret. */
async function localSessionFromCookies(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies()
    const local = await verifyLocalSession(cookieStore.getAll())
    if (!local) return null
    return toSessionUser({
      id: local.user.id,
      email: local.user.email,
      app_metadata: local.user.appMetadata,
    })
  } catch {
    return null
  }
}

/**
 * Resolves the current user, validating against the Supabase server.
 *
 * A transient auth failure (429/5xx/network) is retried once (signature check
 * intact) instead of being treated as "no session" and logging the user out.
 * If the outage persists, the access token in the cookie is verified locally
 * and, when still valid, the session is kept alive (fail-safe). A genuine
 * rejection (400/401/403) always means "no session".
 *
 * We do NOT fall back to `getSession()`: it decodes the JWT without verifying
 * the signature, and using it for authorization would allow a forged role
 * during an outage.
 */
async function fetchUser(): Promise<SessionUser | null> {
  const supabase = await createClient()

  let { data, error } = await supabase.auth.getUser()
  if (!data.user && isTransientAuthError(error)) {
    await sleep(250)
    ;({ data, error } = await supabase.auth.getUser())
  }
  if (data.user) return repairClientSession(toSessionUser(data.user))

  if (isTransientAuthError(error)) {
    const fallback = await localSessionFromCookies()
    if (fallback) return repairClientSession(fallback)
  }
  return null
}

async function login({ email, password }: LoginInput): Promise<LoginResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    return {
      ok: false,
      status: error.status,
      providerMessage: error.message,
    }
  }
  return { ok: true, user: data.user ? toSessionUser(data.user) : undefined }
}

async function logout(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
}

export const supabaseAuthService: AuthService = {
  getUser: fetchUser,
  login,
  logout,
}
