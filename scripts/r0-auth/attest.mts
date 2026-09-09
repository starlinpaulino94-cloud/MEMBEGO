import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Prisma, PrismaClient } from '@prisma/client'
import { approvedEnvironment } from './environment.mjs'
import { attestCatalog } from './catalog.mjs'

const env = approvedEnvironment(process.cwd())
if (!env) {
  process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', code: 'EXPLICIT_APPROVAL_OR_CONFIGURATION_REQUIRED' })}\n`)
  process.exitCode = 1
} else {
  const runId = `attest-${randomUUID()}`
  const folder = `.omo/start-work/r0-auth/${runId}`
  mkdirSync(folder, { recursive: true })
  const fingerprint = Object.fromEntries([
    'scripts/verificar-home-e2e.mts', 'src/app/(admin)/admin/dashboard/page.tsx',
    'src/modules/admin/dashboardQueries.ts', 'tests/definiciones-unicas.test.ts',
    'src/lib/auth/guards.ts', 'src/lib/auth/permissions.ts', 'src/lib/tenant.ts', 'src/proxy.ts',
  ].map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]))
  writeFileSync(`${folder}/baseline.json`, JSON.stringify(fingerprint, null, 2))
  const url = new URL(env.DIRECT_URL)
  url.searchParams.set('connect_timeout', '10')
  url.searchParams.set('connection_limit', '1')
  const db = new PrismaClient({ datasourceUrl: url.href, log: [] })
  try {
    const metadata = await attestCatalog(db)
    writeFileSync(`${folder}/catalog.json`, JSON.stringify({ runId, project: env.E2E_TEST_PROJECT_ID,
      status: 'CATALOG_ATTESTED', ...metadata }, null, 2))
    process.stdout.write(`${JSON.stringify({ runId, status: 'CATALOG_ATTESTED', ...metadata })}\n`)
  } catch (error) {
    const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'CATALOG_UNAVAILABLE'
    writeFileSync(`${folder}/blocked.json`, JSON.stringify({ status: 'BLOCKED', code }))
    process.stdout.write(`${JSON.stringify({ runId, status: 'BLOCKED', code })}\n`)
    process.exitCode = 1
  } finally {
    await db.$disconnect()
    writeFileSync(`${folder}/cleanup.json`, JSON.stringify({ runId, dbDisconnected: true,
      createdAuthUsers: [], createdRows: [], createdProcesses: [], remainingOwnedFixtures: 0 }))
  }
}
