import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * NÚCLEO PURO del cifrado de credenciales de Membego Connect (AES-256-GCM).
 *
 * Sin Prisma, sin red y sin `process.env`: las claves entran por parámetro,
 * así que todo esto se prueba con claves de mentira sin tocar configuración.
 * La lectura del entorno vive en `lib/env.ts`; el uso con base de datos, en
 * `modules/connect/credenciales.ts`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EN LA APLICACIÓN Y NO EN LA BASE (decisión D3, Fase 0)
 *
 * Cifrar dentro de Postgres (pgsodium/Vault) ata el descifrado a la base
 * misma: un acceso SQL comprometido lee las credenciales en claro. Con la
 * clave maestra en una variable de Vercel, un volcado de la tabla entera es
 * ruido — para leer un token de WhatsApp hacen falta la base Y el entorno.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * VARIAS CLAVES A LA VEZ = ROTACIÓN SIN PARADA
 *
 * La variable admite varias claves numeradas («1:base64,2:base64»). Se SELLA
 * siempre con la de versión más alta; se ABRE con la que diga el propio sello.
 * Rotar es añadir una clave nueva y dejar la vieja hasta que no quede ningún
 * sello suyo — sin ventana en la que lo guardado ayer sea ilegible hoy.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL AAD ATA EL SELLO A SU FILA
 *
 * GCM autentica, además del contenido, un dato adicional (AAD) que no viaja
 * en el sello. Aquí es la identidad de la fila («credencial:<conexión>:<tipo>»):
 * copiar un sello cifrado de una fila a otra —el movimiento clásico con acceso
 * de escritura a la tabla pero sin la clave— produce un sello que no abre.
 */

/** Prefijo del formato. Si algún día cambia el esquema, cambia el prefijo. */
const FORMATO = 'cn1'

const BYTES_CLAVE = 32
const BYTES_IV = 12

export type ClavesMaestras = Map<number, Buffer>

export type ResultadoAbrir =
  | { ok: true; datos: string }
  | { ok: false; motivo: 'formato' | 'clave_desconocida' | 'manipulado' }

/**
 * Parsea el valor de la variable de entorno: «1:<base64>[,2:<base64>…]».
 * Lanza con un mensaje concreto — una clave maestra mal puesta tiene que
 * gritar en el arranque, no fallar en silencio al guardar la primera
 * credencial.
 */
export function parsearClavesMaestras(valor: string): ClavesMaestras {
  const claves: ClavesMaestras = new Map()
  for (const parte of valor.split(',')) {
    const [num, b64, ...resto] = parte.trim().split(':')
    if (!num || !b64 || resto.length > 0) {
      throw new Error('Clave maestra malformada: se espera «version:base64» separadas por comas.')
    }
    const version = Number(num)
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(`Versión de clave maestra inválida: «${num}».`)
    }
    const clave = Buffer.from(b64, 'base64')
    if (clave.length !== BYTES_CLAVE) {
      throw new Error(
        `La clave maestra v${version} no mide ${BYTES_CLAVE} bytes. Genera una con: openssl rand -base64 32`
      )
    }
    if (claves.has(version)) throw new Error(`Versión de clave maestra repetida: ${version}.`)
    claves.set(version, clave)
  }
  if (claves.size === 0) throw new Error('No hay ninguna clave maestra en la variable.')
  return claves
}

/** La versión con la que se sella: siempre la más alta disponible. */
export function versionActual(claves: ClavesMaestras): number {
  return Math.max(...claves.keys())
}

/**
 * Sella `datos` (UTF-8) atado a `aad`. Devuelve
 * `cn1.<version>.<iv>.<tag>.<cifrado>` (base64url, sin puntos dentro de los
 * campos — el punto puede ser separador porque base64url no lo usa).
 */
export function sellar(claves: ClavesMaestras, datos: string, aad: string): string {
  const version = versionActual(claves)
  const clave = claves.get(version)!
  const iv = randomBytes(BYTES_IV)
  const cifrador = createCipheriv('aes-256-gcm', clave, iv)
  cifrador.setAAD(Buffer.from(aad, 'utf8'))
  const cifrado = Buffer.concat([cifrador.update(datos, 'utf8'), cifrador.final()])
  const tag = cifrador.getAuthTag()
  return [
    FORMATO,
    String(version),
    iv.toString('base64url'),
    tag.toString('base64url'),
    cifrado.toString('base64url'),
  ].join('.')
}

/**
 * Abre un sello. No lanza: quien guarda credenciales necesita distinguir
 * «la clave de ese sello ya no está en el entorno» (se restaura la variable)
 * de «alguien tocó el registro» (se investiga), y una excepción genérica
 * aplasta esa diferencia.
 */
export function abrir(claves: ClavesMaestras, sellado: string, aad: string): ResultadoAbrir {
  const partes = sellado.split('.')
  if (partes.length !== 5 || partes[0] !== FORMATO) return { ok: false, motivo: 'formato' }
  const version = Number(partes[1])
  if (!Number.isInteger(version)) return { ok: false, motivo: 'formato' }
  const clave = claves.get(version)
  if (!clave) return { ok: false, motivo: 'clave_desconocida' }
  try {
    const iv = Buffer.from(partes[2], 'base64url')
    const tag = Buffer.from(partes[3], 'base64url')
    const cifrado = Buffer.from(partes[4], 'base64url')
    const descifrador = createDecipheriv('aes-256-gcm', clave, iv)
    descifrador.setAAD(Buffer.from(aad, 'utf8'))
    descifrador.setAuthTag(tag)
    const datos = Buffer.concat([descifrador.update(cifrado), descifrador.final()])
    return { ok: true, datos: datos.toString('utf8') }
  } catch {
    // GCM no distingue «contenido alterado» de «AAD equivocado»: ambos son el
    // mismo fallo de autenticación, y eso es correcto — en los dos casos el
    // sello no corresponde a esta fila.
    return { ok: false, motivo: 'manipulado' }
  }
}

/** Versión que selló un registro, para saber qué re-sellar durante una rotación. */
export function versionDelSello(sellado: string): number | null {
  const partes = sellado.split('.')
  if (partes.length !== 5 || partes[0] !== FORMATO) return null
  const version = Number(partes[1])
  return Number.isInteger(version) && version >= 1 ? version : null
}
