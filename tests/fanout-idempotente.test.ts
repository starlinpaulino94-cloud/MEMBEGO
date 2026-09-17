import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'
import { esViolacionUnica } from '../src/lib/prisma-errors'

/**
 * FAN-OUT IDEMPOTENTE + RECLAMO CON LEASE · barrido de bugs ocultos (#4/#5).
 *
 * El outbox del bus de eventos tenía dos defectos con la misma raíz: cada
 * reenvío ACUÑABA una fila nueva (id/eventId distinto), así que re-despachar el
 * mismo evento —cuando el barrido reclamaba uno que quedó a medias— le llegaba
 * al destino como un evento nuevo imposible de deduplicar. Aquí se fija que:
 *   1. el fan-out es idempotente por (destino, evento de dominio),
 *   2. el barrido reclama los `processed:true` sin `despachadoAt` (lease),
 * con la clave: `esViolacionUnica` reconoce el P2002 que señala «ya se repartió».
 *
 * Lo puro (`esViolacionUnica`) se prueba de verdad; lo que toca la base es una
 * guardia estructural sobre el fuente, igual que el resto de la suite.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

// ─── el reconocedor del choque de unicidad (P2002) ──────────────────────────

test('esViolacionUnica reconoce SOLO el P2002 de Prisma', () => {
  const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'x',
  })
  assert.equal(esViolacionUnica(p2002), true, 'un P2002 es un choque de unicidad')

  const p2003 = new Prisma.PrismaClientKnownRequestError('fk', {
    code: 'P2003',
    clientVersion: 'x',
  })
  assert.equal(esViolacionUnica(p2003), false, 'un P2003 (FK) NO es unicidad')

  assert.equal(esViolacionUnica(new Error('boom')), false, 'un Error normal no lo es')
  assert.equal(esViolacionUnica(null), false, 'null no lo es')
  assert.equal(esViolacionUnica('P2002'), false, 'un string con el código no lo es')
})

// ─── #4 · esquema: las claves de idempotencia y el lease existen ────────────

test('el esquema declara la clave de idempotencia del reenvío a satélites', () => {
  const src = codigo('prisma/schema/integraciones.prisma')
  assert.match(src, /domainEventId\s+String\?/, 'falta la columna domainEventId en EventoSaliente')
  assert.match(src, /@@unique\(\[sistemaId,\s*domainEventId\]\)/, 'falta el UNIQUE(sistemaId, domainEventId)')
})

test('el esquema declara la clave de idempotencia del fan-out de webhooks', () => {
  const src = codigo('prisma/schema/connect.prisma')
  assert.match(src, /@@unique\(\[suscripcionId,\s*eventoId\]\)/, 'falta el UNIQUE(suscripcionId, eventoId)')
})

test('el esquema declara el lease del evento de dominio (despachadoAt)', () => {
  const src = codigo('prisma/schema/motores.prisma')
  assert.match(src, /despachadoAt\s+DateTime\?/, 'falta la columna despachadoAt en DomainEvent')
})

// ─── #4 · el reenvío a satélites acuña por (destino, evento) y salta el P2002 ─

test('reenviarEventoASistemas pasa domainEventId y salta el choque de unicidad', () => {
  const src = codigo('src/modules/integraciones/despacho.ts')
  assert.match(src, /domainEventId\?:\s*string\s*\|\s*null/, 'EventoParaEnviar no expone domainEventId')
  assert.match(src, /domainEventId:\s*evento\.domainEventId\s*\?\?\s*null/, 'el create no fija domainEventId')
  // El create se envuelve para que un P2002 se salte sin anotarlo como fallo.
  const i = src.indexOf('export async function reenviarEventoASistemas')
  const cuerpo = src.slice(i, src.indexOf('\ninterface FilaEvento', i))
  assert.ok(cuerpo.length > 0, 'no se pudo acotar el cuerpo de reenviarEventoASistemas')
  assert.match(cuerpo, /esViolacionUnica\(e\)/, 'el create no reconoce el P2002 para saltarlo')
})

// ─── #4 · el fan-out de webhooks salta el P2002 ─────────────────────────────

test('repartirEventoAWebhooks salta el choque de unicidad al recrear una entrega', () => {
  const src = codigo('src/modules/connect/webhooks.ts')
  const i = src.indexOf('export async function repartirEventoAWebhooks')
  const cuerpo = src.slice(i, src.indexOf('\nexport ', i + 1))
  assert.match(cuerpo, /esViolacionUnica\(e\)/, 'el create de entrega no reconoce el P2002 para saltarlo')
})

// ─── #4 · el bus enhebra el domainEventId y marca el lease al terminar ──────

test('el despacho enhebra domainEventId y marca despachadoAt al terminar el reparto', () => {
  const src = codigo('src/modules/estrategias/eventos.ts')
  assert.match(src, /domainEventId:\s*evento\.id/, 'no pasa el id del evento como clave de idempotencia')
  assert.match(src, /despachadoAt:\s*new Date\(\)/, 'no marca despachadoAt cuando el reparto termina')
})

// ─── #5 · el reintento reclama el intento antes de enviar (compare-and-set) ─

test('intentarEvento reclama el intento con un compare-and-set antes de enviar', () => {
  const src = codigo('src/modules/integraciones/despacho.ts')
  const i = src.indexOf('async function intentarEvento')
  const cuerpo = src.slice(i, src.indexOf('\nexport async function reintentarEventoSaliente', i))
  assert.ok(cuerpo.length > 0, 'no se pudo acotar el cuerpo de intentarEvento')

  // El claim es un updateMany guardado por (id, PENDIENTE, intentos) que sube el
  // contador: un solo camino gana; el resto ve count:0.
  assert.match(
    cuerpo,
    /updateMany\(\{[\s\S]*?where:\s*\{\s*id:\s*ev\.id,\s*estado:\s*'PENDIENTE',\s*intentos:\s*ev\.intentos\s*\}/,
    'el reintento no reclama el intento con compare-and-set'
  )
  // El claim ocurre ANTES de tocar la red: la posición del reclamo precede a la
  // del `entregar(`.
  const posClaim = cuerpo.indexOf('reclamar intento del evento')
  const posEnvio = cuerpo.indexOf('await entregar(')
  assert.ok(posClaim !== -1 && posEnvio !== -1, 'faltan el claim o el envío')
  assert.ok(posClaim < posEnvio, 'el envío ocurre antes del reclamo: la carrera sigue abierta')
  // Si el claim no gana, se omite sin enviar.
  assert.match(cuerpo, /claim\.count === 0\)\s*return 'omitido'/, 'un claim perdido no se omite')
})

// ─── #4 · el barrido reclama los procesados a medias (lease) ────────────────

test('barrerEventosEstrategia reclama los processed:true sin despachadoAt pasado el lease', () => {
  const src = codigo('src/modules/estrategias/eventos.ts')
  const i = src.indexOf('export async function barrerEventosEstrategia')
  const cuerpo = src.slice(i)
  // Busca los procesados a medias…
  assert.match(cuerpo, /processed:\s*true,\s*despachadoAt:\s*null/, 'el barrido no busca los procesados a medias')
  // …y los reabre de forma atómica solo si siguen sin despachar.
  assert.match(
    cuerpo,
    /where:\s*\{\s*id:\s*ev\.id,\s*processed:\s*true,\s*despachadoAt:\s*null\s*\}/,
    'la reapertura del varado no es atómica sobre el lease'
  )
})
