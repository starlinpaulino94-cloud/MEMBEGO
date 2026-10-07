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
  purchase: Row | null
  sessions: Map<string, Row>
  reservations: Map<string, Row>
  intents: Map<string, Row>
  config: Row
  customerResponse: Row
  searchResponse: Row
  amountResult: { readonly ok: true; readonly pesos: number } | { readonly ok: false; readonly motivo: string }
  canCharge: boolean
  providerCalls: number
  customerGets: number
  customerIdLookups: number
  targetReads: number
  purchaseReads: number
  amountLookups: number
  chargeCalls: number
  onCharge?: () => void
  onCustomerRead?: () => void
  customerGetResponses?: Array<unknown | null>
  onPurchaseSearch?: () => void
  purchaseSearchResponses?: Array<unknown | null>
  intentCreates: number
  chargeResults: Array<unknown | null>
  chargeRequests: Array<{ readonly purchaseUniqueId: unknown; readonly order: unknown; readonly amount: unknown; readonly token?: unknown }>
  confirmationResult?: unknown
  confirmationResults?: unknown[]
  onConfirmIntent?: () => void
  fulfillmentRetryResult?: unknown
  fulfillmentRetryCalls: number
  purchaseSearches: Row[]
  promotionResult: unknown
  promotionCalls: Array<{ readonly user: SessionUser; readonly promotionId: string }>
}

