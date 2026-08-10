import { firmarHmac, firmaValida } from '@/modules/integraciones/nucleo'

/**
 * PLATAFORMA · Fase 2 — TOKEN DE ACCESO DE LA API v1 (núcleo puro).
 *
 * Formato `base64url(JSON).hmacHex`, el mismo que ya usa el SSO. Una sola forma
 * de firmar en todo el proyecto: cuando alguien audite las firmas, hay un
 * archivo que leer y no dos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ LLEVA DENTRO, Y QUÉ NO
 *
 * Lleva el `clientId`, los scopes pedidos y la caducidad. NO lleva `companyId`.
 *
 * Eso es deliberado y es la Regla §94 puesta en el formato: un token con la
 * empresa dentro empuja a confiar en ella, y la empresa de una petición SIEMPRE
 * se valida contra las habilitaciones de la Fase 1b. Si la empresa viajara
 * firmada, la tentación de saltarse esa comprobación —«ya viene firmada»—
 * llegaría el primer día que alguien optimice.
 *
 * Tampoco lleva los scopes de la CREDENCIAL, solo los que este token pidió. Los
 * efectivos son la intersección con los concedidos hoy, y se recalcula en cada
 * petición para que revocar surta efecto sin esperar a la caducidad.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * VIDA CORTA
 *
 * Quince minutos. Suficiente para que un satélite no pida token en cada
 * llamada; poco para que un token filtrado en un log ajeno valga de algo
 * mañana. La revocación instantánea la da la comprobación del estado de la
 * credencial en cada petición, no la caducidad.
 */

export const TTL_TOKEN_SEGUNDOS = 15 * 60

export interface DatosToken {
  /** Credencial que lo pidió. Se usa para releer estado y scopes concedidos. */
  cid: string
  /** Scopes solicitados. Los efectivos se intersecan con los de la credencial. */
  scopes: string[]
  /** Epoch en segundos. */
  exp: number
  /** Epoch de emisión, para poder fechar un token en un informe de incidente. */
  iat: number
}

export function crearToken(
  secretoFirma: string,
  datos: Omit<DatosToken, 'exp' | 'iat'>,
  ahoraEpoch = Math.floor(Date.now() / 1000)
): { token: string; expiraEn: number } {
  const completo: DatosToken = {
    ...datos,
    iat: ahoraEpoch,
    exp: ahoraEpoch + TTL_TOKEN_SEGUNDOS,
  }
  const cuerpo = Buffer.from(JSON.stringify(completo), 'utf8').toString('base64url')
  return {
    token: `${cuerpo}.${firmarHmac(secretoFirma, cuerpo)}`,
    expiraEn: TTL_TOKEN_SEGUNDOS,
  }
}

/**
 * Por qué NO vale un token. Se separa de `null` porque el satélite tiene que
 * distinguir «renueva» de «revisa tus credenciales»: ante un `EXPIRED` pide otro
 * y sigue; ante un `INVALID` hay algo mal configurado y reintentar en bucle solo
 * gasta cuota.
 */
export type FalloToken = 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED'

export function verificarToken(
  secretoFirma: string,
  token: string,
  ahoraEpoch = Math.floor(Date.now() / 1000)
): { ok: true; datos: DatosToken } | { ok: false; fallo: FalloToken } {
  const punto = token.lastIndexOf('.')
  if (punto <= 0) return { ok: false, fallo: 'MALFORMED' }

  const cuerpo = token.slice(0, punto)
  const firma = token.slice(punto + 1)

  // La firma ANTES de mirar el contenido: analizar el JSON de un token no
  // verificado es dejar que un desconocido elija qué recorre nuestro parser.
  if (!firmaValida(secretoFirma, cuerpo, firma)) return { ok: false, fallo: 'BAD_SIGNATURE' }

  try {
    const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as DatosToken
    if (typeof datos.cid !== 'string' || !datos.cid) return { ok: false, fallo: 'MALFORMED' }
    if (!Array.isArray(datos.scopes)) return { ok: false, fallo: 'MALFORMED' }
    if (typeof datos.exp !== 'number') return { ok: false, fallo: 'MALFORMED' }
    if (datos.exp < ahoraEpoch) return { ok: false, fallo: 'EXPIRED' }
    return { ok: true, datos }
  } catch {
    return { ok: false, fallo: 'MALFORMED' }
  }
}

/** Extrae el token de `Authorization: Bearer …`. Tolerante con el espaciado. */
export function tokenDeCabecera(authorization: string | null): string | null {
  if (!authorization) return null
  const m = /^Bearer\s+(\S+)$/i.exec(authorization.trim())
  return m ? m[1] : null
}
