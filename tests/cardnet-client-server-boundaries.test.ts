import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import type { SessionUser } from '../src/types'

type Row = Record<string, unknown>
interface Scenario {
  tx: unknown
  authUser: SessionUser
  membership: Row | null
  sessions: Map<string, Row>
  reservations: Map<string, Row>
  config: Row
  customerResponse: Row
  searchResponse: Row
  amountResult: { readonly ok: true; readonly pesos: number }
  canCharge: boolean
  providerCalls: number
  customerGets: number
  customerIdLookups: number
  targetReads: number
  amountLookups: number
  chargeCalls: number
  intentCreates: number
  chargeResults: Array<unknown | null>
  chargeRequests: Array<{ readonly purchaseUniqueId: unknown; readonly order: unknown; readonly amount: unknown }>
  purchaseSearches: Row[]
}

const stub = pathToFileURL(path.resolve('tests/support/cardnet-service-stub.mjs')).href
const serverOnly = pathToFileURL(path.resolve('tests/support/server-only-stub.mjs')).href
const mocked = new Set([
  '@/lib/tenant', '@/lib/auth/api-guard', '@/lib/payments/cardnet-tokens',
  '@/modules/pagos/cardnet3ds', '@/modules/pagos/cardnetToken', '@/modules/pagos/intentos',
  '@/modules/promociones/compraService', '@/lib/rate-limit',
])
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'server-only') return { url: serverOnly, shortCircuit: true }
    if (mocked.has(specifier)) return { url: stub, shortCircuit: true }
    return next(specifier, context)
  },
})

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key]
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const filter = expected as Row
      if (Array.isArray(filter.in)) return filter.in.includes(actual)
      if (filter.lt instanceof Date) return actual instanceof Date && actual < filter.lt
      if (filter.gt instanceof Date) return actual instanceof Date && actual > filter.gt
      if (filter.lte instanceof Date) return actual instanceof Date && actual <= filter.lte
      return true
    }
    return actual === expected
  })
}

function setup(): Scenario {
  const s: Scenario = {
    tx: null,
    authUser: {
      supabaseId: 'qa-user', email: 'qa@example.test',
      metadata: { role: 'CLIENTE', dbUserId: 'qa-db-user', clienteId: 'qa-client', companyId: 'qa-company' },
    },
    membership: null, sessions: new Map(), reservations: new Map(),
    config: { captureUrl: 'https://lab.cardnet.com.do', scriptUrl: 'https://tr-tsp-test.gtp-seglan.com/widget.js', publicKey: 'sandbox-public' },
    customerResponse: { denegado: false, email: 'qa@example.test', captureUrl: 'https://lab.cardnet.com.do', uniqueId: 'temporary-customer-id', perfiles: [] },
    searchResponse: { ok: true, json: { Response: { Purchases: [] } } },
    amountResult: { ok: true, pesos: 1000 },
    canCharge: true,
    providerCalls: 0, customerGets: 0, customerIdLookups: 0, targetReads: 0,
    amountLookups: 0, chargeCalls: 0, intentCreates: 0,
    chargeResults: [], chargeRequests: [], purchaseSearches: [],
  }
  s.tx = {
    membership: {
      findUnique: async () => { s.targetReads += 1; return s.membership },
      updateMany: async () => ({ count: 1 }),
    },
    productoCompra: { findUnique: async () => null },
    cardnetCaptureSession: {
      findFirst: async (input: { where: Row }) => [...s.sessions.values()].find((row) => matches(row, input.where)) ?? null,
      findUnique: async (input: { where: Row }) => s.reservations.get(String(input.where.reservaClienteKey ?? '')) ?? null,
      create: async (input: { data: Row }) => {
        const key = String(input.data.reservaClienteKey ?? '')
        if (s.reservations.has(key)) throw new Error('unique reservation constraint')
        const client = s.membership?.cliente
        const cliente = client && typeof client === 'object' ? client as Row : {}
        const row: Row = { ...input.data, estado: 'STARTING', createdAt: new Date(), updatedAt: new Date(),
          cliente: { email: cliente.email ?? 'qa@example.test', cardnetCustomerId: null }, purchaseIntent: null }
        s.sessions.set(String(row.id), row); s.reservations.set(key, row); return row
      },
      updateMany: async (input: { where: Row; data: Row }) => {
        const row = [...s.sessions.values()].find((candidate) => matches(candidate, input.where))
        if (!row) return { count: 0 }
        Object.assign(row, input.data)
        if (!('updatedAt' in input.data)) row.updatedAt = new Date()
        if (input.data.reservaClienteKey === null) s.reservations.delete(String(row.reservaClienteKey ?? ''))
        return { count: 1 }
      },
      update: async (input: { where: Row; data: Row }) => {
        const row = [...s.sessions.values()].find((candidate) => matches(candidate, input.where))
        if (!row) throw new Error('capture session missing')
        Object.assign(row, input.data); row.updatedAt = new Date(); return row
      },
    },
    pagoIntento: {
      create: async (input: { data: Row }) => ({ id: 'intent-' + (++s.intentCreates), ...input.data }),
      updateMany: async () => ({ count: 1 }),
    },
    tarjetaTokenizada: { upsert: async () => ({ id: 'tokenized-card-test' }) },
  }
  Object.assign(globalThis, { __cardnetServiceScenario: s })
  return s
}

function membership(owner = 'qa-user'): Row {
  return { id: 'membership-test', companyId: 'qa-company', clienteId: 'qa-client',
    cliente: { supabaseId: owner, companyId: 'qa-company', email: 'qa@example.test', cardnetCustomerId: null, esLocal: false } }
}
async function service() { return import('../src/modules/pagos/cardnetCliente') }

