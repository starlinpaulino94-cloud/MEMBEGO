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
 * Número de pedido de un cliente A MEMBEGO: `MBG-P-000123`.
 *
 * Distinto prefijo que `numeroOrden` —`PO` es lo que Membego COMPRA, `P` lo que
 * Membego VENDE— porque los dos números van a aparecer en la misma pantalla de
 * conciliación, y dos códigos parecidos para los dos lados del dinero es la
 * clase de detalle que hace que alguien liquide contra la fila equivocada.
 */
export function numeroPedido(secuencia: number): string {
  return `MBG-P-${String(secuencia).padStart(6, '0')}`
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

// ── Capa financiera (29-09-2026) ────────────────────────────────────────────
//
// Cada documento financiero lleva su propio prefijo. Van a convivir en la
// misma pantalla de Finanzas y en la misma conversación con el proveedor, y
// «el 000127» no dice si es una orden, un depósito o una liquidación.

function correlativo(prefijo: string, secuencia: number): string {
  return `MBG-${prefijo}-${String(secuencia).padStart(6, '0')}`
}

/** `MBG-DEP-000001` · depósito abierto a un proveedor. */
export function codigoDeposito(secuencia: number): string {
  return correlativo('DEP', secuencia)
}

/** `MBG-FP-000001` · factura del proveedor (correlativo interno de Membego). */
export function codigoFactura(secuencia: number): string {
  return correlativo('FP', secuencia)
}

/** `MBG-CXP-000001` · cuenta por pagar. */
export function codigoCuentaPorPagar(secuencia: number): string {
  return correlativo('CXP', secuencia)
}

/** `MBG-CXC-000001` · cuenta por cobrar. */
export function codigoCuentaPorCobrar(secuencia: number): string {
  return correlativo('CXC', secuencia)
}

/** `MBG-LIQ-000001` · liquidación. */
export function codigoLiquidacion(secuencia: number): string {
  return correlativo('LIQ', secuencia)
}

/** `MBG-CON-000001` · conciliación con el proveedor. */
export function codigoConciliacion(secuencia: number): string {
  return correlativo('CON', secuencia)
}

/** `MBG-V-000001` · venta sin precompra. Prefijo distinto de `P` (pedido). */
export function numeroVenta(secuencia: number): string {
  return correlativo('V', secuencia)
}

/**
 * Código de entrega de una venta sin precompra. Es una CREDENCIAL, igual que
 * el voucher: vale un producto que el cliente ya pagó.
 */
export function nuevoCodigoEntrega(): string {
  return randomBytes(24).toString('base64url')
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