const stub = pathToFileURL(path.resolve('tests/support/cardnet-service-stub.mjs')).href
const serverOnly = pathToFileURL(path.resolve('tests/support/server-only-stub.mjs')).href
const mocked = new Set([
  '@/lib/tenant', '@/lib/auth', '@/lib/auth/api-guard', '@/lib/payments/cardnet-tokens',
  '@/modules/pagos/cardnet3ds', '@/modules/pagos/cardnetToken', '@/modules/pagos/intentos',
  '@/modules/promociones/compraService', '@/modules/promociones/compra', '@/lib/rate-limit',
  '@/modules/cliente/afiliacion', '@/modules/notificaciones/service', '@/modules/storage/comprobantes',
  '@/modules/membresia/vigencia', '@/lib/bienvenida', '@/modules/elegibilidad',
  '@/modules/elegibilidad/decidir', '@/modules/membresia/prorrateo', '@/modules/marketplace/cached',
])
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'server-only') return { url: serverOnly, shortCircuit: true }
    if (specifier === 'next/cache') return { url: stub, shortCircuit: true }
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
    membership: null, purchase: null, sessions: new Map(), reservations: new Map(), intents: new Map(),
    config: { captureUrl: 'https://lab.cardnet.com.do', scriptUrl: 'https://tr-tsp-test.gtp-seglan.com/widget.js', publicKey: 'sandbox-public' },
    customerResponse: { denegado: false, email: 'qa@example.test', captureUrl: 'https://lab.cardnet.com.do', uniqueId: 'temporary-customer-id', perfiles: [] },
    searchResponse: { ok: true, json: { Response: { Purchases: [] } } },
    amountResult: { ok: true, pesos: 1000 },
    canCharge: true,
    providerCalls: 0, customerGets: 0, customerIdLookups: 0, targetReads: 0, purchaseReads: 0,
    amountLookups: 0, chargeCalls: 0, intentCreates: 0, fulfillmentRetryCalls: 0,
    chargeResults: [], chargeRequests: [], purchaseSearches: [], promotionResult: null, promotionCalls: [],
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
    productoCompra: {
      findUnique: async () => { s.purchaseReads += 1; return s.purchase },
      update: async (input: { data: Row }) => {
        if (!s.purchase) throw new Error('promotion purchase missing')
        Object.assign(s.purchase, input.data)
        return s.purchase
      },
      updateMany: async (input: { where: Row; data: Row }) => {
        if (!s.purchase || !matches(s.purchase, input.where)) return { count: 0 }
        Object.assign(s.purchase, input.data)
        return { count: 1 }
      },
    },
    cardnetCaptureSession: {
      findFirst: async (input: { where: Row }) => {
        const row = [...s.sessions.values()].find((candidate) => matches(candidate, input.where))
        return row
          ? { ...row, purchaseIntent: row.purchaseIntent && typeof row.purchaseIntent === 'object'
            ? { ...(row.purchaseIntent as Row) }
            : null }
          : null
      },
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
        Object.assign(row, input.data)
        if (typeof input.data.purchaseIntentId === 'string') {
          row.purchaseIntent = s.intents.get(input.data.purchaseIntentId) ?? null
        }
        row.updatedAt = new Date()
        return row
      },
    },
    pagoIntento: {
      create: async (input: { data: Row }) => {
        const intent = { id: 'intent-' + (++s.intentCreates), ...input.data }
        s.intents.set(intent.id, intent)
        return intent
      },
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
function promotionPurchase(owner = 'qa-user', state = 'PENDIENTE_PAGO'): Row {
  return {
    id: 'purchase-test', companyId: 'qa-company', clienteId: 'qa-client', tipo: 'PROMOCION', estado: state,
    precioCongelado: 825,
    cliente: { id: 'qa-client-db', nombre: 'Cliente QA', supabaseId: owner, companyId: 'qa-company', email: 'qa@example.test', cardnetCustomerId: null, esLocal: false },
    promocion: { titulo: 'Promo QA' },
  }
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

test('a foreign promotion purchase is hidden before CardNET is called or reserved', async () => {
  const s = setup()
  s.purchase = promotionPurchase('another-user')
  const api = await service()
  const result = await api.iniciarSesionCardnet(new Request('http://localhost/session'), s.authUser, {
    compraId: 'purchase-test',
  })
  assert.equal(result.status, 404)
  assert.equal(s.purchaseReads, 1)
  assert.equal(s.providerCalls, 0)
  assert.equal(s.sessions.size, 0)
  assert.equal(s.reservations.size, 0)
  assert.equal(s.purchase.estado, 'PENDIENTE_PAGO')
})

test('a foreign promotion capture session cannot be read or changed by its id', async () => {
  const s = setup()
  s.purchase = promotionPurchase()
  const session: Row = {
    id: 'f'.repeat(48), authSubject: 'another-user', companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: null, compraId: 'purchase-test', monto: 825, moneda: 'DOP', estado: 'CAPTURE_OPEN',
    venceAt: new Date(Date.now() + 60_000), captureNonce: 'untouched-nonce-hash',
    customerId: 'cardnet-customer-test', customerUniqueId: 'temporary-customer-id',
    perfilBase: [], paymentProfileId: null, createdAt: new Date(), updatedAt: new Date(),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null }, purchaseIntent: null,
    reservaClienteKey: 'foreign-session-reservation',
  }
  s.sessions.set(String(session.id), session)
  s.reservations.set('foreign-session-reservation', session)
  const api = await service()
  const result = await api.confirmarSesionCardnet(new Request('http://localhost/confirm'), s.authUser, {
    sessionId: session.id, captureNonce: 'nonce-for-foreign-session-012345', token: 'one-time-token',
  })
  assert.equal(result.status, 404)
  assert.equal(s.providerCalls, 0)
  assert.equal(session.estado, 'CAPTURE_OPEN')
  assert.equal(session.captureNonce, 'untouched-nonce-hash')
  assert.equal(session.reservaClienteKey, 'foreign-session-reservation')
  assert.equal(s.reservations.size, 1)
  assert.equal(s.purchase.estado, 'PENDIENTE_PAGO')
})

test('the promotion purchase BFF preserves the free and paid service outcomes', async () => {
  const route = await import('../src/app/api/v1/cliente/promociones/[id]/comprar/route')
  const request = () => new Request('http://localhost/api/v1/cliente/promociones/promo-test/comprar', {
    method: 'POST', headers: { Authorization: 'Bearer qa-bearer', 'Content-Type': 'application/json' }, body: '{}',
  })

  const free = setup()
  free.promotionResult = { success: true, compraId: 'free-purchase', activada: true }
  const freeResponse = await route.POST(request(), { params: Promise.resolve({ id: 'promo-free' }) })
  assert.equal(freeResponse.status, 200)
  assert.deepEqual(await freeResponse.json(), { ok: true, status: 'free_activated', compraId: 'free-purchase' })
  assert.equal(free.promotionCalls[0]?.promotionId, 'promo-free')
  assert.equal(free.purchaseReads, 0)
  assert.equal(free.providerCalls, 0)

  const paid = setup()
  paid.promotionResult = { success: true, compraId: 'purchase-test', activada: false }
  paid.purchase = promotionPurchase()
  paid.purchase.precioCongelado = '825.50'
  const paidResponse = await route.POST(request(), { params: Promise.resolve({ id: 'promo-paid' }) })
  assert.equal(paidResponse.status, 200)
  assert.deepEqual(await paidResponse.json(), {
    ok: true, status: 'payment_required', compraId: 'purchase-test', amount: 825.5, currency: 'DOP',
  })
  assert.equal(paid.promotionCalls[0]?.promotionId, 'promo-paid')
  assert.equal(paid.purchaseReads, 1)
  assert.equal(paid.providerCalls, 0)
})

test('the session BFF recovers only the same owned target during persisted processing', async () => {
  const s = setup()
  s.purchase = promotionPurchase()
  const id = 'w'.repeat(48)
  const reservationKey = createHash('sha256').update('qa-company:qa-client').digest('hex')
  const processing: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: null, compraId: 'purchase-test', monto: 825, moneda: 'DOP', estado: 'PURCHASE_PENDING',
    venceAt: new Date(Date.now() + 60_000), captureNonce: null,
    customerId: 'cardnet-customer-private', customerUniqueId: 'provider-customer-unique-id',
    perfilBase: ['id:profile-old'], paymentProfileId: 'profile-fresh',
    createdAt: new Date(), updatedAt: new Date(),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null },
    purchaseIntent: { id: 'intent-persisted', cardnetUniqueId: 'purchase-order-private' },
    reservaClienteKey: reservationKey,
  }
  s.sessions.set(id, processing)
  s.reservations.set(reservationKey, processing)
  const route = await import('../src/app/api/v1/cliente/pagos/cardnet/sesion/route')
  const response = await route.POST(new Request('http://localhost/api/v1/cliente/pagos/cardnet/sesion', {
    method: 'POST',
    headers: { Authorization: 'Bearer qa-bearer', 'Content-Type': 'application/json' },
    body: JSON.stringify({ compraId: 'purchase-test' }),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, status: 'processing', sessionId: id })
  assert.equal(s.providerCalls, 0)
  assert.equal(processing.estado, 'PURCHASE_PENDING')
  assert.equal(processing.customerId, 'cardnet-customer-private')
  assert.equal(processing.reservaClienteKey, reservationKey)
})

