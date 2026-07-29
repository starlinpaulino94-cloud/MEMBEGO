/**
 * Cola de trabajos — pruebas de la VERIFICACIÓN DE FIRMA. Ejecutar: npm test
 *
 * POR QUÉ SE PRUEBA ESTO Y NO EL RESTO DE LA COLA:
 *
 * `/api/jobs` es un endpoint PÚBLICO —tiene que serlo, QStash lo llama desde
 * fuera— que hace escrituras masivas: notificar a todos los clientes de una
 * empresa. Lo único que separa eso de "cualquiera en internet puede disparar
 * cien mil inserciones" es esta función.
 *
 * Y es una función fácil de romper sin darse cuenta al "limpiarla": quitar la
 * comprobación del hash del cuerpo, cambiar `timingSafeEqual` por `===`, o
 * aceptar un token sin firma. Ninguna de esas tres cosas rompe el camino feliz
 * —los mensajes legítimos siguen pasando— así que sin pruebas nadie se entera.
 */

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, createHash } from 'crypto'
import { verificarFirma } from '../src/lib/jobs/qstash'

const CLAVE = 'clave-de-firma-de-prueba'

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString('base64url')
}

/** Construye un JWT como el que emite QStash. */
function firmar(
  cuerpo: string,
  opciones: { clave?: string; exp?: number; nbf?: number; omitirBody?: boolean } = {}
): string {
  const ahora = Math.floor(Date.now() / 1000)
  const cabecera = b64url({ alg: 'HS256', typ: 'JWT' })
  const carga = b64url({
    iss: 'Upstash',
    exp: opciones.exp ?? ahora + 300,
    nbf: opciones.nbf ?? ahora - 10,
    ...(opciones.omitirBody
      ? {}
      : { body: createHash('sha256').update(cuerpo).digest('base64url') }),
  })
  const firma = createHmac('sha256', opciones.clave ?? CLAVE)
    .update(`${cabecera}.${carga}`)
    .digest('base64url')
  return `${cabecera}.${carga}.${firma}`
}

beforeEach(() => {
  process.env.QSTASH_CURRENT_SIGNING_KEY = CLAVE
  delete process.env.QSTASH_NEXT_SIGNING_KEY
})

test('acepta un mensaje legítimo', () => {
  const cuerpo = JSON.stringify({ tipo: 'notificar', companyId: 'c1' })
  assert.equal(verificarFirma(firmar(cuerpo), cuerpo), true)
})

test('rechaza una firma hecha con otra clave', () => {
  const cuerpo = '{"tipo":"automatizaciones"}'
  assert.equal(verificarFirma(firmar(cuerpo, { clave: 'otra' }), cuerpo), false)
})

test('rechaza un cuerpo distinto del firmado', () => {
  // El ataque que importa: capturar una firma válida y reusarla para ejecutar
  // el trabajo sobre OTRA empresa.
  const original = JSON.stringify({ tipo: 'notificar', companyId: 'empresa-a' })
  const alterado = JSON.stringify({ tipo: 'notificar', companyId: 'empresa-b' })
  assert.equal(verificarFirma(firmar(original), alterado), false)
})

test('rechaza un token caducado', () => {
  const cuerpo = '{}'
  const hace2h = Math.floor(Date.now() / 1000) - 7200
  assert.equal(verificarFirma(firmar(cuerpo, { exp: hace2h }), cuerpo), false)
})

test('rechaza un token que todavía no es válido', () => {
  const cuerpo = '{}'
  const en2h = Math.floor(Date.now() / 1000) + 7200
  assert.equal(verificarFirma(firmar(cuerpo, { nbf: en2h }), cuerpo), false)
})

test('tolera un desfase de reloj de pocos segundos', () => {
  // Máquinas distintas no tienen el reloj exactamente igual. Sin margen, los
  // mensajes legítimos fallarían de forma intermitente e inexplicable.
  const cuerpo = '{}'
  const ahora = Math.floor(Date.now() / 1000)
  assert.equal(verificarFirma(firmar(cuerpo, { exp: ahora - 30 }), cuerpo), true)
  assert.equal(verificarFirma(firmar(cuerpo, { nbf: ahora + 30 }), cuerpo), true)
})

test('rechaza tokens mal formados y ausentes', () => {
  assert.equal(verificarFirma(null, '{}'), false)
  assert.equal(verificarFirma('', '{}'), false)
  assert.equal(verificarFirma('no-es-un-jwt', '{}'), false)
  assert.equal(verificarFirma('a.b', '{}'), false)
  assert.equal(verificarFirma('a.b.c.d', '{}'), false)
})

test('rechaza una firma vacía aunque el resto del token sea válido', () => {
  const cuerpo = '{}'
  const [cab, carga] = firmar(cuerpo).split('.')
  assert.equal(verificarFirma(`${cab}.${carga}.`, cuerpo), false)
})

test('sin claves configuradas no pasa nada', () => {
  // Fail-closed: si falta la configuración, el endpoint no ejecuta trabajos.
  const cuerpo = '{}'
  const token = firmar(cuerpo)
  delete process.env.QSTASH_CURRENT_SIGNING_KEY
  assert.equal(verificarFirma(token, cuerpo), false)
})

test('acepta con la clave SIGUIENTE durante la rotación', () => {
  // Upstash rota las claves; durante la rotación conviven mensajes firmados
  // con una y con otra. Si solo se comprobara la actual, media rotación se
  // perdería en trabajos rechazados.
  const cuerpo = '{"tipo":"automatizaciones","companyId":"c1"}'
  const token = firmar(cuerpo, { clave: 'la-siguiente' })
  process.env.QSTASH_NEXT_SIGNING_KEY = 'la-siguiente'
  assert.equal(verificarFirma(token, cuerpo), true)
})

test('rechaza un token sin el claim del cuerpo si no coincide la firma', () => {
  // Un token sin `body` firmado correctamente se acepta (no todos los mensajes
  // lo llevan), pero uno sin `body` Y con firma ajena no.
  const cuerpo = '{}'
  assert.equal(verificarFirma(firmar(cuerpo, { omitirBody: true }), cuerpo), true)
  assert.equal(
    verificarFirma(firmar(cuerpo, { omitirBody: true, clave: 'otra' }), cuerpo),
    false
  )
})