test('mixed targets and a client-supplied baseline fail before DB/provider access', async () => {
  const s = setup()
  const api = await service()
  const mixed = await api.iniciarSesionCardnet(new Request('http://localhost/session'), s.authUser, {
    membershipId: 'membership-test', compraId: 'purchase-test',
  })
  const baseline = await api.iniciarSesionCardnet(new Request('http://localhost/session'), s.authUser, {
    membershipId: 'membership-test', conteoAntes: 0,
  })
  assert.equal(mixed.status, 400)
  assert.equal(baseline.status, 400)
  assert.equal(s.targetReads, 0)
  assert.equal(s.providerCalls, 0)
})

test('a foreign membership is hidden before CardNET is called', async () => {
  const s = setup()
  s.membership = membership('another-user')
  const api = await service()
  const result = await api.iniciarSesionCardnet(new Request('http://localhost/session'), s.authUser, {
    membershipId: 'membership-test',
  })
  assert.equal(result.status, 404)
  assert.equal(s.targetReads, 1)
  assert.equal(s.providerCalls, 0)
})

test('capture nonce is consumed once and replay does not issue another Customer GET', async () => {
  const s = setup()
  const nonce = 'nonce-for-this-capture-session-012345'
  const id = 's'.repeat(48)
  const row: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: null, compraId: 'purchase-test', monto: 1000, moneda: 'DOP',
    estado: 'CAPTURE_OPEN', venceAt: new Date(Date.now() + 60_000),
    captureNonce: createHash('sha256').update(nonce).digest('hex'),
    customerId: 'cardnet-customer-test', customerUniqueId: 'temporary-customer-id',
    perfilBase: [], paymentProfileId: null, createdAt: new Date(), updatedAt: new Date(),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null }, purchaseIntent: null,
    reservaClienteKey: 'held-reservation',
  }
  s.sessions.set(id, row)
  s.reservations.set('held-reservation', row)
  const api = await service()
  const submit = () => api.confirmarSesionCardnet(new Request('http://localhost/confirm'), s.authUser, {
    sessionId: id, captureNonce: nonce, token: 'one-time-capture-token-value',
  })
  const first = await submit()
  const replay = await submit()
  assert.equal(first.status, 202)
  assert.equal(first.body.status, 'pending')
  assert.equal(replay.status, 409)
  assert.equal(s.customerGets, 1)
  assert.equal(row.estado, 'PROFILE_PENDING')
  assert.equal(row.reservaClienteKey, 'held-reservation')
})

test('concurrent starts reserve one customer session and perform one Customer GET', async () => {
  const s = setup()
  s.membership = membership()
  const api = await service()
  const start = () => api.iniciarSesionCardnet(new Request('http://localhost/session'), s.authUser, {
    membershipId: 'membership-test',
  })
  const results = await Promise.all([start(), start()])
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409])
  assert.equal(s.customerIdLookups, 1)
  assert.equal(s.customerGets, 1)
  assert.equal(s.sessions.size, 1)
  assert.equal(s.reservations.size, 1)
})

test('ambiguous retries retain the Purchase UniqueID and serialize concurrent charges', async () => {
  const s = setup()
  s.customerResponse = {
    denegado: false, email: 'qa@example.test',
    perfiles: [{ paymentProfileId: 'profile-test', token: 'server-profile-token-test', habilitado: true }],
  }
  s.chargeResults = [null, null]
  const id = 'p'.repeat(48)
  const stableUniqueId = 'persisted-purchase-unique-id'
  const row: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: null, compraId: 'purchase-test', monto: 1000, moneda: 'DOP',
    estado: 'PURCHASE_PENDING', venceAt: new Date(Date.now() + 60_000), captureNonce: null,
    customerId: 'cardnet-customer-test', customerUniqueId: 'temporary-customer-id',
    perfilBase: [], paymentProfileId: 'profile-test',
    createdAt: new Date(Date.now() - 120_000), updatedAt: new Date(Date.now() - 90_000),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null },
    purchaseIntent: { id: 'intent-persisted', cardnetUniqueId: stableUniqueId },
    reservaClienteKey: 'held-customer-reservation',
  }
  s.sessions.set(id, row)
  s.reservations.set('held-customer-reservation', row)
  const api = await service()
  const status = () => api.estadoSesionCardnet(s.authUser, id, new Request('http://localhost/status'))
  const concurrent = await Promise.all([status(), status()])
  assert.ok(concurrent.every((result) => result.status === 202 && result.body.status === 'pending'))
  assert.equal(s.chargeCalls, 1)
  assert.deepEqual(s.chargeRequests.map((call) => call.purchaseUniqueId), [stableUniqueId])
  assert.equal(row.reservaClienteKey, 'held-customer-reservation')

  row.updatedAt = new Date(Date.now() - 90_000)
  const retry = await status()
  assert.equal(retry.status, 202)
  assert.equal(retry.body.status, 'pending')
  assert.equal(s.chargeCalls, 2)
  assert.deepEqual(s.chargeRequests.map((call) => call.purchaseUniqueId), [stableUniqueId, stableUniqueId])
  assert.equal(s.intentCreates, 0)
  assert.equal(row.reservaClienteKey, 'held-customer-reservation')
})

test('the real BFF route rejects a request without Bearer before calling the service', async () => {
  const s = setup()
  const route = await import('../src/app/api/v1/cliente/pagos/cardnet/sesion/route')
  const response = await route.POST(new Request('http://localhost/api/v1/cliente/pagos/cardnet/sesion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }))
  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { ok: false, error: 'No autorizado.' })
  assert.equal(s.providerCalls, 0)
  assert.equal(s.targetReads, 0)
})
