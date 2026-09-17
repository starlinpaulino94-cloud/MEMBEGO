import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { abrir, sellar, type ClavesMaestras } from '../src/modules/connect/cifrado'

/**
 * SELLADO DEL SECRETO DE WEBHOOK · hallazgo A-7 de la auditoría.
 *
 * El módulo que sella (`secreto-webhook.ts`) es `server-only` y no se puede
 * importar aquí, así que se prueban las dos cosas que importan por separado: el
 * ciclo criptográfico y el AAD por empresa contra `cifrado.ts` (que es puro y es
 * exactamente lo que usa por dentro), y el CABLEADO —sellar al guardar, abrir al
 * firmar, fallar abierto sin clave— como guardia estructural sobre el fuente.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

/** El mismo AAD que arma `secreto-webhook.ts`: atado a la EMPRESA. */
const aad = (companyId: string) => `webhook:${companyId}`
const KM: ClavesMaestras = new Map([[1, Buffer.alloc(32, 7)]])

// ─── El ciclo, y el AAD que ata el sello a su empresa ────────────────────────

test('un secreto sellado se abre y vuelve a ser el mismo', () => {
  const secreto = 'whs_' + 'a'.repeat(48)
  const sellado = sellar(KM, secreto, aad('c1'))
  assert.notEqual(sellado, secreto, 'no se guardó en claro')
  assert.ok(sellado.startsWith('cn1.'), 'el sello lleva su marca de formato')
  const abierto = abrir(KM, sellado, aad('c1'))
  assert.deepEqual(abierto, { ok: true, datos: secreto })
})

test('un sello de una empresa NO se abre con el AAD de otra', () => {
  // Es lo que hace que un volcado de la base no deje mover un secreto sellado a
  // la suscripción de otra empresa: el AAD no cuadra y GCM lo rechaza.
  const sellado = sellar(KM, 'whs_secreto', aad('c1'))
  assert.equal(abrir(KM, sellado, aad('c2')).ok, false)
})

test('sin la clave que selló, no se puede abrir (misma propiedad que las credenciales)', () => {
  const sellado = sellar(KM, 'whs_secreto', aad('c1'))
  const otras: ClavesMaestras = new Map([[1, Buffer.alloc(32, 9)]])
  assert.equal(abrir(otras, sellado, aad('c1')).ok, false)
})

// ─── El cableado: sellar al guardar, abrir al firmar ─────────────────────────

const WEBHOOKS = leer('src/modules/connect/webhooks.ts')

test('el secreto se GUARDA sellado al crear', () => {
  assert.match(WEBHOOKS, /secreto: sellarSecretoWebhook\(input\.companyId, secreto\)/)
  // Y se GENERA en claro (es lo que se enseña una vez), no se enseña el sello.
  assert.match(WEBHOOKS, /const secreto = `whs_\$\{randomBytes/)
  assert.match(WEBHOOKS, /return \{ ok: true, id: fila\.id, secreto \}/)
})

test('al rotar se sella el nuevo, y el anterior solo si venía en claro', () => {
  assert.match(WEBHOOKS, /secreto: sellarSecretoWebhook\(companyId, nuevo\)/)
  assert.match(WEBHOOKS, /estaSellado\(actual\.secreto\)\s*\?\s*actual\.secreto\s*:\s*sellarSecretoWebhook\(companyId, actual\.secreto\)/)
})

test('los DOS caminos de firma abren el secreto justo antes de entregar', () => {
  // El fan-out directo y el reintento. Si alguno firmara con el valor sellado, el
  // receptor rechazaría la firma y nadie sabría por qué.
  assert.match(WEBHOOKS, /entregar\(s\.url, abrirSecretosFirma\(input\.companyId, s\), sobre\)/)
  assert.match(WEBHOOKS, /abrirSecretosFirma\(e\.companyId, e\.suscripcion\)/)
  // Y no queda ningún `entregar` firmando con la fila en crudo.
  const llamadas = [...WEBHOOKS.matchAll(/await entregar\(/g)].length
  const abren = [...WEBHOOKS.matchAll(/entregar\([^,]+,\s*abrirSecretosFirma\(/g)].length
  assert.equal(llamadas, abren, 'hay un entregar que no abre el secreto antes de firmar')
})

// ─── Falla ABIERTO: sin clave maestra sigue funcionando ──────────────────────

const MODULO = leer('src/modules/connect/secreto-webhook.ts')

test('sin clave maestra, sella y abre EN CLARO (no rompe la firma)', () => {
  // Es la diferencia deliberada con `credenciales.ts`, que falla cerrado: un
  // webhook tiene que poder firmarse aunque el despliegue no tenga clave maestra.
  const sellarFn = MODULO.slice(MODULO.indexOf('export function sellarSecretoWebhook'))
  assert.match(sellarFn.slice(0, 300), /return km \? sellar\(.*\) : secreto/)
  const abrirFn = MODULO.slice(MODULO.indexOf('export function abrirSecretoWebhook'))
  assert.match(abrirFn.slice(0, 400), /if \(!estaSellado\(valor\)\) return valor/)
  assert.match(abrirFn.slice(0, 400), /if \(!km\) return valor/)
})

test('un valor en claro se reconoce por NO empezar por la marca del sello', () => {
  // `whs_…` (claro) vs `cn1.…` (sellado): la distinción que deja convivir los dos
  // formatos en la misma columna sin una migración de datos.
  assert.match(MODULO, /const MARCA_SELLO = 'cn1\.'/)
  assert.match(MODULO, /return valor\.startsWith\(MARCA_SELLO\)/)
})

// ─── El backfill ─────────────────────────────────────────────────────────────

test('el backfill es idempotente: no re-sella lo ya sellado', () => {
  const src = leer('scripts/sellar-secretos-webhook.ts')
  assert.match(src, /estaSellado\(f\.secreto\)/)
  assert.match(src, /if \(!secretoClaro && !anteriorClaro\)/)
})
