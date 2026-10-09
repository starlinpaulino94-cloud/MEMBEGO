import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { test, before, after } from 'node:test'
import '../support/cardnet-postgres-service-hooks.mjs'
import { prisma } from '../../src/lib/prisma'
import type { SessionUser } from '../../src/types'

type Barrier = {
  arrivals: number
  readonly parties: number
  readonly promise: Promise<void>
  readonly release: () => void
}

type Scenario = {
  email: string
  configReads: number
  customerIdCreates: number
  customerGets: number
  capabilityChecks: number
  amountLookups: number
  charges: number
  purchaseSearches: number
  profileActivations: number
  profileAvailable: boolean
  purchaseApproved: boolean
  targetBarrier: Barrier | undefined
  reservationBarrier: Barrier | undefined
}

type Fixture = {
  readonly suffix: string
  readonly companyId: string
  readonly clienteId: string
  readonly membershipId: string
  readonly authSubject: string
  readonly email: string
  readonly user: SessionUser
}

const scenario: Scenario = {
  email: 'cardnet-qa@example.test',
  configReads: 0,
  customerIdCreates: 0,
  customerGets: 0,
  capabilityChecks: 0,
  amountLookups: 0,
  charges: 0,
  purchaseSearches: 0,
  profileActivations: 0,
  profileAvailable: false,
  purchaseApproved: false,
  targetBarrier: undefined,
  reservationBarrier: undefined,
}
Object.assign(globalThis, { __cardnetPostgresScenario: scenario })

let servicePromise: Promise<typeof import('../../src/modules/pagos/cardnetCliente')> | null = null
function loadService() {
  servicePromise ??= import('../../src/modules/pagos/cardnetCliente')
  return servicePromise
}

function assertDisposableDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL must target the disposable PostgreSQL QA database')
  const parsed = new URL(databaseUrl)
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '15432' || parsed.pathname !== '/cardnetqa') {
    throw new Error('CardNET PostgreSQL QA is restricted to 127.0.0.1:15432/cardnetqa')
  }
}

function makeBarrier(parties = 2): Barrier {
  let releasePromise: (() => void) | undefined
  const promise = new Promise<void>((resolve) => { releasePromise = resolve })
  return {
    arrivals: 0,
    parties,
    promise,
    release() {
      const resolve = releasePromise
      if (!resolve) return
      releasePromise = undefined
      resolve()
    },
  }
}

function resetScenario(barriers: {
  readonly targetBarrier?: Barrier
  readonly reservationBarrier?: Barrier
} = {}): void {
  scenario.configReads = 0
  scenario.customerIdCreates = 0
  scenario.customerGets = 0
  scenario.capabilityChecks = 0
  scenario.amountLookups = 0
  scenario.charges = 0
  scenario.purchaseSearches = 0
  scenario.profileActivations = 0
  scenario.profileAvailable = false
  scenario.purchaseApproved = false
  scenario.targetBarrier = barriers.targetBarrier
  scenario.reservationBarrier = barriers.reservationBarrier
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID().replaceAll('-', '')
  const companyId = `qa-${suffix}`
  const clienteId = `qa-cliente-${suffix}`
  const membershipId = `qa-membership-${suffix}`
  const authSubject = `qa-user-${suffix}`
  const email = `cardnet-${suffix}@example.test`
  const fixture: Fixture = {
    suffix,
    companyId,
    clienteId,
    membershipId,
    authSubject,
    email,
    user: {
      supabaseId: authSubject,
      email,
      metadata: { role: 'CLIENTE', dbUserId: `qa-db-user-${suffix}`, clienteId, companyId },
    },
  }
  await prisma.company.create({ data: { id: companyId, name: 'CardNET PostgreSQL QA', slug: `qa-cardnet-${suffix}`, type: 'carwash' } })
  await prisma.plan.create({ data: { id: `qa-plan-${suffix}`, companyId, nombre: 'QA Plan', precio: 1000, beneficios: [] } })
  await prisma.cliente.create({ data: { id: clienteId, companyId, supabaseId: authSubject, nombre: 'QA Client', email } })
  await prisma.membership.create({ data: { id: membershipId, companyId, clienteId, planId: `qa-plan-${suffix}`, estado: 'PENDIENTE' } })
  return fixture
}

function responseString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string') throw new Error(`Expected string response field: ${key}`)
  return value
}

async function startSession(user: SessionUser, membershipId: string) {
  const api = await loadService()
  return api.iniciarSesionCardnet(new Request('http://localhost/session'), user, { membershipId })
}

