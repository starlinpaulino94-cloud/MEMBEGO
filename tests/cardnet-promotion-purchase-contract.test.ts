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

async function withPurchaseResponse<T>(body: unknown, action: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    assert.equal(String(input), 'https://api.invalid/api/v1/cliente/promociones/promo-1/comprar')
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
  const result = await withPurchaseResponse(
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
  const result = await withPurchaseResponse(
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
    withPurchaseResponse(
      { status: 'payment_required', compraId: 'paid-purchase-2' },
      () => api.comprarPromocion('promo-1')
    )
  )
})
