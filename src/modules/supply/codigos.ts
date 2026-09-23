import { randomBytes } from 'crypto'

/**
 * MEMBEGO SUPPLY · códigos y credenciales.
 *
 * Dos familias que NO se generan igual, y confundirlas es un agujero:
 *
 *  · CÓDIGOS LEGIBLES (`MBG-LITRE-2026-001`, `MBG-PO-000127`). Son para hablar
 *    con el proveedor por teléfono. Predecibles a propósito; no abren nada.
 *
 *  · CREDENCIALES AL PORTADOR (código de voucher, nonce del QR). Valen una
 *    pizza. 24 bytes de `randomBytes` en base64url = 192 bits, igual que los QR
 *    de membresía (`src/modules/qr/token.ts`) y por la misma razón: `cuid()`
 *    está hecho para no colisionar, no para no adivinarse.
 */

// ── Credenciales ────────────────────────────────────────────────────────────

/**
 * Código de un voucher. Sin `@default` en el esquema a propósito: obligar a
 * pasarlo hace que un `create` que lo olvide falle al compilar, no en
 * producción con un código adivinable.
 */
export function nuevoCodigoVoucher(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * Nonce de una sesión de QR. Más corto (16 bytes = 128 bits) porque vive cinco
 * minutos y de un solo uso: la entropía que hace falta es la que resiste un
 * ataque de cinco minutos, y un QR con menos módulos se lee más rápido desde
 * más lejos, que en un mostrador con cola no es un detalle estético.
 */
export function nuevoNonceQr(): string {
  return randomBytes(16).toString('base64url')
}

// ── Códigos legibles ────────────────────────────────────────────────────────

/**
 * Trozo estable del nombre del proveedor para meterlo en un código: sin
 * acentos, sin espacios, en mayúsculas y acotado. "Litré Pizza" → "LITRE".
 */
export function siglaProveedor(nombre: string, largo = 5): string {
  const limpio = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
  return (limpio || 'PROV').slice(0, largo)
}

/**
 * Código de acuerdo: `MBG-LITRE-2026-001`.
 *
 * `secuencia` la calcula quien llama contando los acuerdos de ese proveedor en
 * ese año DENTRO de la transacción. Aquí solo se formatea: mezclar el formato
 * con el conteo haría imposible probar el formato sin una base de datos.
 */
export function codigoAcuerdo(nombreProveedor: string, anio: number, secuencia: number): string {
  return `MBG-${siglaProveedor(nombreProveedor)}-${anio}-${String(secuencia).padStart(3, '0')}`
}

/** Número de orden de compra: `MBG-PO-000127`. */
export function numeroOrden(secuencia: number): string {
  return `MBG-PO-${String(secuencia).padStart(6, '0')}`
}

/**
 * Código de lote. Cuando una orden genera varios lotes (varias líneas), el
 * sufijo los distingue: `MBG-LITRE-2026-001-L2`. El primero va sin sufijo
 * porque el caso abrumadoramente normal es un lote por acuerdo y
 * `MBG-LITRE-2026-001-L1` solo añade ruido a la conversación con el proveedor.
 */
export function codigoLote(codigoDelAcuerdo: string, indice: number): string {
  return indice <= 1 ? codigoDelAcuerdo : `${codigoDelAcuerdo}-L${indice}`
}

// ── Idempotencia ────────────────────────────────────────────────────────────

/**
 * Clave de idempotencia determinista para una operación de dominio.
 *
 * Se arma con las partes que IDENTIFICAN la operación, no con la hora: si el
 * cliente pulsa dos veces «Reclamar» en la campaña de bienvenida, las dos
 * peticiones generan la misma clave, la segunda choca con el índice único y
 * devuelve el derecho que ya existe en vez de emitir otro.
 */
export function claveIdempotencia(...partes: (string | number | null | undefined)[]): string {
  return partes
    .map((p) => (p == null ? '' : String(p)))
    .join(':')
    .slice(0, 190)
}
