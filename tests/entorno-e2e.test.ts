import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { verificarEntornoE2E } from '../scripts/verificar-entorno-e2e.mjs'

const project = 'abcdefghijklmnopqrst'
const url = `https://${project}.supabase.co`
const valid = {
  E2E_ISOLATED_APPROVED: 'si',
  E2E_ALLOWED_TEST_PROJECT_ID: project,
  E2E_TEST_PROJECT_ID: project,
  E2E_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_URL: url,
  E2E_BASE_URL: 'http://localhost:3210',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3210',
  E2E_SUPABASE_ANON_KEY: 'synthetic-anon-credential',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon-credential',
  E2E_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-credential',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-credential',
  E2E_TEST_DATABASE_URL: 'postgresql://tester:synthetic@localhost:5432/e2e',
  DATABASE_URL: 'postgresql://tester:synthetic@localhost:5432/e2e',
  DIRECT_URL: 'postgresql://tester:synthetic@localhost:5432/e2e',
}

test('blocks when environment is missing', () => {
  // Given / When
  const result = verificarEntornoE2E({})
  // Then
  assert.equal(result.status, 'BLOCKED')
  assert.ok(result.issues.some((issue) => issue.variable === 'E2E_ALLOWED_TEST_PROJECT_ID'))
})

test('accepts when isolated configuration is explicitly approved (synthetic only)', () => {
  // Given / When
  const result = verificarEntornoE2E(valid)
  // Then
  assert.equal(result.status, 'PREREQUISITES_OK')
  assert.deepEqual(result.issues, [])
})

const rejected = [
  ['E2E_ISOLATED_APPROVED', ''],
  ['E2E_ALLOWED_TEST_PROJECT_ID', ''],
  ['E2E_TEST_PROJECT_ID', 'zyxwvutsrqponmlkjihgf'],
  ['E2E_SUPABASE_URL', 'https://zyxwvutsrqponmlkjihgf.supabase.co'],
  ['E2E_SUPABASE_URL', 'https://e2e.supabase.co'],
  ['E2E_SUPABASE_URL', 'https://TU-PROYECTO.supabase.co'],
  ['E2E_SUPABASE_URL', `${url}.evil.invalid`],
  ['E2E_SUPABASE_URL', `https://secret@${project}.supabase.co`],
  ['NEXT_PUBLIC_SUPABASE_URL', 'https://production.supabase.co'],
  ['E2E_BASE_URL', 'https://membego.com'],
  ['E2E_BASE_URL', 'http://localhost.evil.invalid:3210'],
  ['E2E_BASE_URL', 'http://secret@localhost:3210'],
  ['NEXT_PUBLIC_APP_URL', 'https://membego.com'],
  ['E2E_SUPABASE_ANON_KEY', ''],
  ['E2E_SUPABASE_SERVICE_ROLE_KEY', ''],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'wrong-key'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'wrong-key'],
  ['DATABASE_URL', 'postgresql://secret:secret@remote.invalid/e2e'],
  ['DIRECT_URL', 'postgresql://secret:secret@remote.invalid/e2e'],
  ['E2E_TEST_DATABASE_URL', ''],
] as const

for (const [index, [variable, value]] of rejected.entries()) {
  test(`blocks when ${variable} is missing or unsafe (case ${index})`, () => {
    // Given
    const env = { ...valid, [variable]: value }
    // When
    const result = verificarEntornoE2E(env)
    // Then
    assert.equal(result.status, 'BLOCKED')
    assert.ok(result.issues.some((issue) => issue.variable === variable))
    assert.equal(JSON.stringify(result).includes('synthetic-service-credential'), false)
    assert.equal(JSON.stringify(result).includes('secret@'), false)
  })
}

for (const [name, env, status] of [
  ['missing', {}, 1],
  ['synthetic valid', valid, 0],
] as const) {
  test(`CLI returns structured status when configuration is ${name}`, (context) => {
    // Given / When: deliberately no inherited project environment or dotenv.
    const result = spawnSync(process.execPath, ['scripts/verificar-entorno-e2e.mjs'], {
      env: { ...env, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 10_000,
    })
    // Then
    assert.equal(result.status, status)
    assert.doesNotThrow(() => JSON.parse(result.stdout))
    assert.equal(result.stdout.includes('synthetic-service-credential'), false)
    assert.equal(result.stderr, '')
    context.diagnostic(`CLI proof (${name}, not live QA): exit=${result.status} ${result.stdout.trim()}`)
  })
}

test('authenticated gate blocks before Playwright when isolation is unconfigured', () => {
  // Given / When
  const result = spawnSync(process.execPath, ['scripts/probar-auth-e2e.mjs'], {
    env: { NODE_ENV: 'test' }, encoding: 'utf8', timeout: 10_000,
  })
  // Then
  assert.equal(result.status, 1)
  assert.match(result.stdout, /"status":"BLOCKED"/)
  assert.equal(result.stderr, '')
})
