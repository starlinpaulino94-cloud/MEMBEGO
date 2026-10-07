import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

type Row = Record<string, unknown>

const runtime = pathToFileURL(path.resolve('tests/support/pago-intento-runtime.mjs')).href
const mocked = new Set([
  '@/lib/tenant',
  '@/lib/prisma-errors',
  '@/modules/pagos/activacionCompra',
  '@/modules/pagos/activacion',
])

registerHooks({
  resolve(specifier, context, next) {
    if (mocked.has(specifier)) return { url: runtime, shortCircuit: true }
    return next(specifier, context)
  },
})

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object') {
      if ('in' in expected) return (expected.in as unknown[]).includes(row[key])
      if ('lt' in expected) return row[key] instanceof Date && row[key] < (expected.lt as Date)
      if ('gt' in expected) return row[key] instanceof Date && row[key] > (expected.gt as Date)
    }
    return row[key] === expected
  })
}

function applyData(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      row[key] = Number(row[key] ?? 0) + Number(value.increment)
    } else {
      row[key] = value
    }
  }
}

test('a late approval cannot deliver after a concurrent decline closes the intent', async () => {
  let releaseApproval: () => void = () => undefined
  let announceApproval: () => void = () => undefined
  const approvalGate = new Promise<void>((resolve) => { releaseApproval = resolve })
  const approvalStarted = new Promise<void>((resolve) => { announceApproval = resolve })
  const intento: Row = {
    id: 'intent-test',
    companyId: 'company-test',
    compraId: 'purchase-test',
    membershipId: null,
    monto: 1000,
    estado: 'REDIRIGIDO',
    activadoAt: null,
    fulfillmentEstado: 'PENDIENTE',
  }
  const scenario = {
    activationCalls: 0,
    tx: {
      pagoIntento: {
        findUnique: async (input: { where: Row }) =>
          input.where.id === intento.id ? { ...intento } : null,
        updateMany: async (input: { where: Row; data: Row }) => {
          if (input.data.estado === 'APROBADO') {
            announceApproval()
            await approvalGate
          }
          if (!matches(intento, input.where)) return { count: 0 }
          applyData(intento, input.data)
          return { count: 1 }
        },
        update: async (input: { where: Row; data: Row }) => {
          if (input.where.id !== intento.id) throw new Error('intent missing')
          applyData(intento, input.data)
          return intento
        },
      },
    },
  }
  Object.assign(globalThis, { __pagoIntentoScenario: scenario })

  const { confirmarIntento } = await import('../src/modules/pagos/intentos')
  const approved = confirmarIntento('intent-test', {
    aprobada: true,
    autorizacion: 'AUTH-TEST',
    motivo: null,
    crudo: {},
    montoCobrado: 1000,
  })
  await approvalStarted

  const declined = await confirmarIntento('intent-test', {
    aprobada: false,
    autorizacion: null,
    motivo: 'CardNET confirmó el rechazo.',
    crudo: {},
  })
  assert.equal(declined.ok, false)
  assert.equal(intento.estado, 'RECHAZADO')

  releaseApproval()
  const staleApproval = await approved
  assert.equal(staleApproval.ok, false)
  assert.equal(staleApproval.estado, 'RECHAZADO')
  assert.equal(intento.estado, 'RECHAZADO')
  assert.equal(scenario.activationCalls, 0)
})

test('a stale fulfillment claim is recovered after a server interruption', async () => {
  const intento: Row = {
    id: 'intent-stale-fulfillment',
    companyId: 'company-test',
    compraId: 'purchase-test',
    membershipId: null,
    estado: 'APROBADO',
    activadoAt: new Date(Date.now() - 120_000),
    fulfillmentEstado: 'PROCESANDO',
    fulfillmentIntentos: 1,
    updatedAt: new Date(),
  }
  const scenario = {
    activationCalls: 0,
    tx: {
      pagoIntento: {
        findUnique: async (input: { where: Row }) =>
          input.where.id === intento.id ? { ...intento } : null,
        updateMany: async (input: { where: Row; data: Row }) => {
          if (!matches(intento, input.where)) return { count: 0 }
          applyData(intento, input.data)
          return { count: 1 }
        },
        update: async (input: { where: Row; data: Row }) => {
          if (input.where.id !== intento.id) throw new Error('intent missing')
          applyData(intento, input.data)
          return intento
        },
      },
    },
  }
  Object.assign(globalThis, { __pagoIntentoScenario: scenario })

  const { reintentarEntrega } = await import('../src/modules/pagos/intentos')
  const liveClaim = await reintentarEntrega('intent-stale-fulfillment')
  assert.equal(liveClaim.entrega, 'PENDIENTE')
  assert.equal(scenario.activationCalls, 0)

  intento.updatedAt = new Date(Date.now() - 120_000)
  const recovered = await reintentarEntrega('intent-stale-fulfillment')
  assert.equal(recovered.entrega, 'COMPLETADA')
  assert.equal(intento.fulfillmentEstado, 'COMPLETADA')
  assert.equal(intento.fulfillmentIntentos, 2)
  assert.equal(scenario.activationCalls, 1)
})
