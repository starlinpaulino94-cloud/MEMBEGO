import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'crypto'
import {
  CABECERA_EVENTO,
  CABECERA_FIRMA,
  CABECERA_TIMESTAMP,
  VENTANA_REPLAY_SEGUNDOS,
  materialFirmado,
} from '@membego/contracts'

/**
 * PLATAFORMA · Fase 3 — FIRMA Ed25519 DE LOS EVENTOS SALIENTES (núcleo puro).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO BASTA EL HMAC QUE YA HABÍA
 *
 * El HMAC actual usa el secreto COMPARTIDO con cada satélite. Funciona, y
 * mientras hubo uno no importó. Con diez hay un problema que no se arregla
 * rotando nada:
 *
 *   **quien puede verificar, puede falsificar.**
 *
 * El satélite guarda el mismo secreto con el que firmamos. Un volcado de su
 * base —o un empleado suyo— permite fabricar eventos que MembeGo parecería
 * haber emitido, y ningún receptor podría distinguirlos. Con cientos de
 * sistemas, eso es cientos de copias de nuestra capacidad de firmar.
 *
 * Ed25519 parte las dos cosas: MembeGo guarda la privada, el satélite solo la
 * pública. Verificar deja de dar la capacidad de firmar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE FIRMA CON LOS DOS A LA VEZ, Y ESO NO ES INDECISIÓN
 *
 * Cambiar de firma exige que Core y satélites desplieguen el mismo minuto: si
 * el Core cambia antes, todos los eventos se rechazan; si el satélite cambia
 * antes, no llega ninguno válido. Con las dos cabeceras a la vez, cada satélite
 * migra cuando puede y el HMAC se retira cuando no quede ninguno usándolo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TIMESTAMP DENTRO DE LO FIRMADO
 *
 * La firma cubre `timestamp.eventId.cuerpo` y no solo el cuerpo. Si el
 * timestamp viajara fuera de la firma, cualquiera que capturara un webhook
 * podría reenviarlo mañana con una hora nueva: la firma seguiría siendo válida
 * y la ventana anti-replay no serviría de nada.
 */


/**
 * Las cabeceras, la ventana anti-replay y QUÉ se firma viven en
 * `@membego/contracts`: es lo que el satélite tiene que implementar igual, y
 * describirlo en dos sitios es cómo empiezan a diferir.
 */
export { CABECERA_FIRMA, CABECERA_TIMESTAMP, CABECERA_EVENTO, VENTANA_REPLAY_SEGUNDOS, materialFirmado }

/**
 * Lee la clave privada desde el entorno. Se acepta PEM directo o en base64,
 * porque un PEM tiene saltos de línea y muchos paneles de despliegue —Vercel
 * entre ellos— los convierten en literales `\n` que rompen el parseo.
 */
export function clavePrivadaDesde(bruto: string | undefined): KeyObject | null {
  if (!bruto || !bruto.trim()) return null
  const texto = bruto.includes('BEGIN')
    ? bruto.replace(/\\n/g, '\n')
    : Buffer.from(bruto, 'base64').toString('utf8')
  try {
    const clave = createPrivateKey(texto)
    return clave.asymmetricKeyType === 'ed25519' ? clave : null
  } catch {
    return null
  }
}

/** Firma en base64. `null` si no hay clave configurada: se sigue con HMAC. */
export function firmarEd25519(
  clave: KeyObject | null,
  timestamp: number,
  eventId: string,
  cuerpo: string
): string | null {
  if (!clave) return null
  return sign(null, Buffer.from(materialFirmado(timestamp, eventId, cuerpo), 'utf8'), clave).toString(
    'base64'
  )
}

/**
 * Verificación — la misma operación que implementa el satélite. Vive aquí para
 * que la documentación del contrato pueda copiarla literalmente en vez de
 * describirla con palabras, que es como se introducen las diferencias.
 */
export function firmaEd25519Valida(
  clavePublicaPem: string,
  timestamp: number,
  eventId: string,
  cuerpo: string,
  firmaBase64: string,
  ahoraEpoch = Math.floor(Date.now() / 1000)
): boolean {
  if (!Number.isFinite(timestamp)) return false
  if (Math.abs(ahoraEpoch - timestamp) > VENTANA_REPLAY_SEGUNDOS) return false
  try {
    return verify(
      null,
      Buffer.from(materialFirmado(timestamp, eventId, cuerpo), 'utf8'),
      createPublicKey(clavePublicaPem),
      Buffer.from(firmaBase64, 'base64')
    )
  } catch {
    return false
  }
}

/** Clave pública en PEM, para publicarla. De la privada nunca sale nada más. */
export function clavePublicaPem(privada: KeyObject | null): string | null {
  if (!privada) return null
  try {
    // Se pasa por PEM en vez de entregar el `KeyObject` directamente: las
    // definiciones de tipos de Node no aceptan la forma corta, y forzarla con
    // un `as any` escondería un error real si algún día cambia la API.
    const pkcs8 = privada.export({ type: 'pkcs8', format: 'pem' }).toString()
    return createPublicKey({ key: pkcs8, format: 'pem' })
      .export({ type: 'spki', format: 'pem' })
      .toString()
  } catch {
    return null
  }
}
