import { createVerify } from 'node:crypto'

/**
 * NÚCLEO PURO de la alerta de fuga de claves (Membego Connect · seguridad).
 *
 * Sin Prisma, sin red, sin `server-only`: aquí vive lo que se puede probar de
 * verdad —parsear la alerta, verificar la firma, y DECIDIR qué hacer con un
 * token filtrado—. La parte que toca la base (buscar la clave, revocarla) es el
 * glue de `fugaClave.ts`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ES ESTO
 *
 * El prefijo `mbk_` se eligió RECONOCIBLE a propósito para que los escáneres de
 * secretos de GitHub detecten una clave nuestra en cuanto alguien la sube por
 * error a un repo. Este módulo es la otra mitad de ese trato: cuando GitHub
 * encuentra una, nos la MANDA firmada a un endpoint, y nosotros la revocamos
 * sola —antes de que quien la encontró la use—. Sin esto, el prefijo scannable
 * solo servía para que el atacante la encontrara más rápido que nosotros.
 *
 * El contrato (GitHub Secret Scanning Partner Program):
 *   · GitHub hace POST con un array `[{ token, type, url, source }]`.
 *   · Firma el CUERPO CRUDO con ECDSA; la firma va en `Github-Public-Key-
 *     Signature` (base64) y el id de la clave en `Github-Public-Key-Identifier`.
 *     La clave pública se publica en `/meta/public_keys/secret_scanning`.
 *   · Respondemos un array `[{ token_raw, token_type, label }]`, con label
 *     `true_positive` (era nuestra y válida) o `false_positive` (no).
 */

/** El `type` con el que registramos el patrón `mbk_` ante GitHub. */
export const TIPO_TOKEN_FUGA = 'membego_api_key'

export type EtiquetaFuga = 'true_positive' | 'false_positive'

/** Una entrada del array que manda GitHub. */
export interface EntradaFuga {
  /** El secreto candidato, tal como GitHub lo encontró. */
  token: string
  /** El slug del patrón (`membego_api_key`). */
  type: string
  url?: string
  source?: string
}

/** Lo que respondemos por cada token. */
export interface RespuestaFuga {
  token_raw: string
  token_type: string
  label: EtiquetaFuga
}

/**
 * Parsea el cuerpo de la alerta. Devuelve `null` si no tiene la forma esperada
 * —un array de objetos con `token` y `type` string—, para cortar antes de tocar
 * la base con basura.
 */
export function parsearAlertaFuga(bruto: string): EntradaFuga[] | null {
  let datos: unknown
  try {
    datos = JSON.parse(bruto)
  } catch {
    return null
  }
  if (!Array.isArray(datos) || datos.length === 0) return null

  const entradas: EntradaFuga[] = []
  for (const d of datos) {
    if (!d || typeof d !== 'object') return null
    const token = (d as Record<string, unknown>).token
    const type = (d as Record<string, unknown>).type
    if (typeof token !== 'string' || !token || typeof type !== 'string') return null
    const url = (d as Record<string, unknown>).url
    const source = (d as Record<string, unknown>).source
    entradas.push({
      token,
      type,
      url: typeof url === 'string' ? url : undefined,
      source: typeof source === 'string' ? source : undefined,
    })
  }
  return entradas
}

/**
 * Verifica la firma ECDSA de GitHub sobre el cuerpo CRUDO.
 *
 * Es lo único que impide que cualquiera nos mande un POST diciendo «esta clave
 * se filtró» para forzar la revocación de la clave de un tercero: sin la firma
 * de GitHub, la alerta no se atiende. Se verifica sobre los BYTES EXACTOS del
 * cuerpo —no sobre el JSON re-serializado—, porque un solo espacio distinto
 * invalida la firma.
 */
export function verificarFirmaSecretScanning(
  cuerpoBruto: string,
  firmaBase64: string,
  clavePublicaPem: string
): boolean {
  try {
    const verificador = createVerify('SHA256')
    verificador.update(cuerpoBruto)
    verificador.end()
    return verificador.verify(clavePublicaPem, firmaBase64, 'base64')
  } catch {
    // Una firma malformada o una PEM inválida es un «no verifica», no un throw.
    return false
  }
}

export interface EntradaDecision {
  /** ¿El token tiene la forma `mbk_…`? */
  formatoValido: boolean
  /** ¿Existe una fila con ese prefijo? */
  filaExiste: boolean
  /** ¿El secreto COMPLETO cuadra con el hash de esa fila? */
  secretoCoincide: boolean
  /** ¿La clave está viva (ACTIVE)? */
  estaActiva: boolean
}

export interface Decision {
  etiqueta: EtiquetaFuga
  /** Solo se revoca si estaba viva Y el secreto completo coincide. */
  revocar: boolean
}

/**
 * DECIDE qué hacer con un token filtrado. Pura: sin base, sin red.
 *
 * La regla que más importa: NO se actúa nunca solo por el prefijo. El prefijo es
 * público (aparece en el panel, en los logs, en la propia clave), así que
 * revocar por prefijo dejaría que cualquiera tumbara la clave de otra empresa
 * mandando su mitad pública. Solo el secreto COMPLETO correcto revoca. Un
 * prefijo real con un secreto que no cuadra se responde `false_positive` sin
 * pistas: confirmar «ese prefijo existe» ya es media filtración.
 */
export function decidirFuga(e: EntradaDecision): Decision {
  if (!e.formatoValido || !e.filaExiste || !e.secretoCoincide) {
    return { etiqueta: 'false_positive', revocar: false }
  }
  // Es una clave nuestra con su secreto real: true_positive. Solo se revoca si
  // sigue viva; si ya estaba revocada o caducada, no hay nada que cerrar.
  return { etiqueta: 'true_positive', revocar: e.estaActiva }
}
