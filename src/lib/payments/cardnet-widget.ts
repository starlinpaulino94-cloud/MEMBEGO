/**
 * CardNET · LECTURA DEL PAYLOAD DEL WIDGET — núcleo puro.
 *
 * Cuando el cliente termina de digitar su tarjeta, el widget `PWCheckout`
 * dispara `tokenCreated` con un objeto Token. De ahí sale el único dato que
 * permite cobrar. Si esta lectura falla, el cobro NO se intenta: no queda
 * rastro en la base (el intento se registra recién al ir a cobrar) y el
 * cliente ve un error que no dice nada.
 *
 * Vivía dentro del componente React y por eso nunca tuvo pruebas — con una
 * lista de nombres a la que le faltaba justo el bueno. Aquí sí se puede
 * probar contra lo que dice el manual.
 *
 * Referencia: MANUAL TÉCNICO DE TOKENIZACIÓN v1.7 §7.1 (Objeto Token).
 */

/**
 * Nombres posibles del token, en orden de preferencia.
 *
 * `TokenId` es EL nombre documentado: el §7.1 define el objeto Token con el
 * campo `TokenId` («Es el token generado») y el ejemplo oficial del §3.3 lo
 * lee así — `document.getElementById("PWTokenAux").value = token.TokenId`.
 * Las demás grafías se conservan por si una versión del widget difiere.
 */
export const CLAVES_TOKEN = [
  'TokenId',
  'tokenId',
  'Token',
  'token',
  'TrxToken',
  'trxToken',
  'PWToken',
] as const

/** Envoltorios donde algunos proveedores esconden el payload real. */
export const CLAVES_ANIDADAS = ['data', 'Data', 'detail', 'payload', 'Response', 'response'] as const

/**
 * Largo mínimo para creer que algo es un token. Los tokens reales son largos
 * (`OT_01_kYv0qTHck…`, `CT__ESaYPfpM3YF…`); un valor corto en un campo llamado
 * «token» es casi siempre un id numérico o una bandera, y cobrarle a CardNET
 * con eso solo produce un rechazo confuso.
 */
const LARGO_MINIMO = 8

/**
 * Extrae el token del payload de `tokenCreated`: string, JSON en string,
 * objeto plano u objeto anidado.
 */
export function tokenDe(data: unknown, nivel = 0): string {
  if (typeof data === 'string') {
    const s = data.trim()
    if ((s.startsWith('{') || s.startsWith('[')) && nivel < 3) {
      try {
        return tokenDe(JSON.parse(s), nivel + 1)
      } catch {
        return ''
      }
    }
    // En el primer nivel (callback directo del SDK) un string ES el token.
    return nivel === 0 ? s : ''
  }
  if (data && typeof data === 'object' && nivel < 4) {
    const o = data as Record<string, unknown>
    for (const k of CLAVES_TOKEN) {
      const v = o[k]
      if (typeof v === 'string' && v.trim().length > LARGO_MINIMO) return v.trim()
    }
    for (const k of CLAVES_ANIDADAS) {
      if (o[k]) {
        const t = tokenDe(o[k], nivel + 1)
        if (t) return t
      }
    }
  }
  return ''
}

/** Referencias reutilizables de la tarjeta, para la renovación automática. */
export interface RefsTarjeta {
  customerId: string | null
  paymentProfileId: string | null
  token: string | null
  marca: string | null
  ultimos4: string | null
}

/**
 * Saca del payload lo que hace falta para volver a cobrar más adelante.
 *
 * Los nombres salen del objeto Token del manual §7.1: `TokenId`, `Brand`,
 * `Last4`. NUNCA incluye número de tarjeta ni CVV — el widget tampoco los
 * entrega, y este sistema no debe poder llegar a ellos ni por accidente.
 */
export function refsGuardado(data: unknown): RefsTarjeta {
  const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const capas = [o, ...CLAVES_ANIDADAS.map((k) => o[k])].filter(
    (c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object'
  )
  const g = (...ks: string[]) => {
    for (const capa of capas) {
      for (const k of ks) {
        const v = capa[k]
        if (typeof v === 'string' && v) return v
        if (typeof v === 'number') return String(v)
      }
    }
    return null
  }
  return {
    customerId: g('CustomerId', 'customerId'),
    paymentProfileId: g('PaymentProfileId', 'paymentProfileId', 'ProfileId'),
    token: g(...CLAVES_TOKEN),
    marca: g('Brand', 'CardBrand', 'marca'),
    ultimos4: g('Last4', 'LastFour', 'ultimos4'),
  }
}
