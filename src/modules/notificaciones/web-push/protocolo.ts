/**
 * WEB PUSH · EL PROTOCOLO, SIN DEPENDENCIAS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ HACE
 *
 * Convierte «este texto para esta suscripción» en la petición HTTP que entiende
 * el servicio push del navegador (FCM para Chrome, autopush para Firefox, APNs
 * web para Safari). Son dos piezas de estándar:
 *
 *  1. **VAPID (RFC 8292)**: un JWT firmado con nuestra clave P-256 que le dice
 *     al servicio push «este servidor es MembeGo y tiene derecho a enviar».
 *  2. **Cifrado del cuerpo (RFC 8291 + RFC 8188, `aes128gcm`)**: el aviso se
 *     cifra con una clave derivada de la clave pública del navegador, así ni
 *     Google ni Mozilla ni Apple pueden leer lo que avisamos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTÁ ESCRITO AQUÍ Y NO SE USA `web-push`
 *
 * Porque todo lo que hace falta ya está en `node:crypto` (ECDH P-256, HKDF,
 * AES-128-GCM y la firma ECDSA) y el estándar cabe en cien líneas que se pueden
 * leer y PROBAR: `tests/web-push-protocolo.test.ts` descifra lo que esto cifra
 * haciendo de navegador. Una dependencia más es una superficie más que auditar
 * y otra cosa que se rompe al actualizar.
 *
 * Este archivo es PURO: no toca la base ni lee el entorno, para que la prueba
 * lo importe fuera de Next. La configuración vive en `../web-push.ts`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign as firmar,
} from 'node:crypto'

/** Lo que el navegador entrega en `PushSubscription.toJSON()`. */
export interface SuscripcionWebPush {
  readonly endpoint: string
  readonly p256dh: string
  readonly auth: string
}

/** Nuestras claves VAPID (base64url, formato de `scripts/vapid-generar.mjs`). */
export interface ClavesVapid {
  readonly publica: string
  readonly privada: string
  /** `mailto:` o `https://`, a quién avisa el servicio push si algo va mal. */
  readonly sujeto: string
}

export interface PeticionWebPush {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: Buffer
}

// ── base64url ────────────────────────────────────────────────────────────────

export function aBase64Url(datos: Buffer | Uint8Array): string {
  return Buffer.from(datos).toString('base64url')
}

export function deBase64Url(texto: string): Buffer {
  return Buffer.from(texto, 'base64url')
}

// ── Claves VAPID ─────────────────────────────────────────────────────────────

/**
 * Un par de claves nuevo. Pública: punto P-256 sin comprimir (65 bytes, empieza
 * por 0x04), que es lo que `pushManager.subscribe` pide como
 * `applicationServerKey`. Privada: el escalar de 32 bytes.
 */
export function generarClavesVapid(): { publica: string; privada: string } {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return { publica: aBase64Url(ecdh.getPublicKey()), privada: aBase64Url(ecdh.getPrivateKey()) }
}

/**
 * Valida las claves tal como llegan del entorno. Devuelve el motivo si no
 * sirven; `null` si están bien. Se comprueba al arrancar para que una clave
 * pegada a medias falle en el log y no en el primer aviso.
 */
export function validarClavesVapid(claves: Partial<ClavesVapid> | null | undefined): string | null {
  if (!claves?.publica || !claves.privada || !claves.sujeto) return 'faltan claves VAPID'
  const publica = deBase64Url(claves.publica)
  if (publica.length !== 65 || publica[0] !== 0x04) return 'la clave pública VAPID no es un punto P-256 sin comprimir (65 bytes)'
  if (deBase64Url(claves.privada).length !== 32) return 'la clave privada VAPID no mide 32 bytes'
  if (!/^(mailto:|https:\/\/)/.test(claves.sujeto)) return 'el sujeto VAPID debe empezar por mailto: o https://'
  return null
}

/** Objeto clave de Node a partir del escalar y el punto público (JWK). */
function clavePrivadaVapid(claves: Pick<ClavesVapid, 'publica' | 'privada'>) {
  const publica = deBase64Url(claves.publica)
  return createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: aBase64Url(publica.subarray(1, 33)),
      y: aBase64Url(publica.subarray(33, 65)),
      d: claves.privada,
    },
    format: 'jwk',
  })
}

/**
 * El JWT de VAPID (RFC 8292 §2): `aud` es el ORIGEN del endpoint (no la URL
 * entera), `exp` como mucho 24 h (aquí 12), `sub` nuestro contacto. ES256 con la
 * firma en formato crudo r||s (`ieee-p1363`), que es lo que JOSE exige y lo que
 * `node:crypto` NO da por defecto (da DER).
 */
export function firmarVapid(
  claves: ClavesVapid,
  endpoint: string,
  ahora: number = Math.floor(Date.now() / 1000),
): string {
  const audiencia = new URL(endpoint).origin
  const cabecera = aBase64Url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const carga = aBase64Url(
    Buffer.from(JSON.stringify({ aud: audiencia, exp: ahora + 12 * 60 * 60, sub: claves.sujeto })),
  )
  const sinFirmar = `${cabecera}.${carga}`
  const firma = firmar('sha256', Buffer.from(sinFirmar), {
    key: clavePrivadaVapid(claves),
    dsaEncoding: 'ieee-p1363',
  })
  return `${sinFirmar}.${aBase64Url(firma)}`
}