test('a different target cannot recover a customer reservation or learn its session id', async () => {
  const s = setup()
  s.purchase = promotionPurchase()
  const id = 'x'.repeat(48)
  const reservationKey = createHash('sha256').update('qa-company:qa-client').digest('hex')
  const processing: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: null, compraId: 'another-purchase', monto: 825, moneda: 'DOP', estado: 'PURCHASE_PENDING',
    venceAt: new Date(Date.now() + 60_000), captureNonce: null,
    customerId: 'cardnet-customer-private', customerUniqueId: 'provider-customer-unique-id',
    perfilBase: [], paymentProfileId: 'profile-fresh', createdAt: new Date(), updatedAt: new Date(),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null },
    purchaseIntent: { id: 'intent-persisted', cardnetUniqueId: 'purchase-order-private' },
    reservaClienteKey: reservationKey,
  }
  s.sessions.set(id, processing)
  s.reservations.set(reservationKey, processing)
  const api = await service()
  const result = await api.iniciarSesionCardnet(new Request('http://localhost/session'), s.authUser, {
    compraId: 'purchase-test',
  })
  assert.equal(result.status, 409)
  assert.deepEqual(Object.keys(result.body).sort(), ['error', 'ok'])
  assert.equal(s.providerCalls, 0)
  assert.equal(processing.estado, 'PURCHASE_PENDING')
  assert.equal(processing.reservaClienteKey, reservationKey)
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

test('a Purchase request receives the fresh PaymentProfiles token, never customer or baseline ids', async () => {
  const s = setup()
  s.customerResponse = {
    denegado: false,
    email: 'qa@example.test',
    perfiles: [
      { paymentProfileId: 'profile-old', token: 'older-profile-token', habilitado: true },
      { paymentProfileId: 'profile-fresh', token: 'fresh-payment-profile-token', habilitado: true },
    ],
  }
  s.chargeResults = [null]
  const id = 't'.repeat(48)
  const row: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: null, compraId: 'purchase-test', monto: 825, moneda: 'DOP', estado: 'CAPTURE_CONSUMED',
    venceAt: new Date(Date.now() + 60_000), captureNonce: null,
    customerId: 'cardnet-customer-test', customerUniqueId: 'customer-unique-id-is-not-a-payment-token',
    perfilBase: ['id:profile-old'], paymentProfileId: null,
    purchaseIntentId: null, createdAt: new Date(), updatedAt: new Date(),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null }, purchaseIntent: null,
    reservaClienteKey: 'held-customer-reservation',
  }
  s.sessions.set(id, row)
  s.reservations.set('held-customer-reservation', row)
  const api = await service()
  const result = await api.estadoSesionCardnet(s.authUser, id, new Request('http://localhost/status'))
  assert.equal(result.status, 202)
  assert.equal(result.body.status, 'pending')
  assert.equal(row.paymentProfileId, 'profile-fresh')
  assert.equal(s.chargeCalls, 1)
  assert.equal(s.chargeRequests[0]?.token, 'fresh-payment-profile-token')
  assert.notEqual(s.chargeRequests[0]?.token, row.customerUniqueId)
  assert.notEqual(s.chargeRequests[0]?.token, 'older-profile-token')
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

test('a resumed capture applies the latest renewal-consent choice', async () => {
  const s = setup()
  s.membership = membership()
  const api = await service()
  const start = (guardarParaRenovacion: boolean) =>
    api.iniciarSesionCardnet(new Request('http://localhost/session'), s.authUser, {
      membershipId: 'membership-test', guardarParaRenovacion,
    })
  const optedIn = await start(true)
  const optedOut = await start(false)
  assert.equal(optedIn.status, 200)
  assert.equal(optedOut.status, 200)
  assert.equal([...s.sessions.values()][0]?.guardarRenovacion, false)
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

test('a promotion receipt expires an open CardNET capture before advancing purchase state', async () => {
  const s = setup()
  s.purchase = promotionPurchase()
  const id = 'o'.repeat(48)
  const open: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: null, compraId: 'purchase-test', monto: 825, moneda: 'DOP', estado: 'CAPTURE_OPEN',
    venceAt: new Date(Date.now() + 60_000), captureNonce: 'open-promo-nonce-hash',
    reservaClienteKey: 'held-promotion-reservation', updatedAt: new Date(),
  }
  s.sessions.set(id, open)
  s.reservations.set('held-promotion-reservation', open)
  const actions = await import('../src/modules/promociones/compraActions')
  const form = new FormData()
  form.set('compraId', 'purchase-test')
  form.set('comprobanteUrl', 'qa-receipts/purchase-test/image.png')
  const result = await actions.enviarComprobanteCompra({}, form)
  assert.deepEqual(result, { success: true, compraId: 'purchase-test' })
  assert.equal(s.purchase.estado, 'EN_VALIDACION')
  assert.equal(open.estado, 'EXPIRED')
  assert.equal(open.captureNonce, null)
  assert.equal(open.reservaClienteKey, null)
  assert.equal(s.reservations.size, 0)
})

test('a promotion receipt cannot advance purchase state while CardNET is processing', async () => {
  const s = setup()
  s.purchase = promotionPurchase()
  const id = 'i'.repeat(48)
  const processing: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: null, compraId: 'purchase-test', monto: 825, moneda: 'DOP', estado: 'PROFILE_PENDING',
    venceAt: new Date(Date.now() + 60_000), captureNonce: null,
    reservaClienteKey: 'held-promotion-reservation', updatedAt: new Date(),
  }
  s.sessions.set(id, processing)
  s.reservations.set('held-promotion-reservation', processing)
  const actions = await import('../src/modules/promociones/compraActions')
  const form = new FormData()
  form.set('compraId', 'purchase-test')
  form.set('comprobanteUrl', 'qa-receipts/purchase-test/image.png')
  const result = await actions.enviarComprobanteCompra({}, form)
  assert.ok('error' in result)
  assert.equal(s.purchase.estado, 'PENDIENTE_PAGO')
  assert.equal(processing.estado, 'PROFILE_PENDING')
  assert.equal(processing.reservaClienteKey, 'held-promotion-reservation')
  assert.equal(s.reservations.size, 1)
})

