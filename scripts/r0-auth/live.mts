import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Prisma, PrismaClient } from '@prisma/client'
import { createClient } from '@supabase/supabase-js'
import { approvedEnvironment } from './environment.mjs'
import { attestCatalog } from './catalog.mjs'
import { RunFixtures, VerificationFailure } from './fixtures.mjs'
import { OwnedApp } from './app.mjs'
import { verifyBrowser } from './browser.mjs'

const env = approvedEnvironment(process.cwd())
if (!env) {
  process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', code: 'EXPLICIT_APPROVAL_OR_CONFIGURATION_REQUIRED' })}\n`)
  process.exitCode = 1
} else {
  const runId = `live-${randomUUID()}`
  const folder = resolve('.omo/start-work/r0-auth', runId)
  mkdirSync(folder, { recursive: true })
  const fingerprintPaths = ['scripts/verificar-home-e2e.mts', 'src/app/(admin)/admin/dashboard/page.tsx',
    'src/modules/admin/dashboardQueries.ts', 'tests/definiciones-unicas.test.ts', 'src/lib/auth/guards.ts',
    'src/lib/auth/permissions.ts', 'src/lib/tenant.ts', 'src/proxy.ts', 'next.config.ts']
  const before = Object.fromEntries(fingerprintPaths.map((file) => [file,
    createHash('sha256').update(readFileSync(file)).digest('hex')]))
  writeFileSync(join(folder, 'baseline.json'), JSON.stringify(before, null, 2))
  const url = new URL(env.DIRECT_URL)
  url.searchParams.set('connect_timeout', '10')
  url.searchParams.set('connection_limit', '1')
  const db = new PrismaClient({ datasourceUrl: url.href, log: [] })
  const auth = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) } })
  const fixtures = new RunFixtures(db, auth)
  const app = new OwnedApp(join(tmpdir(), 'opencode', `r0-${runId}`))
  writeFileSync(join(folder, 'ownership.json'), JSON.stringify({ runId, suffix: fixtures.suffix,
    companyIds: [fixtures.companyA, fixtures.companyB], clientIds: [fixtures.clientA, fixtures.clientB] }, null, 2))
  let fixturesStarted = false
  try {
    const catalog = await attestCatalog(db)
    writeFileSync(join(folder, 'catalog.json'), JSON.stringify(catalog, null, 2))
    writeFileSync(join(folder, 'rls.json'), JSON.stringify({ status: 'BLOCKED',
      reason: catalog.restrictedRoleAvailable ? 'RESTRICTED_PATH_NOT_YET_EXERCISED' : 'RESTRICTED_ROLE_MISSING',
      bypassConnection: catalog.roles.some((r) => r.connection && r.bypass), liveRlsProven: false }, null, 2))
    const needed = ['companies', 'users', 'clientes', 'plans', 'memberships', 'home_revisiones', 'home_bloques']
    if (needed.some((name) => !catalog.tables.some((table) => table.name === name))) {
      throw new VerificationFailure('REQUIRED_SCHEMA_MISSING')
    }
    await app.start(env)
    writeFileSync(join(folder, 'process.json'), JSON.stringify({ pid: app.process?.pid, port: app.port,
      snapshot: app.directory, mode: 'isolated-next-dev-webpack' }))
    fixturesStarted = true
    const owned = await fixtures.create()
    writeFileSync(join(folder, 'fixtures.json'), JSON.stringify(owned, null, 2))
    const browser = await verifyBrowser(fixtures, env, folder)
    writeFileSync(join(folder, 'auth.json'), JSON.stringify({ runId, project: env.E2E_TEST_PROJECT_ID, ...browser }, null, 2))
    process.stdout.write(`${JSON.stringify({ runId, ...browser })}\n`)
    process.exitCode = 1
  } catch (error) {
    const code = error instanceof VerificationFailure ? error.code
      : error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'EXTERNAL_PREREQUISITE_UNAVAILABLE'
    writeFileSync(join(folder, 'blocked.json'), JSON.stringify({ runId, status: 'BLOCKED', code }))
    process.stdout.write(`${JSON.stringify({ runId, status: 'BLOCKED', code })}\n`)
    process.exitCode = 1
  } finally {
    const server = await app.close()
    try {
      const cleanup = fixturesStarted ? await fixtures.cleanup() : { status: 'PASS', remaining: 0, noFixturesCreated: true }
      writeFileSync(join(folder, 'cleanup.json'), JSON.stringify({ runId, server, ...cleanup }, null, 2))
      process.stdout.write(`${JSON.stringify({ runId, cleanup, server })}\n`)
    } catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'CLEANUP_UNAVAILABLE'
      writeFileSync(join(folder, 'cleanup.json'), JSON.stringify({ runId, status: 'FAIL', code, server }))
      process.stdout.write(`${JSON.stringify({ runId, cleanup: 'FAIL', code })}\n`)
    } finally {
      await db.$disconnect()
      const after = Object.fromEntries(fingerprintPaths.map((file) => [file,
        createHash('sha256').update(readFileSync(file)).digest('hex')]))
      writeFileSync(join(folder, 'after.json'), JSON.stringify({ fingerprints: after,
        unchanged: JSON.stringify(before) === JSON.stringify(after), dbDisconnected: true }, null, 2))
    }
  }
}