// ── Cifrado del cuerpo (RFC 8291, aes128gcm) ─────────────────────────────────

const TAMANO_REGISTRO = 4096
const LONGITUD_ETIQUETA = 16

function info(nombre: string): Buffer {
  return Buffer.from(`Content-Encoding: ${nombre}\0`, 'ascii')
}

/**
 * Cifra `carga` para una suscripción. Devuelve el cuerpo YA con la cabecera
 * `aes128gcm` (RFC 8188 §2.1: salt ‖ rs ‖ idlen ‖ clave efímera), que es lo que
 * va tal cual en el POST. Un solo registro: el límite de un aviso push son
 * 4 KB y los nuestros son dos frases y una ruta.
 *
 * `claveEfimera` y `salt` se pueden fijar desde la prueba para que el
 * resultado sea reproducible; en producción se generan aquí.
 */
export function cifrarCargaWebPush(
  suscripcion: Pick<SuscripcionWebPush, 'p256dh' | 'auth'>,
  carga: Buffer | string,
  opciones: { salt?: Buffer; claveEfimera?: ReturnType<typeof createECDH> } = {},
): Buffer {
  const claveNavegador = deBase64Url(suscripcion.p256dh)
  const secretoAuth = deBase64Url(suscripcion.auth)
  if (claveNavegador.length !== 65 || claveNavegador[0] !== 0x04) {
    throw new Error('p256dh no es un punto P-256 sin comprimir')
  }
  if (secretoAuth.length !== 16) throw new Error('auth no mide 16 bytes')

  const efimera = opciones.claveEfimera ?? createECDH('prime256v1')
  if (!opciones.claveEfimera) efimera.generateKeys()
  const clavePublicaEfimera = efimera.getPublicKey()
  const salt = opciones.salt ?? randomBytes(16)
  if (salt.length !== 16) throw new Error('el salt mide 16 bytes')

  // RFC 8291 §3.3 y §3.4: del secreto ECDH sale el IKM; del IKM, la clave y el nonce.
  const secretoCompartido = efimera.computeSecret(claveNavegador)
  const infoIkm = Buffer.concat([Buffer.from('WebPush: info\0', 'ascii'), claveNavegador, clavePublicaEfimera])
  const ikm = Buffer.from(hkdfSync('sha256', secretoCompartido, secretoAuth, infoIkm, 32))
  const claveContenido = Buffer.from(hkdfSync('sha256', ikm, salt, info('aes128gcm'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, info('nonce'), 12))

  const texto = Buffer.isBuffer(carga) ? carga : Buffer.from(carga, 'utf8')
  // El tamaño máximo de un registro incluye la etiqueta y el delimitador.
  if (texto.length + 1 + LONGITUD_ETIQUETA > TAMANO_REGISTRO) {
    throw new Error(`la carga supera el tamaño de un registro (${TAMANO_REGISTRO} bytes)`)
  }
  // RFC 8188 §2: el último (y único) registro termina en 0x02.
  const relleno = Buffer.concat([texto, Buffer.from([0x02])])

  const cifrador = createCipheriv('aes-128-gcm', claveContenido, nonce)
  const cifrado = Buffer.concat([cifrador.update(relleno), cifrador.final(), cifrador.getAuthTag()])

  // Cabecera: salt(16) ‖ rs(4, big-endian) ‖ idlen(1) ‖ keyid(65 = clave efímera).
  const cabecera = Buffer.alloc(16 + 4 + 1)
  salt.copy(cabecera, 0)
  cabecera.writeUInt32BE(TAMANO_REGISTRO, 16)
  cabecera[20] = clavePublicaEfimera.length

  return Buffer.concat([cabecera, clavePublicaEfimera, cifrado])
}

// ── La petición completa ─────────────────────────────────────────────────────

/**
 * Todo lo que hay que mandar al endpoint. `ttl` en segundos: cuánto guarda el
 * servicio push el aviso si el dispositivo está apagado (un día: un aviso de
 * ayer todavía sirve; uno de la semana pasada, no). `urgency` deja que el
 * teléfono lo entregue aunque esté ahorrando batería.
 */
export function construirPeticionWebPush(
  claves: ClavesVapid,
  suscripcion: SuscripcionWebPush,
  carga: string,
  opciones: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string } = {},
): PeticionWebPush {
  const body = cifrarCargaWebPush(suscripcion, carga)
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'Content-Encoding': 'aes128gcm',
    TTL: String(opciones.ttl ?? 24 * 60 * 60),
    Urgency: opciones.urgency ?? 'normal',
    // RFC 8292 §3: el JWT y nuestra clave pública en una sola cabecera.
    Authorization: `vapid t=${firmarVapid(claves, suscripcion.endpoint)}, k=${claves.publica}`,
  }
  if (opciones.topic) headers.Topic = opciones.topic
  return { url: suscripcion.endpoint, headers, body }
}
