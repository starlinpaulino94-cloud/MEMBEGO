import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto'
import {
  aBase64Url,
  cifrarCargaWebPush,
  construirPeticionWebPush,
  deBase64Url,
  firmarVapid,
  generarClavesVapid,
  validarClavesVapid,
} from '../src/modules/notificaciones/web-push/protocolo'

/**
 * WEB PUSH · EL PROTOCOLO SE PRUEBA HACIENDO DE NAVEGADOR.
 *
 * Lo que `cifrarCargaWebPush` produce lo descifra aquí el mismo algoritmo que
 * corre en Chrome/Firefox/Safari (RFC 8291 + RFC 8188), con la clave privada
 * del navegador simulado. Si cualquiera de las derivaciones (IKM, clave,
 * nonce, cabecera) se desviara del estándar, el descifrado falla y la prueba
 * lo dice; en producción el síntoma sería «no llega nada» sin un solo error.
 */

function navegadorSimulado() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return {
    ecdh,
    suscripcion: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      p256dh: aBase64Url(ecdh.getPublicKey()),
      auth: aBase64Url(randomBytes(16)),
    },
  }
}

/** RFC 8291 §3 tal como lo hace el navegador al recibir el push. */
function descifrarComoNavegador(nav: ReturnType<typeof navegadorSimulado>, cuerpo: Buffer): string {
  const salt = cuerpo.subarray(0, 16)
  const rs = cuerpo.readUInt32BE(16)
  const idlen = cuerpo[20]
  assert.equal(rs, 4096)
  assert.equal(idlen, 65)
  const claveServidor = cuerpo.subarray(21, 21 + idlen)
  const cifrado = cuerpo.subarray(21 + idlen)

  const secreto = nav.ecdh.computeSecret(claveServidor)
  const infoIkm = Buffer.concat([Buffer.from('WebPush: info\0'), nav.ecdh.getPublicKey(), claveServidor])
  const ikm = Buffer.from(hkdfSync('sha256', secreto, deBase64Url(nav.suscripcion.auth), infoIkm, 32))
  const clave = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))

  const descifrador = createDecipheriv('aes-128-gcm', clave, nonce)
  descifrador.setAuthTag(cifrado.subarray(cifrado.length - 16))
  const claro = Buffer.concat([descifrador.update(cifrado.subarray(0, cifrado.length - 16)), descifrador.final()])
  // Quita el delimitador (0x02 en el último registro) y el relleno de ceros.
  let fin = claro.length - 1
  while (fin >= 0 && claro[fin] === 0) fin--
  assert.equal(claro[fin], 0x02, 'el último registro termina en 0x02')
  return claro.subarray(0, fin).toString('utf8')
}

test('cifrarCargaWebPush: el navegador descifra exactamente lo que se cifró', () => {
  const nav = navegadorSimulado()
  const aviso = JSON.stringify({ titulo: 'Tu membresía vence mañana', mensaje: 'Renueva y sigue ahorrando ✨', href: '/cliente/membresia' })
  const cuerpo = cifrarCargaWebPush(nav.suscripcion, aviso)
  assert.equal(descifrarComoNavegador(nav, cuerpo), aviso)
})

test('cifrarCargaWebPush: dos envíos del mismo texto no se parecen (salt y clave efímera nuevos)', () => {
  const nav = navegadorSimulado()
  const a = cifrarCargaWebPush(nav.suscripcion, 'hola')
  const b = cifrarCargaWebPush(nav.suscripcion, 'hola')
  assert.notDeepEqual(a, b)
  assert.equal(descifrarComoNavegador(nav, a), 'hola')
  assert.equal(descifrarComoNavegador(nav, b), 'hola')
})

