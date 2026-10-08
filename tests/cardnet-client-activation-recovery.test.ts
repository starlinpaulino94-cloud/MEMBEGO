import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SessionUser } from '../src/types'

type Row = Record<string, unknown>

const support = pathToFileURL(path.resolve('tests/support/cardnet-service-stub.mjs')).href
const serverOnly = pathToFileURL(path.resolve('tests/support/server-only-stub.mjs')).href
const providerModules = new Set([
  '@/lib/tenant', '@/lib/auth/api-guard', '@/lib/payments/cardnet-tokens', '@/modules/pagos/intentos',
  '@/modules/pagos/cardnetToken',
])

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: serverOnly, shortCircuit: true }
    if (providerModules.has(specifier)) return { url: support, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key]
    if (key === 'updatedAt' && expected instanceof Date) {
      return actual instanceof Date && actual.getTime() === expected.getTime()
    }
    if (key === 'updatedAt' && expected !== null && typeof expected === 'object' && 'lt' in expected) {
      const limit = expected.lt
      return actual instanceof Date && limit instanceof Date && actual < limit
    }
    if (key === 'estado' && expected !== null && typeof expected === 'object' && 'in' in expected) {
      const states = expected.in
      return Array.isArray(states) && states.includes(actual)
    }
    return actual === expected
  })
}

test('a stale activation recovery fences the original handler before its charge', { timeout: 5000 }, async () => {
  const user: SessionUser = {
    supabaseId: 'qa-user', email: 'qa@example.test',
    metadata: { role: 'CLIENTE', dbUserId: 'qa-db-user', clienteId: 'qa-client', companyId: 'qa-company' },
  }
  const purchaseIntent = { id: 'intent-existing', cardnetUniqueId: 'stable-purchase-id', estado: 'CREADO' }
  const session: Row = {
    id: '00000000-0000-4000-8000-000000000001', authSubject: user.supabaseId, companyId: 'qa-company', clienteId: 'qa-client',
    membershipId: 'membership-1', compraId: null, monto: 1000, moneda: 'DOP',
    estado: 'ACTIVATION_REQUIRED', venceAt: new Date(Date.now() + 600_000), captureNonce: null,
    customerId: 'cardnet-customer', customerUniqueId: 'temporary-customer-id', perfilBase: [],
    paymentProfileId: 'profile-1', purchaseIntentId: purchaseIntent.id, purchaseIntent,
    reservaClienteKey: 'held-membership-reservation', createdAt: new Date(), updatedAt: new Date(),
    cliente: { email: 'qa@example.test', cardnetCustomerId: null },
  }
  let releaseFirstRead: (response: unknown) => void = () => undefined
  let announceFirstRead: () => void = () => undefined
  const firstReadStarted = new Promise<void>((resolve) => { announceFirstRead = resolve })
  const firstRead = new Promise<unknown>((resolve) => { releaseFirstRead = resolve })
  const enabledCustomer = {
    email: user.email,
    perfiles: [{ paymentProfileId: 'profile-1', token: 'fresh-profile-token', habilitado: true }],
  }
  const disabledCustomer = {
    email: user.email,
    perfiles: [{ paymentProfileId: 'profile-1', token: 'fresh-profile-token', habilitado: false }],
  }
  const scenario = {
    authUser: user,
    customerGetResponses: [firstRead, enabledCustomer, enabledCustomer],
    onCustomerRead: announceFirstRead,
    activationResult: { ok: true, status: 200 },
    searchResponse: { ok: true, json: { Response: { Purchases: [] } } },
    chargeResults: [null],
    chargeCalls: 0,
    chargeRequests: [],
    customerGets: 0,
    providerCalls: 0,
    activationCalls: 0,
    intentCreates: 0,
    tx: {
      cardnetCaptureSession: {
        findFirst: async ({ where }: { readonly where: Row }) => matches(session, where) ? session : null,
        updateMany: async ({ where, data }: { readonly where: Row; readonly data: Row }) => {
          if (!matches(session, where)) return { count: 0 }
          Object.assign(session, data)
          if (!('updatedAt' in data)) session.updatedAt = new Date()
          return { count: 1 }
        },
        update: async ({ data }: { readonly data: Row }) => {
          Object.assign(session, data)
          return session
        },
      },
      pagoIntento: {
        create: async ({ data }: { readonly data: Row }) => {
          scenario.intentCreates += 1
          return { id: 'intent-created', ...data }
        },
        updateMany: async () => ({ count: 1 }),
      },
    },
  }
  Reflect.set(globalThis, '__cardnetServiceScenario', scenario)

  const [{ activarPerfilSesionCardnet, estadoSesionCardnet }, { ACTIVATION_CLAIM_STALE_MS }] = await Promise.all([
    import('../src/modules/pagos/cardnetClienteAcciones'),
    import('../src/modules/pagos/cardnetClienteShared'),
  ])
  const activation = activarPerfilSesionCardnet(
    new Request('http://localhost/activate', { method: 'POST' }),
    user,
    { sessionId: session.id, activationCode: 'ABC123' }
  )
  await firstReadStarted
  session.updatedAt = new Date(Date.now() - ACTIVATION_CLAIM_STALE_MS - 1000)

  const recovered = await estadoSesionCardnet(user, session.id, new Request('http://localhost/status'))
  releaseFirstRead(disabledCustomer)
  const original = await activation

  assert.equal(recovered.status, 202)
  assert.equal(original.status, 202)
  assert.equal(scenario.chargeCalls, 1)
  assert.equal(scenario.activationCalls, 0)
  assert.equal(scenario.intentCreates, 0)
})
