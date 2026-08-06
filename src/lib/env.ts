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

/** Returns the list of missing required public env vars (for diagnostics). */
export function missingPublicEnv(): string[] {
  return REQUIRED_PUBLIC.filter((k) => !process.env[k])
}

/** Returns the list of missing required server env vars (for diagnostics). */
export function missingServerEnv(): string[] {
  return REQUIRED_SERVER.filter((k) => !process.env[k])
}
