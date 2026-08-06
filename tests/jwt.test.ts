/**
 * Local access-token verification (`src/lib/auth/jwt.ts`).
 *
 * This is the edge-safe path that lets the middleware trust a session without
 * calling Supabase Auth, and the fail-safe used by `getUser` during transient
 * auth outages. It verifies the HS256 signature of the token stored in the
 * `sb-<ref>-auth-token` cookie against `SUPABASE_JWT_SECRET`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SignJWT, base64url } from 'jose'
import { verifyLocalSession } from '../src/lib/auth/jwt'

const SECRET = 'super-secret-jwt-signing-key-for-tests'
const PROJECT_REF = 'testref'
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`

process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL
process.env.SUPABASE_JWT_SECRET = SECRET

const now = () => Math.floor(Date.now() / 1000)

function authCookieName(): string {
  return `sb-${PROJECT_REF}-auth-token`
}

async function buildSessionValue(payload: Record<string, unknown>, expiresInS: number): Promise<string> {
  const accessToken = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(now() + expiresInS)
    .sign(new TextEncoder().encode(SECRET))
  const session = {
    access_token: accessToken,
    refresh_token: 'refresh-token-value',
    expires_at: now() + expiresInS,
  }
  return `base64-${base64url.encode(JSON.stringify(session))}`
}

test('accepts a fresh, correctly signed token and maps app_metadata', async () => {
  const cookie = await buildSessionValue(
    {
      sub: 'user-123',
      email: 'owner@membego.com',
      app_metadata: { role: 'ADMINISTRADOR', dbUserId: 'db-1', companyId: 'co-1' },
    },
    3600
  )
  const local = await verifyLocalSession([{ name: authCookieName(), value: cookie }])
  assert.ok(local)
  assert.equal(local!.user.id, 'user-123')
  assert.equal(local!.user.email, 'owner@membego.com')
  assert.equal(local!.user.appMetadata.role, 'ADMINISTRADOR')
  assert.equal(local!.user.appMetadata.companyId, 'co-1')
})

test('reassembles chunked cookies (name.0, name.1, ...)', async () => {
  const cookie = await buildSessionValue(
    { sub: 'user-chunked', email: 'chunk@membego.com', app_metadata: { role: 'CLIENTE' } },
    3600
  )
  const half = Math.ceil(cookie.length / 2)
  const cookies = [
    { name: `${authCookieName()}.0`, value: cookie.slice(0, half) },
    { name: `${authCookieName()}.1`, value: cookie.slice(half) },
  ]
  const local = await verifyLocalSession(cookies)
  assert.ok(local)
  assert.equal(local!.user.id, 'user-chunked')
})

test('rejects an expired token', async () => {
  const cookie = await buildSessionValue({ sub: 'user-expired' }, -10)
  const local = await verifyLocalSession([{ name: authCookieName(), value: cookie }])
  assert.equal(local, null)
})

test('rejects a token signed with the wrong secret', async () => {
  const accessToken = await new SignJWT({ sub: 'user-forged' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(now() + 3600)
    .sign(new TextEncoder().encode('another-secret'))
  const session = {
    access_token: accessToken,
    expires_at: now() + 3600,
  }
  const cookie = `base64-${base64url.encode(JSON.stringify(session))}`
  const local = await verifyLocalSession([{ name: authCookieName(), value: cookie }])
  assert.equal(local, null)
})

test('rejects a tampered signature', async () => {
  const cookie = await buildSessionValue({ sub: 'user-valid', email: 'a@b.c' }, 3600)
  const decoded = new TextDecoder().decode(base64url.decode(cookie.slice('base64-'.length)))
  const session = JSON.parse(decoded)
  // Corrupt a MIDDLE character of the signature: flipping the last char with a
  // fixed replacement could be a no-op (if it already was that char), making
  // the test intermittently accept a tampered signature.
  const parts = session.access_token.split('.')
  const sig = parts[2]
  const mid = Math.floor(sig.length / 2)
  const corrupted = `${sig.slice(0, mid)}${sig[mid] === 'x' ? 'y' : 'x'}${sig.slice(mid + 1)}`
  session.access_token = `${parts[0]}.${parts[1]}.${corrupted}`
  const forged = `base64-${base64url.encode(JSON.stringify(session))}`
  const local = await verifyLocalSession([{ name: authCookieName(), value: forged }])
  assert.equal(local, null)
})

test('returns null when no session cookie is present', async () => {
  const local = await verifyLocalSession([{ name: 'other-cookie', value: 'x' }])
  assert.equal(local, null)
})

test('returns null for a malformed cookie value', async () => {
  const local = await verifyLocalSession([{ name: authCookieName(), value: 'not-base64!!' }])
  assert.equal(local, null)
})

test('degrades to null when SUPABASE_JWT_SECRET is not configured', async () => {
  const previous = process.env.SUPABASE_JWT_SECRET
  delete process.env.SUPABASE_JWT_SECRET
  try {
    const cookie = await buildSessionValue({ sub: 'user-x' }, 3600)
    const local = await verifyLocalSession([{ name: authCookieName(), value: cookie }])
    assert.equal(local, null)
  } finally {
    process.env.SUPABASE_JWT_SECRET = previous
  }
})