test('ambiguous retries retain the Purchase UniqueID and serialize concurrent charges', async () => {
  const s = setup()
  s.customerResponse = {
    denegado: false, email: 'qa@example.test',
    perfiles: [
      { paymentProfileId: 'profile-old', token: 'older-profile-token-must-not-be-charged', habilitado: true },
      { paymentProfileId: 'profile-fresh', token: 'fresh-payment-profile-token', habilitado: true },
    ],
  }
  s.chargeResults = [null, null]
  const id = 'p'.repeat(48)
  const stableUniqueId = 'persisted-purchase-unique-id'
  const row: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: null, compraId: 'purchase-test', monto: 1000, moneda: 'DOP',
    estado: 'PURCHASE_PENDING', venceAt: new Date(Date.now() + 60_000), captureNonce: null,
    customerId: 'cardnet-customer-test', customerUniqueId: 'temporary-customer-id',
    perfilBase: ['id:profile-old'], paymentProfileId: 'profile-fresh',
    createdAt: new Date(Date.now() - 120_000), updatedAt: new Date(Date.now() - 90_000),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null },
    purchaseIntentId: 'intent-persisted',
    purchaseIntent: { id: 'intent-persisted', cardnetUniqueId: stableUniqueId, estado: 'CREADO' },
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
  assert.equal(s.chargeRequests[0]?.token, 'fresh-payment-profile-token')
  assert.notEqual(s.chargeRequests[0]?.token, row.customerUniqueId)
  assert.notEqual(s.chargeRequests[0]?.token, 'older-profile-token-must-not-be-charged')
  assert.equal(row.reservaClienteKey, 'held-customer-reservation')

  row.updatedAt = new Date(Date.now() - 90_000)
  const retry = await status()
  assert.equal(retry.status, 202)
  assert.equal(retry.body.status, 'pending')
  assert.equal(s.chargeCalls, 2)
  assert.deepEqual(s.chargeRequests.map((call) => call.purchaseUniqueId), [stableUniqueId, stableUniqueId])
  assert.deepEqual(s.chargeRequests.map((call) => call.token), [
    'fresh-payment-profile-token',
    'fresh-payment-profile-token',
  ])
  assert.equal(s.intentCreates, 0)
  assert.equal(row.reservaClienteKey, 'held-customer-reservation')
})

test('stale activation recovery claims one lease before charging a persisted intent', { timeout: 5_000 }, async () => {
  const { ACTIVATION_CLAIM_STALE_MS } = await import('../src/modules/pagos/cardnetClienteShared')
  const s = setup()
  s.customerResponse = {
    denegado: false, email: 'qa@example.test',
    perfiles: [{ paymentProfileId: 'profile-fresh', token: 'fresh-payment-profile-token', habilitado: true }],
  }
  let releaseCharge: (response: unknown) => void = () => undefined
  let announceCharge: () => void = () => undefined
  const chargeStarted = new Promise<void>((resolve) => { announceCharge = resolve })
  const chargeResult = new Promise<unknown>((resolve) => { releaseCharge = resolve })
  s.onCharge = announceCharge
  s.chargeResults = [chargeResult, null]
  const id = 'a'.repeat(48)
  const row: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: 'membership-test', compraId: null, monto: 1000, moneda: 'DOP',
    estado: 'ACTIVATION_PROCESSING', venceAt: new Date(Date.now() + 60_000), captureNonce: null,
    customerId: 'cardnet-customer-test', customerUniqueId: 'temporary-customer-id',
    perfilBase: [], paymentProfileId: 'profile-fresh',
    createdAt: new Date(Date.now() - 120_000),
    updatedAt: new Date(Date.now() - ACTIVATION_CLAIM_STALE_MS - 1_000),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null },
    purchaseIntentId: 'intent-persisted',
    purchaseIntent: { id: 'intent-persisted', cardnetUniqueId: 'stable-purchase-key', estado: 'CREADO' },
    reservaClienteKey: 'held-membership-reservation',
  }
  s.sessions.set(id, row)
  s.reservations.set('held-membership-reservation', row)
  const api = await service()
  const status = () => api.estadoSesionCardnet(s.authUser, id, new Request('http://localhost/status'))
  const first = status()
  await chargeStarted
  assert.equal(row.estado, 'PURCHASE_PENDING')
  const concurrent = await status()
  assert.equal(concurrent.status, 202)
  assert.equal(s.chargeCalls, 1)
  releaseCharge(null)
  const results = [await first, concurrent]
  assert.ok(results.every((result) => result.status === 202 && result.body.status === 'pending'))
  assert.equal(s.customerGets, 1)
  assert.equal(s.chargeCalls, 1)
  assert.deepEqual(s.chargeRequests.map((call) => call.purchaseUniqueId), ['stable-purchase-key'])
  assert.equal(row.estado, 'PURCHASE_PENDING')
})

