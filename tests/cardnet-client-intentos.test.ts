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
    if (expected && typeof expected === 'object' && 'in' in expected) {
      return (expected.in as unknown[]).includes(row[key])
    }
    return row[key] === expected
  })
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
          Object.assign(intento, input.data)
          return { count: 1 }
        },
        update: async (input: { where: Row; data: Row }) => {
          if (input.where.id !== intento.id) throw new Error('intent missing')
          Object.assign(intento, input.data)
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
