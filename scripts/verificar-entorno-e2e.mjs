import { pathToFileURL } from 'node:url'
import { z } from 'zod'

const required = z.string().trim().min(1)
const schema = z.object({
  E2E_ISOLATED_APPROVED: z.literal('si'),
  E2E_ALLOWED_TEST_PROJECT_ID: z.string().regex(/^[a-z]{20}$/),
  E2E_TEST_PROJECT_ID: z.string().regex(/^[a-z]{20}$/),
  E2E_SUPABASE_URL: required,
  NEXT_PUBLIC_SUPABASE_URL: required,
  E2E_BASE_URL: required,
  NEXT_PUBLIC_APP_URL: required,
  E2E_SUPABASE_ANON_KEY: required,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required,
  E2E_SUPABASE_SERVICE_ROLE_KEY: required,
  SUPABASE_SERVICE_ROLE_KEY: required,
  E2E_TEST_DATABASE_URL: required,
  E2E_TEST_DIRECT_URL: z.string().optional(),
  E2E_REMOTE_APPROVED: z.string().optional(),
  DATABASE_URL: required,
  DIRECT_URL: required,
})

/** @param {string} value @param {string} project */
function approvedDatabase(value, project) {
  const url = URL.parse(value)
  if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) || url.hash
    || url.pathname.length < 2) return false
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return !url.search
  const direct = url.hostname === `db.${project}.supabase.co` && url.port === '5432'
  const pooler = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)
    && ['5432', '6543'].includes(url.port) && url.username.endsWith(`.${project}`)
  if (!(direct || pooler) || url.pathname !== '/postgres' || !url.password) return false
  for (const [key, value] of url.searchParams) {
    if (url.searchParams.getAll(key).length !== 1) return false
    if (!['pgbouncer', 'connection_limit', 'connect_timeout', 'pool_timeout', 'sslmode', 'schema', 'statement_cache_size'].includes(key)) return false
    if (key === 'sslmode' && !['require', 'verify-ca', 'verify-full'].includes(value)) return false
    if (key === 'schema' && value !== 'public') return false
  }
  return true
}

/** @param {unknown} input */
export function verificarEntornoE2E(input) {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return {
      status: 'BLOCKED',
      issues: parsed.error.issues.map((issue) => ({
        variable: String(issue.path[0]), code: 'REQUIRED_OR_INVALID',
      })),
    }
  }
  const env = parsed.data
  /** @type {{ variable: string, code: string }[]} */
  const issues = []
  if (env.E2E_TEST_PROJECT_ID !== env.E2E_ALLOWED_TEST_PROJECT_ID) {
    issues.push({ variable: 'E2E_TEST_PROJECT_ID', code: 'PROJECT_NOT_ALLOWLISTED' })
  }
  if (env.E2E_SUPABASE_URL !== `https://${env.E2E_ALLOWED_TEST_PROJECT_ID}.supabase.co`) {
    issues.push({ variable: 'E2E_SUPABASE_URL', code: 'PROJECT_URL_MISMATCH' })
  }
  const base = URL.parse(env.E2E_BASE_URL)
  if (!base || !['http:', 'https:'].includes(base.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
    || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    issues.push({ variable: 'E2E_BASE_URL', code: 'LOCAL_ORIGIN_REQUIRED' })
  }
  const direct = env.E2E_TEST_DIRECT_URL ?? env.E2E_TEST_DATABASE_URL
  const localTargets = [env.E2E_TEST_DATABASE_URL, direct].map((value) =>
    ['localhost', '127.0.0.1', '[::1]'].includes(URL.parse(value)?.hostname ?? ''))
  if (localTargets.some(Boolean) && !localTargets.every(Boolean)) {
    issues.push({ variable: 'E2E_TEST_DIRECT_URL', code: 'MIXED_DATABASE_TARGETS' })
  }
  for (const variable of ['E2E_TEST_DATABASE_URL', 'E2E_TEST_DIRECT_URL']) {
    const value = variable === 'E2E_TEST_DATABASE_URL' ? env.E2E_TEST_DATABASE_URL : direct
    const url = URL.parse(value)
    const remote = url && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (remote && (env.E2E_REMOTE_APPROVED !== 'si' || !env.E2E_TEST_DIRECT_URL)) {
      issues.push({ variable: 'E2E_REMOTE_APPROVED', code: 'EXPLICIT_REMOTE_APPROVAL_REQUIRED' })
    }
    if (!approvedDatabase(value, env.E2E_ALLOWED_TEST_PROJECT_ID)) {
      issues.push({ variable, code: 'DATABASE_PROJECT_MISMATCH' })
    }
  }
  const service = env.E2E_SUPABASE_SERVICE_ROLE_KEY
  if (service.includes('.')) {
    try {
      const payload = service.split('.')[1] ?? ''
      const claim = z.object({ ref: z.literal(env.E2E_ALLOWED_TEST_PROJECT_ID), role: z.literal('service_role') })
        .safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))
      if (!claim.success) issues.push({ variable: 'E2E_SUPABASE_SERVICE_ROLE_KEY', code: 'CREDENTIAL_CLAIM_MISMATCH' })
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      issues.push({ variable: 'E2E_SUPABASE_SERVICE_ROLE_KEY', code: 'CREDENTIAL_CLAIM_INVALID' })
    }
  }
  /** @type {readonly (readonly [string, string, string])[]} */
  const pairs = [
    ['NEXT_PUBLIC_SUPABASE_URL', env.NEXT_PUBLIC_SUPABASE_URL, env.E2E_SUPABASE_URL],
    ['NEXT_PUBLIC_APP_URL', env.NEXT_PUBLIC_APP_URL, env.E2E_BASE_URL],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', env.NEXT_PUBLIC_SUPABASE_ANON_KEY, env.E2E_SUPABASE_ANON_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY, env.E2E_SUPABASE_SERVICE_ROLE_KEY],
    ['DATABASE_URL', env.DATABASE_URL, env.E2E_TEST_DATABASE_URL],
    ['DIRECT_URL', env.DIRECT_URL, direct],
  ]
  for (const [variable, actual, approved] of pairs) {
    if (actual !== approved) {
      issues.push({ variable, code: 'APP_TEST_MISMATCH' })
    }
  }
  return { status: issues.length ? 'BLOCKED' : 'PREREQUISITES_OK', issues }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = verificarEntornoE2E(process.env)
  console.log(JSON.stringify({ ...result, scope: 'configuration-only',
    action: 'Configure las variables indicadas con un entorno aislado aprobado; no cargar produccion.' }))
  process.exitCode = result.status === 'PREREQUISITES_OK' ? 0 : 1
}
