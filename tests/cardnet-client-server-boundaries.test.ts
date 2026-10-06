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
  amountResult: { readonly ok: true; readonly pesos: number } | { readonly ok: false; readonly motivo: string }
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
  '@/modules/cliente/afiliacion', '@/modules/notificaciones/service', '@/modules/storage/comprobantes',
  '@/modules/membresia/vigencia', '@/lib/bienvenida', '@/modules/elegibilidad',
  '@/modules/elegibilidad/decidir', '@/modules/membresia/prorrateo', '@/modules/marketplace/cached',
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
      updateMany: async (input: { where: Row; data: Row }) => {
        if (!s.membership || !matches(s.membership, input.where)) return { count: 0 }
        Object.assign(s.membership, input.data)
        return { count: 1 }
      },
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
        const previousReservationKey = row.reservaClienteKey
        Object.assign(row, input.data)
        if (!('updatedAt' in input.data)) row.updatedAt = new Date()
        if (input.data.reservaClienteKey === null) s.reservations.delete(String(previousReservationKey ?? ''))
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
    estado: 'PENDIENTE', planIdSolicitado: null, comprobanteUrl: null,
    cliente: { id: 'qa-client-db', nombre: 'Cliente QA', supabaseId: owner, companyId: 'qa-company', email: 'qa@example.test', cardnetCustomerId: null, esLocal: false } }
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
  s.membership = membership()
  const nonce = 'nonce-for-this-capture-session-012345'
  const id = 's'.repeat(48)
  const row: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: 'membership-test', compraId: null, monto: 1000, moneda: 'DOP',
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

test('a retry resumes the open capture session and rotates its one-use nonce', async () => {
  const s = setup()
  s.membership = membership()
  const api = await service()
  const start = () => api.iniciarSesionCardnet(new Request('http://localhost/session'), s.authUser, {
    membershipId: 'membership-test',
  })
  const original = await start()
  const resumed = await start()
  assert.equal(original.status, 200)
  assert.equal(resumed.status, 200)
  assert.equal(resumed.body.sessionId, original.body.sessionId)
  assert.notEqual(resumed.body.captureNonce, original.body.captureNonce)
  for (const privateField of ['customerId', 'cardnetCustomerId', 'perfilBase', 'paymentProfileId', 'reusableToken', 'privateKey', 'bearer']) {
    assert.equal(original.body[privateField], undefined, `${privateField} must stay server-side`)
  }
  const staleNonce = await api.confirmarSesionCardnet(new Request('http://localhost/confirm'), s.authUser, {
    sessionId: original.body.sessionId,
    captureNonce: original.body.captureNonce,
    token: 'one-time-capture-token-value',
  })
  assert.equal(staleNonce.status, 409)
  assert.equal(s.customerGets, 1)
  assert.equal([...s.sessions.values()][0]?.estado, 'CAPTURE_OPEN')
  assert.equal(s.sessions.size, 1)
  assert.equal(s.customerIdLookups, 1)
  assert.equal(s.customerGets, 1)
})

test('renewal consent is rejected for a plan change before CardNET calls', async () => {
  const s = setup()
  s.membership = { ...membership(), estado: 'ACTIVA', planIdSolicitado: 'new-plan' }
  const api = await service()
  const result = await api.iniciarSesionCardnet(new Request('http://localhost/session'), s.authUser, {
    membershipId: 'membership-test', guardarParaRenovacion: true,
  })
  assert.equal(result.status, 409)
  assert.equal(s.providerCalls, 0)
  assert.equal(s.sessions.size, 0)
})

test('a receipt expires an open CardNET capture before changing membership state', async () => {
  const s = setup()
  s.membership = membership()
  const id = 'r'.repeat(48)
  const open: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: 'membership-test', compraId: null, monto: 1000, moneda: 'DOP',
    estado: 'CAPTURE_OPEN', venceAt: new Date(Date.now() + 60_000), captureNonce: 'nonce-hash',
    reservaClienteKey: 'held-membership-reservation', updatedAt: new Date(),
  }
  s.sessions.set(id, open)
  s.reservations.set('held-membership-reservation', open)
  const memberships = await import('../src/modules/membresia/cliente-service')
  const result = await memberships.registrarComprobanteMembresiaCliente(s.authUser, {
    membershipId: 'membership-test', path: 'qa-receipts/membership-test/image.png',
  })
  assert.ok('success' in result)
  assert.equal(s.membership.estado, 'PENDIENTE_PAGO')
  assert.equal(open.estado, 'EXPIRED')
  assert.equal(open.captureNonce, null)
  assert.equal(open.reservaClienteKey, null)
  assert.equal(s.reservations.size, 0)
})

test('a receipt cannot advance a membership while CardNET capture is processing', async () => {
  const s = setup()
  s.membership = membership()
  const id = 'q'.repeat(48)
  const processing: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: 'membership-test', compraId: null, monto: 1000, moneda: 'DOP',
    estado: 'PROFILE_PENDING', venceAt: new Date(Date.now() + 60_000), captureNonce: null,
    reservaClienteKey: 'held-membership-reservation', updatedAt: new Date(),
  }
  s.sessions.set(id, processing)
  s.reservations.set('held-membership-reservation', processing)
  const memberships = await import('../src/modules/membresia/cliente-service')
  const result = await memberships.registrarComprobanteMembresiaCliente(s.authUser, {
    membershipId: 'membership-test', path: 'qa-receipts/membership-test/image.png',
  })
  assert.ok('error' in result)
  assert.equal(s.membership.estado, 'PENDIENTE')
  assert.equal(s.membership.comprobanteUrl, null)
  assert.equal(processing.estado, 'PROFILE_PENDING')
})

test('confirmation rechecks payable state after a receipt changes the membership', async () => {
  const s = setup()
  s.membership = membership()
  const nonce = 'nonce-for-this-capture-session-012345'
  const id = 'm'.repeat(48)
  const row: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: 'membership-test', compraId: null, monto: 1000, moneda: 'DOP',
    estado: 'CAPTURE_OPEN', venceAt: new Date(Date.now() + 60_000),
    captureNonce: createHash('sha256').update(nonce).digest('hex'),
    customerId: 'cardnet-customer-test', customerUniqueId: 'temporary-customer-id',
    perfilBase: [], paymentProfileId: null, createdAt: new Date(), updatedAt: new Date(),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null }, purchaseIntent: null,
    reservaClienteKey: 'held-membership-reservation',
  }
  s.sessions.set(id, row)
  s.reservations.set('held-membership-reservation', row)
  s.membership.estado = 'PENDIENTE_PAGO'
  s.membership.comprobanteUrl = 'receipts/membership-test/image.png'
  s.amountResult = { ok: false, motivo: 'Ya enviaste el comprobante.' }
  const api = await service()
  const result = await api.confirmarSesionCardnet(new Request('http://localhost/confirm'), s.authUser, {
    sessionId: id, captureNonce: nonce, token: 'one-time-capture-token-value',
  })
  assert.equal(result.status, 409)
  assert.equal(row.estado, 'EXPIRED')
  assert.equal(s.customerGets, 0)
  assert.equal(s.chargeCalls, 0)
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