test('cifrarCargaWebPush: rechaza claves del navegador mal formadas y cargas que no caben', () => {
  const nav = navegadorSimulado()
  assert.throws(() => cifrarCargaWebPush({ ...nav.suscripcion, auth: aBase64Url(randomBytes(12)) }, 'x'), /auth/)
  assert.throws(() => cifrarCargaWebPush({ ...nav.suscripcion, p256dh: aBase64Url(randomBytes(65)) }, 'x'), /p256dh/)
  assert.throws(() => cifrarCargaWebPush(nav.suscripcion, 'a'.repeat(4096)), /registro/)
})

test('generarClavesVapid + validarClavesVapid: las claves generadas pasan la validación y las rotas no', () => {
  const claves = generarClavesVapid()
  assert.equal(validarClavesVapid({ ...claves, sujeto: 'mailto:hola@membego.com' }), null)
  assert.equal(validarClavesVapid({ ...claves, sujeto: 'https://membego.com' }), null)
  assert.match(validarClavesVapid(null) ?? '', /faltan/)
  assert.match(validarClavesVapid({ ...claves, sujeto: 'membego.com' }) ?? '', /sujeto/)
  assert.match(validarClavesVapid({ ...claves, publica: claves.publica.slice(0, -4), sujeto: 'mailto:a@b.c' }) ?? '', /pública/)
  assert.match(validarClavesVapid({ ...claves, privada: aBase64Url(randomBytes(31)), sujeto: 'mailto:a@b.c' }) ?? '', /privada/)
})

test('firmarVapid: el JWT se verifica con la clave pública, apunta al origen del endpoint y caduca en 12 h', () => {
  const claves = { ...generarClavesVapid(), sujeto: 'mailto:hola@membego.com' }
  const ahora = 1_800_000_000
  const jwt = firmarVapid(claves, 'https://updates.push.services.mozilla.com/wpush/v2/xyz?x=1', ahora)
  const [cab, carga, firma] = jwt.split('.')
  assert.deepEqual(JSON.parse(deBase64Url(cab).toString()), { typ: 'JWT', alg: 'ES256' })
  assert.deepEqual(JSON.parse(deBase64Url(carga).toString()), {
    aud: 'https://updates.push.services.mozilla.com',
    exp: ahora + 12 * 3600,
    sub: 'mailto:hola@membego.com',
  })
  const publica = deBase64Url(claves.publica)
  const clavePublica = createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: aBase64Url(publica.subarray(1, 33)), y: aBase64Url(publica.subarray(33)) },
    format: 'jwk',
  })
  assert.equal(deBase64Url(firma).length, 64, 'firma cruda r||s, no DER')
  assert.ok(verify('sha256', Buffer.from(`${cab}.${carga}`), { key: clavePublica, dsaEncoding: 'ieee-p1363' }, deBase64Url(firma)))
})

test('construirPeticionWebPush: cabeceras del estándar y cuerpo descifrable', () => {
  const nav = navegadorSimulado()
  const claves = { ...generarClavesVapid(), sujeto: 'mailto:hola@membego.com' }
  const peticion = construirPeticionWebPush(claves, nav.suscripcion, '{"titulo":"Hola"}', { ttl: 60, urgency: 'high', topic: 'n1' })
  assert.equal(peticion.url, nav.suscripcion.endpoint)
  assert.equal(peticion.headers['Content-Encoding'], 'aes128gcm')
  assert.equal(peticion.headers['Content-Type'], 'application/octet-stream')
  assert.equal(peticion.headers.TTL, '60')
  assert.equal(peticion.headers.Urgency, 'high')
  assert.equal(peticion.headers.Topic, 'n1')
  assert.match(peticion.headers.Authorization, new RegExp(`^vapid t=[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+, k=${claves.publica}$`))
  assert.equal(descifrarComoNavegador(nav, peticion.body), '{"titulo":"Hola"}')
  // Por defecto: un día de TTL y urgencia normal, sin Topic.
  const porDefecto = construirPeticionWebPush(claves, nav.suscripcion, 'x')
  assert.equal(porDefecto.headers.TTL, String(86400))
  assert.equal(porDefecto.headers.Urgency, 'normal')
  assert.equal('Topic' in porDefecto.headers, false)
})
