import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SessionUser } from '../src/types'

const support = pathToFileURL(path.resolve('tests/support/cardnet-service-stub.mjs')).href
const serverOnly = pathToFileURL(path.resolve('tests/support/server-only-stub.mjs')).href
const serviceDependencies = new Set([
  'next/cache', '@/lib/tenant', '@/lib/auth', '@/lib/server-utils', '@/lib/rate-limit',
  '@/modules/storage/comprobantes', '@/modules/notificaciones/service', '@/lib/payments',
  '@/modules/pagos/activacionCompra', '@/modules/promociones/compra', '@/modules/cliente/afiliacion',
  '@/modules/pagos/cardnetClienteSesionStore',
])

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: serverOnly, shortCircuit: true }
    if (serviceDependencies.has(specifier)) return { url: support, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

test('duplicate promotion acquisition returns the existing purchase id', async () => {
  const purchase = { id: 'existing-purchase', estado: 'PENDIENTE_PAGO' }
  const client = { id: 'qa-client', supabaseId: 'qa-user', companyId: 'qa-company', email: 'qa@example.test' }
  const promotion = {
    id: 'promo-1', companyId: 'qa-company', visibilidad: 'publica', precio: 1250,
    limitePorCliente: null, usosPorCompra: 1,
  }
  Reflect.set(globalThis, '__cardnetServiceScenario', {
    tx: {
      cliente: { findUnique: async () => client },
      promocion: { findUnique: async () => promotion },
      productoCompra: { findFirst: async () => purchase },
    },
  })
  const user: SessionUser = {
    supabaseId: 'qa-user', email: 'qa@example.test',
    metadata: { role: 'CLIENTE', dbUserId: 'qa-db-user', clienteId: 'qa-client', companyId: 'qa-company' },
  }

  const { adquirirPromocion } = await import('../src/modules/promociones/compraService')
  const result = await adquirirPromocion(user, 'promo-1')

  assert.deepEqual(result, {
    error: 'Ya tienes una compra de esta promoción en proceso.',
    compraId: 'existing-purchase',
  })
})

test('promotion action preserves the existing purchase id from the service', async () => {
  const purchase = { id: 'existing-purchase', estado: 'PENDIENTE_PAGO' }
  const client = { id: 'qa-client', supabaseId: 'qa-user', companyId: 'qa-company', email: 'qa@example.test' }
  const promotion = {
    id: 'promo-1', companyId: 'qa-company', visibilidad: 'publica', precio: 1250,
    limitePorCliente: null, usosPorCompra: 1,
  }
  const user: SessionUser = {
    supabaseId: 'qa-user', email: 'qa@example.test',
    metadata: { role: 'CLIENTE', dbUserId: 'qa-db-user', clienteId: 'qa-client', companyId: 'qa-company' },
  }
  Reflect.set(globalThis, '__cardnetServiceScenario', {
    authUser: user,
    tx: {
      cliente: { findUnique: async () => client },
      promocion: { findUnique: async () => promotion },
      productoCompra: { findFirst: async () => purchase },
    },
  })
  const form = new FormData()
  form.set('promocionId', 'promo-1')

  const { solicitarCompraPromocion } = await import('../src/modules/promociones/compraActions')
  const result = await solicitarCompraPromocion({}, form)

  assert.deepEqual(result, {
    error: 'Ya tienes una compra de esta promoción en proceso.',
    compraId: 'existing-purchase',
  })
})

test('mobile promotion BFF keeps duplicate errors on the safe error-only contract', async () => {
  const client = { id: 'qa-client', supabaseId: 'qa-user', companyId: 'qa-company', email: 'qa@example.test' }
  const promotion = {
    id: 'promo-1', companyId: 'qa-company', visibilidad: 'publica', precio: 1250,
    limitePorCliente: null, usosPorCompra: 1,
  }
  const user: SessionUser = {
    supabaseId: 'qa-user', email: 'qa@example.test',
    metadata: { role: 'CLIENTE', dbUserId: 'qa-db-user', clienteId: 'qa-client', companyId: 'qa-company' },
  }
  Reflect.set(globalThis, '__cardnetServiceScenario', {
    tx: {
      cliente: { findUnique: async () => client },
      promocion: { findUnique: async () => promotion },
      productoCompra: {
        findFirst: async () => ({ id: 'existing-purchase', estado: 'PENDIENTE_PAGO' }),
      },
    },
  })

  const { comprarPromocionCardnet } = await import('../src/modules/pagos/cardnetClientePromocion')
  const result = await comprarPromocionCardnet(user, 'promo-1')

  assert.deepEqual(result, {
    status: 409,
    body: { ok: false, error: 'Ya tienes una compra de esta promoción en proceso.' },
  })
})
