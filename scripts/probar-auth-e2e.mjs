import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { verificarEntornoE2E } from './verificar-entorno-e2e.mjs'

const result = verificarEntornoE2E(process.env)
console.log(JSON.stringify({ ...result, scope: 'auth-shell-prerequisite' }))
if (result.status !== 'PREREQUISITES_OK') {
  process.exitCode = 1
} else {
  const require = createRequire(import.meta.url)
  const cli = require.resolve('@playwright/test/cli')
  const commands = [
    ['test', 'sidebar-auth.setup.ts', '--project=setup'],
    ['test', 'sidebar-niveles.spec.ts', '--project=movil', '--project=escritorio'],
  ]
  for (const args of commands) {
    const run = spawnSync(process.execPath, [cli, ...args], {
      stdio: 'inherit', timeout: 600_000,
    })
    if (run.status !== 0) {
      console.log(JSON.stringify({ status: 'AUTH_GATE_FAILED', code: 'PLAYWRIGHT_FAILED' }))
      process.exitCode = 1
      break
    }
  }
}