test('a superseded stale purchase lookup cannot send Purchase', { timeout: 5_000 }, async () => {
  const { PURCHASE_RETRY_MS } = await import('../src/modules/pagos/cardnetClienteShared')
  const s = setup()
  const profileResponse = {
    denegado: false, email: 'qa@example.test',
    perfiles: [{ paymentProfileId: 'profile-fresh', token: 'fresh-payment-profile-token', habilitado: true }],
  }
  let releaseFirstProfile: (response: unknown) => void = () => undefined
  let releaseSecondProfile: (response: unknown) => void = () => undefined
  const firstProfileResponse = new Promise<unknown>((resolve) => { releaseFirstProfile = resolve })
  const secondProfileResponse = new Promise<unknown>((resolve) => { releaseSecondProfile = resolve })
  let announceFirstRead: () => void = () => undefined
  let announceSecondRead: () => void = () => undefined
  const firstRead = new Promise<void>((resolve) => { announceFirstRead = resolve })
  const secondRead = new Promise<void>((resolve) => { announceSecondRead = resolve })
  let customerReadCount = 0
  s.onCustomerRead = () => {
    customerReadCount += 1
    if (customerReadCount === 1) announceFirstRead()
    else announceSecondRead()
  }
  s.customerGetResponses = [firstProfileResponse, secondProfileResponse]
  let releaseCharge: (response: unknown) => void = () => undefined
  let announceCharge: () => void = () => undefined
  const chargeStarted = new Promise<void>((resolve) => { announceCharge = resolve })
  const chargeResult = new Promise<unknown>((resolve) => { releaseCharge = resolve })
  s.onCharge = announceCharge
  s.chargeResults = [chargeResult]
  const id = 'r'.repeat(48)
  const row: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: null, compraId: 'purchase-test', monto: 1000, moneda: 'DOP',
    estado: 'PURCHASE_PENDING', venceAt: new Date(Date.now() + 60_000), captureNonce: null,
    customerId: 'cardnet-customer-test', customerUniqueId: 'temporary-customer-id',
    perfilBase: [], paymentProfileId: 'profile-fresh',
    createdAt: new Date(Date.now() - 120_000), updatedAt: new Date(Date.now() - PURCHASE_RETRY_MS - 1_000),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null },
    purchaseIntentId: 'intent-persisted',
    purchaseIntent: { id: 'intent-persisted', cardnetUniqueId: 'stable-purchase-key', estado: 'CREADO' },
    reservaClienteKey: 'held-customer-reservation',
  }
  s.sessions.set(id, row)
  s.reservations.set('held-customer-reservation', row)
  const api = await service()
  const status = () => api.estadoSesionCardnet(s.authUser, id, new Request('http://localhost/status'))
  const first = status()
  await firstRead
  row.updatedAt = new Date(Date.now() - PURCHASE_RETRY_MS - 1_000)
  await new Promise((resolve) => setTimeout(resolve, 5))
  const second = status()
  await secondRead
  releaseSecondProfile(profileResponse)
  await chargeStarted
  assert.equal(s.chargeCalls, 1)
  releaseFirstProfile(profileResponse)
  const firstResult = await first
  assert.equal(firstResult.status, 202)
  assert.equal(s.chargeCalls, 1)
  releaseCharge(null)
  const secondResult = await second
  assert.ok([firstResult, secondResult].every((result) => result.status === 202 && result.body.status === 'pending'))
  assert.deepEqual(s.chargeRequests.map((call) => call.purchaseUniqueId), ['stable-purchase-key'])
  assert.equal(s.customerGets, 2)
})

test('a stale activation result cannot reopen a session approved by another handler', { timeout: 5_000 }, async () => {
  const s = setup()
  const stableUniqueId = 'stable-approved-purchase-key'
  let releaseStaleSearch: (response: unknown) => void = () => undefined
  const staleSearchResponse = new Promise<unknown>((resolve) => { releaseStaleSearch = resolve })
  let announceFirstSearch: () => void = () => undefined
  const firstSearchStarted = new Promise<void>((resolve) => { announceFirstSearch = resolve })
  let searchCount = 0
  s.onPurchaseSearch = () => {
    searchCount += 1
    if (searchCount === 1) announceFirstSearch()
  }
  s.purchaseSearchResponses = [staleSearchResponse, {
    ok: true,
    json: {
      Response: {
        Purchases: [{
          OrderNumber: stableUniqueId,
          UniqueID: stableUniqueId,
          CustomerId: 'cardnet-customer-test',
          Created: new Date().toISOString(),
          Transaction: { TransactionStatusId: 1, AuthorizationCode: 'A1B2C3', ResponseCode: '00' },
        }],
      },
    },
  }]
  const id = 's'.repeat(48)
  const row: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: 'membership-test', compraId: null, monto: 1000, moneda: 'DOP',
    estado: 'PURCHASE_PENDING', venceAt: new Date(Date.now() + 60_000), captureNonce: null,
    customerId: 'cardnet-customer-test', customerUniqueId: 'temporary-customer-id',
    perfilBase: [], paymentProfileId: 'profile-fresh', guardarRenovacion: false,
    createdAt: new Date(Date.now() - 120_000), updatedAt: new Date(),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null },
    purchaseIntentId: 'intent-persisted',
    purchaseIntent: { id: 'intent-persisted', cardnetUniqueId: stableUniqueId },
    reservaClienteKey: 'held-customer-reservation',
  }
  s.sessions.set(id, row)
  s.reservations.set('held-customer-reservation', row)
  const api = await service()
  const status = () => api.estadoSesionCardnet(s.authUser, id, new Request('http://localhost/status'))
  const stale = status()
  await firstSearchStarted
  const approved = await status()
  assert.equal(approved.status, 200)
  assert.equal(approved.body.status, 'approved')
  assert.equal(row.estado, 'APPROVED')
  const approvedUpdatedAt = row.updatedAt
  releaseStaleSearch({
    ok: true,
    json: {
      Response: {
        Purchases: [{
          OrderNumber: stableUniqueId,
          UniqueID: stableUniqueId,
          CustomerId: 'cardnet-customer-test',
          Created: new Date().toISOString(),
          Errors: [{ ErrorCode: 'CS012', Message: 'PROFILE_MUST_BE_ACTIVATED_FIRST' }],
        }],
      },
    },
  })
  const staleResult = await stale
  assert.equal(staleResult.status, 200)
  assert.equal(staleResult.body.status, 'approved')
  assert.equal(row.estado, 'APPROVED')
  assert.equal(row.updatedAt, approvedUpdatedAt)
})

