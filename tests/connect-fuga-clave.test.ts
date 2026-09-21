import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateKeyPairSync, createSign } from 'node:crypto'
import {
  TIPO_TOKEN_FUGA,
  parsearAlertaFuga,
  verificarFirmaSecretScanning,
  decidirFuga,
} from '../src/modules/connect/fugaClaveNucleo'

/**
 * ALERTA DE FUGA DE CLAVES · GitHub Secret Scanning.
 *
 * El prefijo `mbk_` se eligió scannable a propósito; esto es la otra mitad del
 * trato: cuando GitHub encuentra una clave nuestra filtrada, la manda firmada y
 * la revocamos sola. Lo puro se prueba de verdad —incluida la firma ECDSA con un
 * par de claves real—; lo que toca base/red es una guardia estructural.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

// ─── parseo de la alerta ─────────────────────────────────────────────────────

test('parsearAlertaFuga acepta el array de GitHub y rechaza la basura', () => {
  const ok = parsearAlertaFuga(
    JSON.stringify([{ token: 'mbk_abc.secreto', type: TIPO_TOKEN_FUGA, url: 'u', source: 's' }])
  )
  assert.ok(ok)
  assert.equal(ok!.length, 1)
  assert.equal(ok![0].token, 'mbk_abc.secreto')

  assert.equal(parsearAlertaFuga('no es json'), null, 'json inválido')
  assert.equal(parsearAlertaFuga('{}'), null, 'un objeto no es un array')
  assert.equal(parsearAlertaFuga('[]'), null, 'un array vacío no trae nada que hacer')
  assert.equal(parsearAlertaFuga(JSON.stringify([{ type: TIPO_TOKEN_FUGA }])), null, 'sin token')
  assert.equal(parsearAlertaFuga(JSON.stringify([{ token: 42, type: 'x' }])), null, 'token no-string')
})

// ─── verificación de la firma ECDSA (con un par de claves REAL) ──────────────

function firmar(cuerpo: string, clavePrivada: string): string {
  const s = createSign('SHA256')
  s.update(cuerpo)
  s.end()
  return s.sign(clavePrivada, 'base64')
}

test('verificarFirmaSecretScanning acepta una firma válida y rechaza todo lo demás', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  const cuerpo = JSON.stringify([{ token: 'mbk_abc.secreto', type: TIPO_TOKEN_FUGA }])
  const firma = firmar(cuerpo, privateKey)

  assert.equal(verificarFirmaSecretScanning(cuerpo, firma, publicKey), true, 'la firma legítima verifica')

  // Un solo byte distinto en el cuerpo invalida la firma: por eso se verifica
  // sobre el crudo y no sobre el JSON re-serializado.
  assert.equal(verificarFirmaSecretScanning(cuerpo + ' ', firma, publicKey), false, 'cuerpo alterado')

  // Firmado con OTRA clave: es exactamente el ataque que esto para —un tercero
  // mandando «revoca esta clave» sin ser GitHub—.
  const otra = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  assert.equal(verificarFirmaSecretScanning(cuerpo, firmar(cuerpo, otra.privateKey), publicKey), false)

  assert.equal(verificarFirmaSecretScanning(cuerpo, 'no-base64-válido', publicKey), false)
  assert.equal(verificarFirmaSecretScanning(cuerpo, firma, 'no soy una pem'), false)
})

// ─── la decisión: qué se revoca y qué no ─────────────────────────────────────

test('decidirFuga solo revoca con el secreto COMPLETO correcto y la clave viva', () => {
  // Una clave nuestra, viva, con su secreto real → true_positive y se revoca.
  assert.deepEqual(
    decidirFuga({ formatoValido: true, filaExiste: true, secretoCoincide: true, estaActiva: true }),
    { etiqueta: 'true_positive', revocar: true }
  )
  // Era nuestra pero ya estaba revocada/caducada → true_positive, nada que cerrar.
  assert.deepEqual(
    decidirFuga({ formatoValido: true, filaExiste: true, secretoCoincide: true, estaActiva: false }),
    { etiqueta: 'true_positive', revocar: false }
  )
  // Prefijo real, secreto que NO cuadra → false_positive y NO se revoca. Es la
  // regla de oro: el prefijo es público, revocar por prefijo dejaría que
  // cualquiera tumbara la clave de otra empresa.
  assert.deepEqual(
    decidirFuga({ formatoValido: true, filaExiste: true, secretoCoincide: false, estaActiva: true }),
    { etiqueta: 'false_positive', revocar: false }
  )
  // Prefijo desconocido → false_positive.
  assert.deepEqual(
    decidirFuga({ formatoValido: true, filaExiste: false, secretoCoincide: false, estaActiva: false }),
    { etiqueta: 'false_positive', revocar: false }
  )
  // Ni siquiera tiene forma de clave nuestra → false_positive.
  assert.deepEqual(
    decidirFuga({ formatoValido: false, filaExiste: false, secretoCoincide: false, estaActiva: false }),
    { etiqueta: 'false_positive', revocar: false }
  )
})

// ─── guardias estructurales del glue y la ruta ───────────────────────────────

test('el glue solo revoca tras comparar el secreto completo (nunca por prefijo)', () => {
  const src = codigo('src/modules/connect/fugaClave.ts')
  // La decisión de revocar viene de `decidirFuga` alimentada con `secretoValido`.
  assert.match(src, /secretoValido\(partida\.secreto, fila\.secretoHash\)/)
  assert.match(src, /decidirFuga\(/)
  // La revocación es idempotente (guardada por estado ACTIVE).
  assert.match(src, /estado:\s*'ACTIVE'\s*\}[\s\S]*?data:\s*\{\s*estado:\s*'REVOKED'/)
  // Evento PROPIO de fuga, distinto de la revocación manual.
  assert.match(src, /evento:\s*'clave_api\.revocada_por_fuga'/)
})

test('la ruta verifica la firma ANTES de mirar el cuerpo', () => {
  const src = codigo('src/app/api/connect/secret-scanning/route.ts')
  const posFirma = src.indexOf('verificarFirmaSecretScanning')
  const posProcesar = src.indexOf('procesarTokenFiltrado')
  assert.ok(posFirma !== -1 && posProcesar !== -1, 'faltan la verificación o el proceso')
  assert.ok(posFirma < posProcesar, 'procesa tokens antes de verificar la firma')
  // Lee el cuerpo CRUDO (no `req.json()`), que es sobre lo que va la firma.
  assert.match(src, /await req\.text\(\)/)
  assert.ok(!/req\.json\(\)/.test(src), 'usar req.json() rompería la verificación de la firma')
})
