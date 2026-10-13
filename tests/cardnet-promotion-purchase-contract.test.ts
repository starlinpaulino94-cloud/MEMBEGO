import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

const clientDependencyStub = pathToFileURL(
  path.resolve('tests/support/cardnet-client-api-runtime.mjs')
).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.endsWith('/apps/client/src/lib/api.ts') &&
      ['react-native', 'expo-constants', './supabase', './runtimeUrls'].includes(specifier)
    ) {
      return { url: clientDependencyStub, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

async function withApiResponse<T>(expectedPath: string, body: unknown, action: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    assert.equal(String(input), `https://api.invalid${expectedPath}`)
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    return await action()
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('free promotion response needs no payment fields and strips sensitive properties', async () => {
  const { api } = await import('../apps/client/src/lib/api')
  const result = await withApiResponse(
    '/api/v1/cliente/promociones/promo-1/comprar',
    {
      status: 'free_activated',
      compraId: 'free-purchase-1',
      paymentProfileToken: 'must-not-reach-client',
      customerId: 'must-not-reach-client',
      providerStatus: 'APPROVED',
    },
    () => api.comprarPromocion('promo-1')
  )

  assert.deepEqual(result, { status: 'free_activated', compraId: 'free-purchase-1' })
})

test('paid promotion response requires server amount and currency and strips sensitive properties', async () => {
  const { api } = await import('../apps/client/src/lib/api')
  const result = await withApiResponse(
    '/api/v1/cliente/promociones/promo-1/comprar',
    {
      status: 'payment_required',
      compraId: 'paid-purchase-1',
      amount: 1250,
      currency: 'DOP',
      paymentProfileToken: 'must-not-reach-client',
      customerId: 'must-not-reach-client',
      providerStatus: 'APPROVED',
    },
    () => api.comprarPromocion('promo-1')
  )

  assert.deepEqual(result, {
    status: 'payment_required',
    compraId: 'paid-purchase-1',
    amount: 1250,
    currency: 'DOP',
  })
  await assert.rejects(
    withApiResponse(
      '/api/v1/cliente/promociones/promo-1/comprar',
      { status: 'payment_required', compraId: 'paid-purchase-2' },
      () => api.comprarPromocion('promo-1')
    )
  )
})

test('CardNET start accepts target-scoped processing without capture credentials', async () => {
  const { api } = await import('../apps/client/src/lib/api')
  const result = await withApiResponse(
    '/api/v1/cliente/pagos/cardnet/sesion',
    {
      status: 'processing',
      sessionId: 'session-recovery-1',
      captureNonce: 'must-not-reach-client',
      captureUrl: 'https://provider.invalid/capture',
      token: 'must-not-reach-client',
      providerSessionId: 'must-not-reach-client',
    },
    () => api.startCardnetSession({ kind: 'promotion', compraId: 'paid-purchase-1' })
  )

  assert.deepEqual(result, { status: 'processing', sessionId: 'session-recovery-1' })
})

test('CardNET start rejects a processing response that also carries capture fields', async () => {
  const { api, cardnetSessionStartResponseSchema } = await import('../apps/client/src/lib/api')
  const { cardnetCaptureSessionSchema } = await import('../apps/client/src/lib/cardnet-api-contracts')
  const response = {
    status: 'processing',
    sessionId: 'session-recovery-2',
    captureNonce: 'must-not-be-used',
    expiresAt: '2026-10-06T16:00:00.000Z',
    amount: 1250,
    currency: 'DOP',
    captureUrl: 'https://provider.invalid/capture',
    scriptUrl: 'https://provider.invalid/script.js',
    publicKey: 'public-key',
    uniqueId: 'unique-2',
  }

  assert.equal(cardnetCaptureSessionSchema.safeParse(response).success, false)
  assert.equal(cardnetSessionStartResponseSchema.safeParse(response).success, false)
  await assert.rejects(
    withApiResponse(
      '/api/v1/cliente/pagos/cardnet/sesion',
      response,
      () => api.startCardnetSession({ kind: 'promotion', compraId: 'paid-purchase-1' })
    )
  )
})

test('CardNET capture rejects a session missing a required field', async () => {
  const { cardnetCaptureSessionSchema } = await import('../apps/client/src/lib/cardnet-api-contracts')
  const capture = {
    sessionId: 'session-capture-2',
    captureNonce: 'nonce-2',
    expiresAt: '2026-10-06T16:00:00.000Z',
    amount: 1250,
    currency: 'DOP',
    captureUrl: 'https://provider.invalid/capture',
    scriptUrl: 'https://provider.invalid/script.js',
    publicKey: 'public-key',
    uniqueId: 'unique-2',
  }
  const missingPublicKey = Object.fromEntries(
    Object.entries(capture).filter(([field]) => field !== 'publicKey')
  )

  assert.equal(cardnetCaptureSessionSchema.safeParse(missingPublicKey).success, false)
})

test('CardNET start still accepts complete capture sessions', async () => {
  const { api } = await import('../apps/client/src/lib/api')
  const result = await withApiResponse(
    '/api/v1/cliente/pagos/cardnet/sesion',
    {
      sessionId: 'session-capture-1',
      captureNonce: 'nonce-1',
      expiresAt: '2026-10-06T16:00:00.000Z',
      amount: 1250,
      currency: 'DOP',
      captureUrl: 'https://provider.invalid/capture',
      scriptUrl: 'https://provider.invalid/script.js',
      publicKey: 'public-key',
      uniqueId: 'unique-1',
      paymentProfileToken: 'must-not-reach-client',
    },
    () => api.startCardnetSession({ kind: 'promotion', compraId: 'paid-purchase-1' })
  )

  assert.deepEqual(result, {
    sessionId: 'session-capture-1',
    captureNonce: 'nonce-1',
    expiresAt: '2026-10-06T16:00:00.000Z',
    amount: 1250,
    currency: 'DOP',
    captureUrl: 'https://provider.invalid/capture',
    scriptUrl: 'https://provider.invalid/script.js',
    publicKey: 'public-key',
    uniqueId: 'unique-1',
  })
})