test('a stale pending search cannot invalidate a concurrent approved transition', { timeout: 5_000 }, async () => {
  const s = setup()
  let releaseStaleSearch: (response: unknown) => void = () => undefined
  const staleSearchResponse = new Promise<unknown>((resolve) => { releaseStaleSearch = resolve })
  let announceFirstSearch: () => void = () => undefined
  const firstSearchStarted = new Promise<void>((resolve) => { announceFirstSearch = resolve })
  s.onPurchaseSearch = announceFirstSearch
  s.purchaseSearchResponses = [staleSearchResponse, {
    ok: true,
    json: {
      Response: {
        Purchases: [{
          OrderNumber: 'stable-purchase-key',
          UniqueID: 'stable-purchase-key',
          CustomerId: 'cardnet-customer-test',
          Created: new Date().toISOString(),
          Transaction: { TransactionStatusId: 1, AuthorizationCode: 'A1B2C3', ResponseCode: '00' },
        }],
      },
    },
  }]

  let releaseConfirmation: (result: unknown) => void = () => undefined
  const confirmationResult = new Promise<unknown>((resolve) => { releaseConfirmation = resolve })
  let announceConfirmation: () => void = () => undefined
  const confirmationStarted = new Promise<void>((resolve) => { announceConfirmation = resolve })
  s.confirmationResult = confirmationResult
  s.onConfirmIntent = announceConfirmation

  const id = 't'.repeat(48)
  const row: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: 'membership-test', compraId: null, monto: 1000, moneda: 'DOP',
    estado: 'PURCHASE_PENDING', venceAt: new Date(Date.now() + 60_000), captureNonce: null,
    customerId: 'cardnet-customer-test', customerUniqueId: 'temporary-customer-id',
    perfilBase: [], paymentProfileId: 'profile-fresh', guardarRenovacion: false,
    createdAt: new Date(Date.now() - 120_000), updatedAt: new Date(),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null },
    purchaseIntentId: 'intent-persisted',
    purchaseIntent: { id: 'intent-persisted', cardnetUniqueId: 'stable-purchase-key', estado: 'CREADO' },
    reservaClienteKey: 'held-customer-reservation',
  }
  s.sessions.set(id, row)
  s.reservations.set('held-customer-reservation', row)
  const api = await service()
  const status = () => api.estadoSesionCardnet(s.authUser, id, new Request('http://localhost/status'))
  const stale = status()
  await firstSearchStarted
  const approved = status()
  await confirmationStarted

  const pendingUpdatedAt = row.updatedAt
  releaseStaleSearch({ ok: true, json: { Response: { Purchases: [] } } })
  const staleResult = await stale
  assert.equal(staleResult.status, 202)
  assert.equal(staleResult.body.status, 'pending')
  assert.equal(row.updatedAt, pendingUpdatedAt)

  releaseConfirmation({ ok: true, entrega: 'COMPLETADA' })
  const approvedResult = await approved
  assert.equal(approvedResult.status, 200)
  assert.equal(approvedResult.body.status, 'approved')
  assert.equal(row.estado, 'APPROVED')
})

