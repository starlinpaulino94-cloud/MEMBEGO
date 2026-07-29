import { createHash } from 'node:crypto'

/**
 * CARDNET · lógica pura (sin red, sin secretos, sin `server-only`).
 *
 * Aquí vive todo lo que se puede probar sin llamar a CardNET: firmas, formatos,
 * interpretación de códigos y —lo más importante para PCI— la redacción que
 * impide que una tarjeta llegue a un log. `cardnet.ts` (solo-servidor) usa esto
 * y le añade la configuración del entorno y las llamadas HTTP.
 *
 * Se separa a propósito: `cardnet.ts` importa `server-only`, que rompe fuera de
 * un contexto de servidor; este archivo no, así que las pruebas lo pueden
 * cargar. Ver tests/cardnet.test.ts.
 */

// ── Tipos compartidos ───────────────────────────────────────────────────────

export type Ambiente = 'pruebas' | 'produccion'

export interface Vencimiento {
  mes: number
  /** Año de dos dígitos (ej. 27 para 2027). */
  anio2: number
}

export interface DatosTds {
  servertransactionid: string
  eci: string
  avv: string
  programprotocol: string
  dstransactionid: string
  status: string
}

// ── Firmas (verificadas contra los ejemplos de la guía) ─────────────────────

function sha512Hex(cadena: string): string {
  return createHash('sha512').update(cadena, 'utf8').digest('hex')
}

/**
 * Firma de la solicitud de AUTENTICACIÓN.
 *   SHA512(integratorCode + cardExpiryDate + integratorTxId + purchaseAmount + apiKey)
 * `cardExpiryDate` en formato AAMM y `purchaseAmount` en unidades menores
 * (centavos): así se firmó el ejemplo de la guía que este código reproduce.
 */
export function firmaAutenticacion(
  integratorCode: string,
  cardExpiryDate: string,
  integratorTxId: string,
  purchaseAmount: string,
  apiKey: string
): string {
  return sha512Hex(integratorCode + cardExpiryDate + integratorTxId + purchaseAmount + apiKey)
}

/**
 * Firma de la CONSULTA DE ESTADO. Distinta de la anterior: NO lleva la fecha de
 * vencimiento, y usa el integratorTxId ORIGINAL de la autenticación aunque el
 * request mande el threeDSServerTransID.
 *   SHA512(integratorCode + integratorTxId + purchaseAmount + apiKey)
 */
export function firmaEstado(
  integratorCode: string,
  integratorTxId: string,
  purchaseAmount: string,
  apiKey: string
): string {
  return sha512Hex(integratorCode + integratorTxId + purchaseAmount + apiKey)
}

// ── Formato de montos y fechas ──────────────────────────────────────────────

/**
 * El monto para el SERVIDOR 3DS va en unidades menores (centavos), sin punto,
 * con `purchaseExponent: "2"`. RD$500.00 → "50000".
 *
 * VERIFICAR-QA: los ejemplos de la guía usan "500" con exponente 2 (= RD$5.00
 * de prueba). Si en la certificación el 3DS espera el monto con decimales en
 * vez de centavos, este es el único punto a cambiar. La venta (paso 4) sí usa
 * el decimal.
 */
export function montoMenor(pesos: number): string {
  return Math.round(pesos * 100).toString()
}

/** Vencimiento para la VENTA: MM/YY. */
export function vencimientoVenta(mes: number, anio2: number): string {
  return `${String(mes).padStart(2, '0')}/${String(anio2).padStart(2, '0')}`
}

/** Vencimiento para el SERVIDOR 3DS: AAMM. */
export function vencimiento3DS(mes: number, anio2: number): string {
  return `${String(anio2).padStart(2, '0')}${String(mes).padStart(2, '0')}`
}

/**
 * Interpreta lo que el cliente escribió en el campo de vencimiento. Acepta
 * "MM/AA", "MM/AAAA", "MMAA" y espacios. Devuelve null si no es una fecha
 * plausible — que el llamador traduce a "revisa la fecha de tu tarjeta", nunca
 * a un intento de cobro con basura.
 */
export function parseVencimiento(entrada: string): Vencimiento | null {
  const limpio = entrada.replace(/[^\d]/g, '')
  if (limpio.length !== 4 && limpio.length !== 6) return null
  const mes = Number(limpio.slice(0, 2))
  const anio2 = limpio.length === 4 ? Number(limpio.slice(2)) : Number(limpio.slice(4))
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return null
  if (!Number.isInteger(anio2) || anio2 < 0 || anio2 > 99) return null
  return { mes, anio2 }
}

