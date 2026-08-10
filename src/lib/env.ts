/**
 * Centralized environment variable validation. Imported by Supabase clients so
 * that a missing/wrong configuration fails loudly with a clear message instead
 * of throwing obscure errors deep inside the SDK at runtime.
 */

const REQUIRED_PUBLIC = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const
const REQUIRED_SERVER = ['SUPABASE_SERVICE_ROLE_KEY'] as const

export function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL')
  return url
}

export function getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!key) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_ANON_KEY')
  return key
}

export function getSupabaseServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Missing env var: SUPABASE_SERVICE_ROLE_KEY')
  return key
}

/**
 * JWT signing secret of the Supabase project (Auth → JWT settings).
 * Used to verify access tokens locally (edge middleware + server) without a
 * network round-trip. Not required yet: local verification degrades to the
 * SDK path when this variable is absent.
 */
export function getSupabaseJwtSecret(): string {
  const key = process.env.SUPABASE_JWT_SECRET
  if (!key) throw new Error('Missing env var: SUPABASE_JWT_SECRET')
  return key
}

/** Whether `SUPABASE_JWT_SECRET` is configured (allows skipping local JWT checks). */
export function hasSupabaseJwtSecret(): boolean {
  return Boolean(process.env.SUPABASE_JWT_SECRET)
}

/**
 * Signing key for the platform API access tokens (`/api/platform/v1`).
 *
 * Returns `null` when absent, and the API answers 503 instead of falling back
 * to a derived or default key. A weak default here would be the difference
 * between "the API is off" and "the API is on and anyone can mint a token" —
 * and only one of those two is visible from the outside.
 *
 * Generate with: `openssl rand -base64 48`.
 */
export function getPlatformTokenSecret(): string | null {
  const key = process.env.PLATFORM_TOKEN_SECRET
  return key && key.length >= 32 ? key : null
}

/**
 * Ed25519 private key used to sign outbound platform events.
 *
 * Returns the raw value; parsing lives in `modules/plataforma/firma.ts`.
 *
 * Absent is a supported state, and unlike `PLATFORM_TOKEN_SECRET` it does NOT
 * fail closed: without it, events keep going out signed with the shared-secret
 * HMAC exactly as they do today. Failing closed here would stop delivering
 * webhooks to satellites that never asked for the new signature.
 */
export function getPlatformEventPrivateKey(): string | undefined {
  return process.env.PLATFORM_EVENT_PRIVATE_KEY
}

/** Returns the list of missing required public env vars (for diagnostics). */
export function missingPublicEnv(): string[] {
  return REQUIRED_PUBLIC.filter((k) => !process.env[k])
}

/** Returns the list of missing required server env vars (for diagnostics). */
export function missingServerEnv(): string[] {
  return REQUIRED_SERVER.filter((k) => !process.env[k])
}