test('an in-flight fulfillment result does not leave a completed payment pending', { timeout: 5_000 }, async () => {
  const s = setup()
  const approvedPurchase = {
    ok: true,
    json: {
      Response: {
        Purchases: [{
          OrderNumber: 'stable-purchase-key',
          UniqueID: 'stable-purchase-key',
          CustomerId: 'cardnet-customer-test',
          Created: new Date().toISOString(),
          Transaction: { TransactionStatusId: 1, AuthorizationCode: 'A1B2C3', ResponseCode: '00' },
        }],
      },
    },
  }
  s.purchaseSearchResponses = [approvedPurchase, approvedPurchase]
  let releaseDelivery: (result: unknown) => void = () => undefined
  const deliveryResult = new Promise<unknown>((resolve) => { releaseDelivery = resolve })
  let announceFirstConfirmation: () => void = () => undefined
  const firstConfirmationStarted = new Promise<void>((resolve) => { announceFirstConfirmation = resolve })
  let confirmCount = 0
  s.onConfirmIntent = () => {
    confirmCount += 1
    if (confirmCount === 1) announceFirstConfirmation()
  }
  let announceSecondSearch: () => void = () => undefined
  const secondSearchStarted = new Promise<void>((resolve) => { announceSecondSearch = resolve })
  let searchCount = 0
  s.onPurchaseSearch = () => {
    searchCount += 1
    if (searchCount === 2) announceSecondSearch()
  }
  s.confirmationResults = [deliveryResult, { ok: true, entrega: 'PENDIENTE' }]

  const id = 'u'.repeat(48)
  const row: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: 'membership-test', compraId: null, monto: 1000, moneda: 'DOP',
    estado: 'PURCHASE_PENDING', venceAt: new Date(Date.now() + 60_000), captureNonce: null,
    customerId: 'cardnet-customer-test', customerUniqueId: 'temporary-customer-id',
    perfilBase: [], paymentProfileId: 'profile-fresh', guardarRenovacion: false,
    createdAt: new Date(Date.now() - 120_000), updatedAt: new Date(),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null },
    purchaseIntentId: 'intent-persisted',
    purchaseIntent: { id: 'intent-persisted', cardnetUniqueId: 'stable-purchase-key' },
    reservaClienteKey: 'held-customer-reservation',
  }
  s.sessions.set(id, row)
  s.reservations.set('held-customer-reservation', row)
  const api = await service()
  const status = () => api.estadoSesionCardnet(s.authUser, id, new Request('http://localhost/status'))
  const completing = status()
  await firstConfirmationStarted
  const concurrent = status()
  await secondSearchStarted
  const concurrentResult = await concurrent
  assert.equal(concurrentResult.status, 202)
  assert.equal(concurrentResult.body.status, 'pending')
  assert.equal(row.estado, 'PURCHASE_PENDING')

  releaseDelivery({ ok: true, entrega: 'COMPLETADA' })
  const completed = await completing
  assert.equal(completed.status, 200)
  assert.equal(completed.body.status, 'approved')
  assert.equal(row.estado, 'APPROVED')
})

test('a delayed CardNET POST cannot reopen an approved session after stale reconciliation', { timeout: 5_000 }, async () => {
  const { PURCHASE_RETRY_MS } = await import('../src/modules/pagos/cardnetClienteShared')
  const s = setup()
  s.customerResponse = {
    denegado: false,
    email: 'qa@example.test',
    perfiles: [{ paymentProfileId: 'profile-fresh', token: 'fresh-payment-profile-token', habilitado: true }],
  }
  const approvedPurchase = {
    ok: true,
    json: {
      Response: {
        Purchases: [{
          OrderNumber: 'stable-purchase-key',
          UniqueID: 'stable-purchase-key',
          CustomerId: 'cardnet-customer-test',
          Created: new Date().toISOString(),
          Transaction: { TransactionStatusId: 1, AuthorizationCode: 'A1B2C3', ResponseCode: '00' },
        }],
      },
    },
  }
  const pendingPurchase = { ok: true, json: { Response: { Purchases: [] } } }
  s.purchaseSearchResponses = [pendingPurchase, approvedPurchase, pendingPurchase]
  let releaseCharge: (response: unknown) => void = () => undefined
  let announceCharge: () => void = () => undefined
  const chargeStarted = new Promise<void>((resolve) => { announceCharge = resolve })
  const chargeResult = new Promise<unknown>((resolve) => { releaseCharge = resolve })
  s.onCharge = announceCharge
  s.chargeResults = [chargeResult]

  const id = 'v'.repeat(48)
  const row: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: 'membership-test', compraId: null, monto: 1000, moneda: 'DOP',
    estado: 'PURCHASE_PENDING', venceAt: new Date(Date.now() + 60_000), captureNonce: null,
    customerId: 'cardnet-customer-test', customerUniqueId: 'temporary-customer-id',
    perfilBase: [], paymentProfileId: 'profile-fresh', guardarRenovacion: false,
    createdAt: new Date(Date.now() - 120_000), updatedAt: new Date(Date.now() - PURCHASE_RETRY_MS - 1_000),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null },
    purchaseIntentId: 'intent-persisted',
    purchaseIntent: { id: 'intent-persisted', cardnetUniqueId: 'stable-purchase-key', estado: 'CREADO' },
    reservaClienteKey: 'held-customer-reservation',
  }
  s.sessions.set(id, row)
  s.reservations.set('held-customer-reservation', row)
  const api = await service()
  const status = () => api.estadoSesionCardnet(s.authUser, id, new Request('http://localhost/status'))
  const delayedPost = status()
  await chargeStarted

  const approved = await status()
  assert.equal(approved.status, 200)
  assert.equal(approved.body.status, 'approved')
  assert.equal(row.estado, 'APPROVED')

  releaseCharge(null)
  const delayedResult = await delayedPost
  assert.equal(delayedResult.status, 200)
  assert.equal(delayedResult.body.status, 'approved')
  assert.equal(row.estado, 'APPROVED')
  assert.equal(s.chargeCalls, 1)
})