async function confirmSession(user: SessionUser, sessionId: string, captureNonce: string) {
  const api = await loadService()
  return api.confirmarSesionCardnet(new Request('http://localhost/confirm'), user, {
    sessionId,
    captureNonce,
    token: 'qa-only-capture-token',
  })
}

function isTargetConstraintViolation(error: unknown): boolean {
  return error instanceof Error &&
    error.message.includes('cardnet_capture_sessions_target_xor_check') &&
    error.message.includes('23514')
}

before(async () => {
  assertDisposableDatabase()
  await prisma.$connect()
})

after(async () => {
  await prisma.$disconnect()
  Reflect.deleteProperty(globalThis, '__cardnetPostgresScenario')
})

test('PostgreSQL uniqueness admits one reservation when service starts race', async () => {
  const fixture = await createFixture()
  resetScenario({ targetBarrier: makeBarrier(), reservationBarrier: makeBarrier() })
  scenario.email = fixture.email

  const results = await Promise.all([
    startSession(fixture.user, fixture.membershipId),
    startSession(fixture.user, fixture.membershipId),
  ])

  const statuses = results.map((result) => result.status).sort((left, right) => left - right)
  assert.deepEqual(statuses, [200, 409])
  const successfulStart = results.find((result) => result.status === 200)
  assert.ok(successfulStart)
  for (const field of ['sessionId', 'captureNonce', 'captureUrl', 'scriptUrl', 'publicKey', 'uniqueId']) {
    assert.ok(responseString(successfulStart.body, field).length > 0, `Expected nonempty ${field}`)
  }
  const sessions = await prisma.cardnetCaptureSession.findMany({
    where: { companyId: fixture.companyId, clienteId: fixture.clienteId },
  })
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0]?.estado, 'CAPTURE_OPEN')
  assert.equal(sessions[0]?.reservaClienteKey, createHashReservationKey(fixture.companyId, fixture.clienteId))
  assert.equal(scenario.customerIdCreates, 1)
  assert.equal(scenario.customerGets, 1)
  assert.equal(scenario.charges, 0)
  assert.equal(scenario.purchaseSearches, 0)
  assert.equal(scenario.profileActivations, 0)
  console.log('QA reservation result: statuses=200,409; rows=1; state=CAPTURE_OPEN; key=sha256(companyId:clienteId); customerCreates=1; customerGets=1; charges=0; purchaseSearches=0; profileActivations=0; payload=complete')
  console.log(`QA reservation SQL scope: companyId=${fixture.companyId} clienteId=${fixture.clienteId}`)
})

test('PostgreSQL nonce CAS allows one concurrent consume and rejects replay', async () => {
  const fixture = await createFixture()
  resetScenario()
  scenario.email = fixture.email
  const started = await startSession(fixture.user, fixture.membershipId)
  assert.equal(started.status, 200)
  const sessionId = responseString(started.body, 'sessionId')
  const captureNonce = responseString(started.body, 'captureNonce')
  resetScenario({ targetBarrier: makeBarrier() })

  const confirmations = await Promise.all([
    confirmSession(fixture.user, sessionId, captureNonce),
    confirmSession(fixture.user, sessionId, captureNonce),
  ])

  const confirmationStatuses = confirmations.map((result) => result.status).sort((left, right) => left - right)
  assert.deepEqual(confirmationStatuses, [202, 409])
  const consumed = await prisma.cardnetCaptureSession.findUniqueOrThrow({ where: { id: sessionId } })
  assert.equal(consumed.estado, 'PROFILE_PENDING')
  assert.equal(consumed.captureNonce, null)
  assert.equal(consumed.reservaClienteKey !== null, true)
  assert.equal(scenario.customerGets, 1)
  assert.equal(scenario.customerIdCreates, 0)
  assert.equal(scenario.charges, 0)
  assert.equal(scenario.profileActivations, 0)

  const replay = await confirmSession(fixture.user, sessionId, captureNonce)
  assert.equal(replay.status, 409)
  assert.equal(scenario.customerGets, 1)
  console.log('QA nonce CAS result: statuses=202,409; state=PROFILE_PENDING; nonceCleared=true; reservationHeld=true; customerGets=1; charges=0; replay=409; customerGetsAfterReplay=1')
})

