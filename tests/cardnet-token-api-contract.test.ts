import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const serverOnly = pathToFileURL(path.resolve('tests/support/server-only-stub.mjs')).href
const runtime = pathToFileURL(path.resolve('tests/support/cardnet-token-api-runtime.mjs')).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: serverOnly, shortCircuit: true }
    if (specifier === '@/lib/prisma-errors') return { url: runtime, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

const previous = {
  publicKey: process.env.CARDNET_TOKENS_PUBLIC_KEY,
  privateKey: process.env.CARDNET_TOKENS_PRIVATE_KEY,
  environment: process.env.CARDNET_TOKENS_AMBIENTE,
  apiBase: process.env.CARDNET_TOKENS_API_BASE,
  fetch: globalThis.fetch,
}

after(() => {
  if (previous.publicKey === undefined) delete process.env.CARDNET_TOKENS_PUBLIC_KEY
  else process.env.CARDNET_TOKENS_PUBLIC_KEY = previous.publicKey
  if (previous.privateKey === undefined) delete process.env.CARDNET_TOKENS_PRIVATE_KEY
  else process.env.CARDNET_TOKENS_PRIVATE_KEY = previous.privateKey
  if (previous.environment === undefined) delete process.env.CARDNET_TOKENS_AMBIENTE
  else process.env.CARDNET_TOKENS_AMBIENTE = previous.environment
  if (previous.apiBase === undefined) delete process.env.CARDNET_TOKENS_API_BASE
  else process.env.CARDNET_TOKENS_API_BASE = previous.apiBase
  globalThis.fetch = previous.fetch
})

test('Purchase with an unknown network outcome is not retried against another API host', async () => {
  process.env.CARDNET_TOKENS_PUBLIC_KEY = 'qa-public-key'
  process.env.CARDNET_TOKENS_PRIVATE_KEY = 'qa-private-key'
  process.env.CARDNET_TOKENS_AMBIENTE = 'pruebas'
  delete process.env.CARDNET_TOKENS_API_BASE
  const requests: string[] = []
  globalThis.fetch = async (input) => {
    requests.push(String(input))
    throw new Error('simulated response timeout')
  }

  const { cobrarConToken } = await import('../src/lib/payments/cardnet-tokens')
  const result = await cobrarConToken({
    trxToken: 'qa-payment-token',
    pesos: 1000,
    orden: 'qa-order',
    clienteIp: '127.0.0.1',
    purchaseUniqueId: 'stable-purchase-key',
  })
  assert.equal(result.aprobada, false)
  assert.equal(result.crudo._http, 0)
  assert.equal(requests.length, 1)
  assert.match(requests[0] ?? '', /^https:\/\/lab\.cardnet\.com\.do\//)
})

test('PaymentProfileDelete sends the documented numeric id using Basic user authentication', async () => {
  const publicKey = 'qa-public-key'
  const privateKey = 'qa-private-key'
  process.env.CARDNET_TOKENS_PUBLIC_KEY = publicKey
  process.env.CARDNET_TOKENS_PRIVATE_KEY = privateKey
  process.env.CARDNET_TOKENS_AMBIENTE = 'pruebas'
  const expectedAuthorization = `Basic ${Buffer.from(`${privateKey}:`).toString('base64')}`
  const requests: Array<{ url: string; authorization: string | null; body: unknown }> = []
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers)
    let body: unknown = null
    if (typeof init?.body === 'string') body = JSON.parse(init.body)
    requests.push({ url: String(input), authorization: headers.get('Authorization'), body })
    return headers.get('Authorization') === expectedAuthorization
      ? new Response(JSON.stringify({ Response: {}, Errors: [] }), { status: 200 })
      : new Response(JSON.stringify({ Errors: [{ ErrorCode: 'AUTH' }] }), { status: 401 })
  }

  const { borrarPerfilCardnet } = await import('../src/lib/payments/cardnet-tokens')
  assert.equal(await borrarPerfilCardnet({ customerId: '12345', paymentProfileId: '67890' }), true)
  assert.equal(requests[0]?.authorization, expectedAuthorization)
  assert.ok(requests.some((request) => request.authorization === expectedAuthorization))
  const accepted = requests.find((request) => request.authorization === expectedAuthorization)
  assert.deepEqual(accepted?.body, { PaymentProfileId: 67890 })
  assert.equal(typeof (accepted?.body as { PaymentProfileId: unknown }).PaymentProfileId, 'number')
  assert.ok(accepted?.url.endsWith('/Customer/12345/PaymentProfileDelete'))
})

test('PaymentProfileDelete rejects a nonnumeric profile id before contacting CardNET', async () => {
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return new Response('{}', { status: 200 })
  }
  const { borrarPerfilCardnet } = await import('../src/lib/payments/cardnet-tokens')
  assert.equal(await borrarPerfilCardnet({ customerId: '12345', paymentProfileId: 'profile-invalid' }), false)
  assert.equal(requests, 0)
})