test('a locally approved intent resumes fulfillment without another CardNET call', { timeout: 5_000 }, async () => {
  const s = setup()
  s.confirmationResult = { ok: true, entrega: 'PENDIENTE' }
  s.fulfillmentRetryResult = { ok: true, entrega: 'COMPLETADA' }
  const id = 'w'.repeat(48)
  const row: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: 'membership-test', compraId: null, monto: 1000, moneda: 'DOP',
    estado: 'PURCHASE_PENDING', venceAt: new Date(Date.now() + 60_000), captureNonce: null,
    customerId: 'cardnet-customer-test', customerUniqueId: 'temporary-customer-id',
    perfilBase: [], paymentProfileId: 'profile-fresh', guardarRenovacion: false,
    createdAt: new Date(Date.now() - 120_000), updatedAt: new Date(),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null },
    purchaseIntentId: 'intent-persisted',
    purchaseIntent: {
      id: 'intent-persisted', cardnetUniqueId: 'stable-purchase-key', estado: 'APROBADO',
      autorizacion: 'A1B2C3', fulfillmentEstado: 'PROCESANDO',
    },
    reservaClienteKey: 'held-customer-reservation',
  }
  s.sessions.set(id, row)
  s.reservations.set('held-customer-reservation', row)
  const api = await service()
  const result = await api.estadoSesionCardnet(s.authUser, id, new Request('http://localhost/status'))
  assert.equal(result.status, 200)
  assert.equal(result.body.status, 'approved')
  assert.equal(row.estado, 'APPROVED')
  assert.equal(s.providerCalls, 0)
  assert.equal(s.chargeCalls, 0)
  assert.equal(s.fulfillmentRetryCalls, 1)
})

test('a fulfillment-pending session resumes an approved intent without another CardNET call', { timeout: 5_000 }, async () => {
  const s = setup()
  s.confirmationResult = { ok: true, entrega: 'PENDIENTE' }
  s.fulfillmentRetryResult = { ok: true, entrega: 'COMPLETADA' }
  const id = 'f'.repeat(48)
  const row: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: 'membership-test', compraId: null, monto: 1000, moneda: 'DOP',
    estado: 'FULFILLMENT_PENDING', venceAt: new Date(Date.now() + 60_000), captureNonce: null,
    customerId: 'cardnet-customer-test', customerUniqueId: 'temporary-customer-id',
    perfilBase: [], paymentProfileId: 'profile-fresh', guardarRenovacion: false,
    createdAt: new Date(Date.now() - 120_000), updatedAt: new Date(),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null },
    purchaseIntentId: 'intent-persisted',
    purchaseIntent: {
      id: 'intent-persisted', cardnetUniqueId: 'stable-purchase-key', estado: 'APROBADO',
      autorizacion: 'A1B2C3', fulfillmentEstado: 'PROCESANDO',
    },
    reservaClienteKey: 'held-customer-reservation',
  }
  s.sessions.set(id, row)
  s.reservations.set('held-customer-reservation', row)
  const api = await service()
  const result = await api.estadoSesionCardnet(s.authUser, id, new Request('http://localhost/status'))
  assert.equal(result.status, 200)
  assert.equal(result.body.status, 'approved')
  assert.equal(row.estado, 'APPROVED')
  assert.equal(s.providerCalls, 0)
  assert.equal(s.chargeCalls, 0)
  assert.equal(s.fulfillmentRetryCalls, 1)
})

test('a freshly approved intent prevents Purchase when the initial intent read is stale', { timeout: 5_000 }, async () => {
  const s = setup()
  s.customerResponse = {
    denegado: false,
    email: 'qa@example.test',
    perfiles: [{ paymentProfileId: 'profile-fresh', token: 'fresh-payment-profile-token', habilitado: true }],
  }
  s.confirmationResult = { ok: true, entrega: 'COMPLETADA' }
  const id = 'y'.repeat(48)
  const row: Row = {
    id, authSubject: s.authUser.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: 'membership-test', compraId: null, monto: 1000, moneda: 'DOP',
    estado: 'PURCHASE_PENDING', venceAt: new Date(Date.now() + 60_000), captureNonce: null,
    customerId: 'cardnet-customer-test', customerUniqueId: 'temporary-customer-id',
    perfilBase: [], paymentProfileId: 'profile-fresh', guardarRenovacion: false,
    createdAt: new Date(Date.now() - 120_000), updatedAt: new Date(Date.now() - 90_000),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null },
    purchaseIntentId: 'intent-persisted',
    purchaseIntent: { id: 'intent-persisted', cardnetUniqueId: 'stable-purchase-key', estado: 'CREADO' },
    reservaClienteKey: 'held-customer-reservation',
  }
  s.sessions.set(id, row)
  s.reservations.set('held-customer-reservation', row)

  const tx = s.tx as { cardnetCaptureSession: { updateMany(input: { where: Row; data: Row }): Promise<{ count: number }> } }
  const originalUpdateMany = tx.cardnetCaptureSession.updateMany
  let intentStateChanged = false
  tx.cardnetCaptureSession.updateMany = async (input) => {
    const result = await originalUpdateMany(input)
    if (result.count === 1 && 'updatedAt' in input.data && !intentStateChanged) {
      intentStateChanged = true
      Object.assign(row.purchaseIntent as Row, { estado: 'APROBADO', autorizacion: 'A1B2C3' })
    }
    return result
  }

  const api = await service()
  const result = await api.estadoSesionCardnet(s.authUser, id, new Request('http://localhost/status'))
  assert.equal(result.status, 200)
  assert.equal(result.body.status, 'approved')
  assert.equal(row.estado, 'APPROVED')
  assert.equal(s.chargeCalls, 0)
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