test('approved Purchase persists one intent and fulfills the membership exactly once across replay', async () => {
  const fixture = await createFixture()
  resetScenario()
  scenario.email = fixture.email
  const started = await startSession(fixture.user, fixture.membershipId)
  assert.equal(started.status, 200)
  const sessionId = responseString(started.body, 'sessionId')
  const captureNonce = responseString(started.body, 'captureNonce')
  scenario.profileAvailable = true
  scenario.purchaseApproved = true

  const confirmed = await confirmSession(fixture.user, sessionId, captureNonce)

  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.body.status, 'approved')
  const session = await prisma.cardnetCaptureSession.findUniqueOrThrow({ where: { id: sessionId } })
  assert.equal(session.estado, 'APPROVED')
  assert.equal(session.reservaClienteKey, null)
  const intent = await prisma.pagoIntento.findUniqueOrThrow({ where: { id: session.purchaseIntentId ?? '' } })
  assert.equal(intent.estado, 'APROBADO')
  assert.equal(intent.fulfillmentEstado, 'COMPLETADA')
  assert.equal(intent.fulfillmentIntentos, 1)
  assert.equal(await prisma.membership.count({ where: { id: fixture.membershipId, estado: 'ACTIVA', pagoConfirmado: true } }), 1)
  assert.equal(await prisma.qrToken.count({ where: { membresiaId: fixture.membershipId } }), 1)

  const replay = await confirmSession(fixture.user, sessionId, captureNonce)

  assert.equal(replay.status, 409)
  const replayedIntent = await prisma.pagoIntento.findUniqueOrThrow({ where: { id: intent.id } })
  assert.equal(replayedIntent.fulfillmentIntentos, 1)
  assert.equal(await prisma.qrToken.count({ where: { membresiaId: fixture.membershipId } }), 1)
  assert.equal(scenario.charges, 1)
  assert.equal(scenario.customerGets, 2)
  assert.equal(scenario.purchaseSearches, 0)
  assert.equal(scenario.profileActivations, 0)
  console.log(`QA Purchase lifecycle SQL scope: sessionId=${sessionId} intentId=${intent.id} membershipId=${fixture.membershipId}; providerStub customerGets=2 charges=1 purchaseSearches=0 profileActivations=0`)
})

test('expired capture clears its reservation before rejecting consume', async () => {
  const fixture = await createFixture()
  resetScenario()
  scenario.email = fixture.email
  const started = await startSession(fixture.user, fixture.membershipId)
  assert.equal(started.status, 200)
  const sessionId = responseString(started.body, 'sessionId')
  const captureNonce = responseString(started.body, 'captureNonce')
  await prisma.cardnetCaptureSession.update({
    where: { id: sessionId },
    data: { venceAt: new Date(Date.now() - 1_000) },
  })
  resetScenario()

  const expired = await confirmSession(fixture.user, sessionId, captureNonce)

  assert.equal(expired.status, 409)
  const session = await prisma.cardnetCaptureSession.findUniqueOrThrow({ where: { id: sessionId } })
  assert.equal(session.estado, 'EXPIRED')
  assert.equal(session.reservaClienteKey, null)
  assert.equal(session.captureNonce, null)
  assert.equal(scenario.customerGets, 0)
  assert.equal(scenario.profileActivations, 0)
  console.log('QA expiry result: start=200; confirm=409; state=EXPIRED; reservationReleased=true; nonceCleared=true; customerGets=0')
})

test('PostgreSQL rejects capture rows with zero or two target ids', async () => {
  const fixture = await createFixture()
  const insertTargetTuple = (membershipId: string | null, compraId: string | null) => prisma.$executeRaw`
    INSERT INTO "cardnet_capture_sessions"
      ("id", "authSubject", "companyId", "clienteId", "monto", "venceAt", "membershipId", "compraId")
    VALUES
      (${`qa-${randomUUID()}`}, ${fixture.authSubject}, ${fixture.companyId}, ${fixture.clienteId}, 1000,
       CURRENT_TIMESTAMP, ${membershipId}, ${compraId})
  `

  await assert.rejects(insertTargetTuple(null, null), isTargetConstraintViolation)
  await assert.rejects(insertTargetTuple(fixture.membershipId, `missing-purchase-${fixture.suffix}`), isTargetConstraintViolation)
  console.log('QA malformed target result: null/null and membership+purchase rejected; SQLSTATE=23514; constraint=cardnet_capture_sessions_target_xor_check')
})

function createHashReservationKey(companyId: string, clienteId: string): string {
  return createHash('sha256').update(`${companyId}:${clienteId}`).digest('hex')
}
