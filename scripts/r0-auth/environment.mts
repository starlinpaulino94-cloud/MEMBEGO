import { readFileSync, existsSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { z } from 'zod'
import { verificarEntornoE2E } from '../verificar-entorno-e2e.mjs'

export function configuredEnvironment(root: string) {
  const loaded: Record<string, string | undefined> = {}
  for (const file of ['.env', '.env.local']) {
    const path = `${root}/${file}`
    if (existsSync(path)) Object.assign(loaded, parseEnv(readFileSync(path, 'utf8')))
  }
  return { ...loaded, ...process.env }
}

export const credentialsSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
})

export function approvedEnvironment(root: string) {
  const approval = z.object({ project: z.string().regex(/^[a-z]{20}$/),
    approval: z.literal('es exclusivamente de pruebas puedes proseder'),
    scope: z.literal('run-owned-fixtures-only') }).parse(
    JSON.parse(readFileSync(`${root}/.omo/start-work/r0-auth-approval.json`, 'utf8')),
  )
  if (!process.argv.includes(`--project=${approval.project}`)
    || !process.argv.includes('--approve-scoped-fixtures')) return null
  const source = credentialsSchema.safeParse(configuredEnvironment(root))
  if (!source.success) return null
  const env = { ...source.data, E2E_ISOLATED_APPROVED: 'si', E2E_REMOTE_APPROVED: 'si',
    E2E_ALLOWED_TEST_PROJECT_ID: approval.project, E2E_TEST_PROJECT_ID: approval.project,
    E2E_SUPABASE_URL: source.data.NEXT_PUBLIC_SUPABASE_URL,
    E2E_SUPABASE_ANON_KEY: source.data.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    E2E_SUPABASE_SERVICE_ROLE_KEY: source.data.SUPABASE_SERVICE_ROLE_KEY,
    E2E_TEST_DATABASE_URL: source.data.DATABASE_URL, E2E_TEST_DIRECT_URL: source.data.DIRECT_URL,
    E2E_BASE_URL: 'http://127.0.0.1:3217', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3217',
  }
  const result = verificarEntornoE2E(env)
  process.stdout.write(`${JSON.stringify({ ...result, project: approval.project })}\n`)
  return result.status === 'PREREQUISITES_OK' ? env : null
}

if (process.argv.includes('--identify-only')) {
  const parsed = credentialsSchema.safeParse(configuredEnvironment(process.cwd()))
  if (!parsed.success) {
    process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', variables: parsed.error.issues.map((i) => i.path[0]) })}\n`)
    process.exitCode = 1
  } else {
    const match = /^https:\/\/([a-z]{20})\.supabase\.co\/?$/.exec(parsed.data.NEXT_PUBLIC_SUPABASE_URL)
    process.stdout.write(`${JSON.stringify({ status: match ? 'IDENTIFIED_NOT_APPROVED' : 'BLOCKED', project: match?.[1] ?? null })}\n`)
  }
}
