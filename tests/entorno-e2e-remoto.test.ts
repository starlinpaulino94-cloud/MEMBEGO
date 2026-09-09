import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verificarEntornoE2E } from '../scripts/verificar-entorno-e2e.mjs'

const project = 'abcdefghijklmnopqrst'
const jwt = (ref: string, role = 'service_role') =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ ref, role })).toString('base64url')}.synthetic`
const database = `postgresql://postgres.${project}:synthetic@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=3`
const direct = `postgresql://postgres:synthetic@db.${project}.supabase.co:5432/postgres`
const valid = {
  E2E_ISOLATED_APPROVED: 'si', E2E_REMOTE_APPROVED: 'si',
  E2E_ALLOWED_TEST_PROJECT_ID: project, E2E_TEST_PROJECT_ID: project,
  E2E_SUPABASE_URL: `https://${project}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_URL: `https://${project}.supabase.co`,
  E2E_BASE_URL: 'http://127.0.0.1:3210', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3210',
  E2E_SUPABASE_ANON_KEY: 'synthetic-anon', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon',
  E2E_SUPABASE_SERVICE_ROLE_KEY: jwt(project), SUPABASE_SERVICE_ROLE_KEY: jwt(project),
  E2E_TEST_DATABASE_URL: database, DATABASE_URL: database,
  E2E_TEST_DIRECT_URL: direct, DIRECT_URL: direct,
}

test('accepts remote when both provider endpoints and credential claim match explicit approval', () => {
  // Given / When
  const result = verificarEntornoE2E(valid)
  // Then
  assert.equal(result.status, 'PREREQUISITES_OK')
})

const rejected = [
  { E2E_REMOTE_APPROVED: '' },
  { E2E_ALLOWED_TEST_PROJECT_ID: '' },
  { E2E_TEST_DIRECT_URL: '' },
  { E2E_TEST_DATABASE_URL: `${database}&pool_timeout=30` },
  { DIRECT_URL: direct.replace(project, 'zyxwvutsrqponmlkjihgf') },
  { E2E_TEST_DIRECT_URL: direct.replace(project, 'zyxwvutsrqponmlkjihgf'), DIRECT_URL: direct.replace(project, 'zyxwvutsrqponmlkjihgf') },
  { E2E_TEST_DATABASE_URL: database.replace(project, 'zyxwvutsrqponmlkjihgf'), DATABASE_URL: database.replace(project, 'zyxwvutsrqponmlkjihgf') },
  { E2E_TEST_DATABASE_URL: database.replace('pooler.supabase.com', 'pooler.supabase.com.evil.invalid'), DATABASE_URL: database.replace('pooler.supabase.com', 'pooler.supabase.com.evil.invalid') },
  { E2E_TEST_DIRECT_URL: `${direct}?host=remote.invalid`, DIRECT_URL: `${direct}?host=remote.invalid` },
  { E2E_TEST_DIRECT_URL: `${direct}?sslmode=disable`, DIRECT_URL: `${direct}?sslmode=disable` },
  { E2E_SUPABASE_SERVICE_ROLE_KEY: jwt('zyxwvutsrqponmlkjihgf'), SUPABASE_SERVICE_ROLE_KEY: jwt('zyxwvutsrqponmlkjihgf') },
  { E2E_SUPABASE_SERVICE_ROLE_KEY: jwt(project, 'anon'), SUPABASE_SERVICE_ROLE_KEY: jwt(project, 'anon') },
  { E2E_SUPABASE_SERVICE_ROLE_KEY: 'eyJ.invalid.invalid', SUPABASE_SERVICE_ROLE_KEY: 'eyJ.invalid.invalid' },
] as const

for (const [index, overrides] of rejected.entries()) {
  test(`blocks remote when approval, target or claim is invalid (${index})`, () => {
    // Given / When
    const result = verificarEntornoE2E({ ...valid, ...overrides })
    // Then
    assert.equal(result.status, 'BLOCKED')
    assert.equal(JSON.stringify(result).includes('synthetic'), false)
    assert.equal(JSON.stringify(result).includes('postgresql:'), false)
  })
}

test('accepts an explicitly approved session pooler direct URL', () => {
  // Given
  const session = database.replace(':6543/', ':5432/')
  // When
  const result = verificarEntornoE2E({ ...valid, E2E_TEST_DIRECT_URL: session, DIRECT_URL: session })
  // Then
  assert.equal(result.status, 'PREREQUISITES_OK')
})