/** Deja solo dígitos del número de tarjeta. No valida la tarjeta: eso lo hace CardNET. */
export function normalizarPan(pan: string): string {
  return pan.replace(/[^\d]/g, '')
}

// ── Redacción: lo único que puede salir a un log ────────────────────────────

/**
 * Devuelve una copia de un objeto SIN los campos sensibles, para que registrar
 * un error nunca escriba una tarjeta. Se usa en todo `console`/Sentry de esta
 * capa. Enmascara el PAN a sus últimos 4 dígitos y borra el CVV por completo.
 */
export function sinTarjeta<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const copia: Record<string, unknown> = { ...obj }
  for (const clave of Object.keys(copia)) {
    const k = clave.toLowerCase()
    const esCvv = k.includes('cvv') || k === 'cvc'
    const esPan =
      (k.includes('card') && (k.includes('number') || k.includes('num'))) ||
      k === 'acctnumber' ||
      k === 'pan'
    if (esCvv) {
      copia[clave] = '***'
    } else if (esPan) {
      const v = String(copia[clave] ?? '')
      copia[clave] = v.length >= 4 ? `****${v.slice(-4)}` : '****'
    }
  }
  return copia as Partial<T>
}

// ── URLs por ambiente ───────────────────────────────────────────────────────

/**
 * URLs por ambiente. Salen de las guías:
 *   · QA:   lab.cardnet.com.do para 3DS y pagos.
 *   · Prod: servicios.cardnet.com.do (3DS) y ecommerce.cardnet.com.do (pagos).
 */
export function urlsDe(ambiente: Ambiente): { pagos: string; tds: string } {
  return ambiente === 'produccion'
    ? {
        pagos: 'https://ecommerce.cardnet.com.do/api/payment',
        tds: 'https://servicios.cardnet.com.do/servicios/3ds/server',
      }
    : {
        pagos: 'https://lab.cardnet.com.do/api/payment',
        tds: 'https://lab.cardnet.com.do/servicios/3ds/server',
      }
}

// ── Interpretación de la respuesta ──────────────────────────────────────────

/**
 * Una venta está aprobada cuando el banco responde '00' Y el código interno de
 * la plataforma es '0000'. Se exigen los dos: '00' sin '0000' es una respuesta
 * a medias que no se debe tratar como cobro.
 */
export function esAprobada(responseCode: string, internalCode: string): boolean {
  return responseCode === '00' && (internalCode === '0000' || internalCode === '')
}

/**
 * Traduce el código del banco a un mensaje para el cliente. La guía es clara:
 * el `internal-response-code` es de uso interno y NO se muestra al usuario; el
 * `response-code` (2 dígitos) sí. Se cubren los más comunes; el resto cae en un
 * mensaje genérico que no filtra detalle del banco.
 */
const MENSAJE_CLIENTE: Record<string, string> = {
  '00': 'Aprobada',
  '01': 'Tu banco pide que lo llames para autorizar el pago.',
  '02': 'Tu banco pide que lo llames para autorizar el pago.',
  '03': 'El comercio no pudo procesar el pago. Contacta al car wash.',
  '04': 'Tu banco rechazó la tarjeta.',
  '05': 'Tu banco rechazó el pago. Intenta con otra tarjeta o llama a tu banco.',
  '13': 'El monto no es válido.',
  '14': 'El número de tarjeta no es válido.',
  '41': 'Tarjeta reportada. Contacta a tu banco.',
  '43': 'Tarjeta reportada. Contacta a tu banco.',
  '51': 'Fondos insuficientes.',
  '54': 'La tarjeta está vencida.',
  '57': 'Tu banco no permite este tipo de transacción.',
  '61': 'Excediste el límite de tu tarjeta.',
  '62': 'Tarjeta restringida por tu banco.',
  '65': 'Excediste la cantidad de intentos. Espera e intenta luego.',
  '91': 'El banco no está disponible en este momento. Intenta más tarde.',
  '96': 'Error del sistema. Intenta de nuevo en un momento.',
}

export function mensajeParaCliente(responseCode: string): string {
  return (
    MENSAJE_CLIENTE[responseCode] ??
    'No se pudo completar el pago. Verifica los datos o intenta con otra tarjeta.'
  )
}
