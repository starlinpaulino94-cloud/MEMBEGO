/**
 * Proveedor de pago CARDNET — modalidad "Botón de pago con pantalla (POST + 3DS)".
 *
 * CÓMO FUNCIONA ESA MODALIDAD (según la documentación pública de CardNET):
 *   1. El comercio pide una SESIÓN a CardNET con el monto y sus credenciales.
 *   2. Se hace un POST del navegador del cliente a la pasarela con esa sesión.
 *   3. El cliente mete la tarjeta EN LA PANTALLA DE CARDNET (los datos de
 *      tarjeta nunca tocan este servidor — eso es lo que mantiene el alcance
 *      PCI al mínimo) y resuelve el desafío 3D Secure.
 *   4. CardNET devuelve al cliente a una URL de retorno del comercio con el
 *      resultado, que hay que VERIFICAR contra CardNET antes de dar por
 *      cobrado nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠ PENDIENTE — ESTE PROVEEDOR NO ESTÁ TERMINADO
 *
 * Falta el manual de integración que CardNET entrega al abrir la cuenta de
 * comercio. Sin él NO se pueden escribir con certeza:
 *   · las URLs exactas de sesión y de la pasarela (pruebas y producción)
 *   · los nombres exactos de los campos del request
 *   · el algoritmo del hash/firma y sobre qué cadena se calcula
 *   · los códigos de respuesta que significan "aprobado"
 *   · cómo se verifica del lado del servidor que la transacción se aprobó
 *
 * Adivinar cualquiera de esos puntos no produce un error visible: produce
 * compras marcadas como pagadas que nunca se cobraron, o cobros que el
 * cliente hizo y el sistema no reconoce. Por eso `isAvailable()` devuelve
 * false mientras falte configuración, y `iniciar()` lanza en vez de
 * inventarse una URL.
 *
 * Cuando llegue el manual, lo único que hay que rellenar está marcado con
 * PENDIENTE-CARDNET. El resto del sistema (intentos, idempotencia, retorno,
 * activación) ya está construido y no cambia.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { PaymentContext, PaymentIntent, PaymentProvider } from './index'
import { registerPaymentProvider } from './index'

export interface CardnetConfig {
  merchantId: string
  terminalId: string
  /** Clave para firmar/validar. NUNCA se registra en logs ni se envía al cliente. */
  authKey: string
  /** 'pruebas' | 'produccion' */
  ambiente: 'pruebas' | 'produccion'
}

/**
 * Lee la configuración del entorno. Se usan variables de entorno y no la base
 * de datos porque `authKey` es un secreto: en la BD quedaría legible para
 * cualquiera con acceso de lectura, y en los respaldos.
 */
export function getCardnetConfig(): CardnetConfig | null {
  const merchantId = process.env.CARDNET_MERCHANT_ID?.trim()
  const terminalId = process.env.CARDNET_TERMINAL_ID?.trim()
  const authKey = process.env.CARDNET_AUTH_KEY?.trim()
  if (!merchantId || !terminalId || !authKey) return null
  return {
    merchantId,
    terminalId,
    authKey,
    ambiente: process.env.CARDNET_AMBIENTE === 'produccion' ? 'produccion' : 'pruebas',
  }
}

/** ¿Está CardNET configurado en este entorno? */
export function cardnetConfigurado(): boolean {
  return getCardnetConfig() !== null
}

/**
 * Crea la sesión de pago en CardNET y devuelve la URL a la que enviar al
 * cliente.
 *
 * PENDIENTE-CARDNET: implementar contra el manual. La firma de la función es
 * la que necesita el resto del sistema y no debería cambiar.
 */
export async function crearSesionCardnet(
  _config: CardnetConfig,
  _datos: { monto: number; moneda: string; referencia: string; urlRetorno: string }
): Promise<{ sessionId: string; urlPasarela: string }> {
  throw new Error(
    'CardNET no está integrado todavía: falta el manual de integración y las credenciales. ' +
      'Ver src/lib/payments/cardnet.ts (PENDIENTE-CARDNET).'
  )
}

/**
 * Verifica CONTRA CARDNET que una transacción fue realmente aprobada.
 *
 * Se hace del lado del servidor a propósito: los datos que llegan en la URL de
 * retorno vienen por el navegador del cliente y son manipulables. Dar por
 * cobrada una compra por lo que dice un parámetro de la URL es la forma más
 * común de regalar producto.
 *
 * PENDIENTE-CARDNET: implementar contra el manual.
 */
export async function verificarTransaccionCardnet(
  _config: CardnetConfig,
  _sessionId: string
): Promise<{
  aprobada: boolean
  autorizacion: string | null
  motivo: string | null
  crudo: unknown
}> {
  throw new Error(
    'Verificación de CardNET no implementada: falta el manual de integración. ' +
      'Ver src/lib/payments/cardnet.ts (PENDIENTE-CARDNET).'
  )
}

export const cardnetProvider: PaymentProvider = {
  kind: 'CARDNET',

  // Doble condición: la capacidad PAGO_CARDNET encendida para la empresa (lo
  // comprueba quien llama) Y las credenciales presentes en el entorno. Sin
  // credenciales no se ofrece, aunque la capacidad esté encendida — así una
  // capacidad encendida por error no deja al cliente en una pantalla rota.
  isAvailable() {
    return cardnetConfigurado()
  },

  async iniciar(ctx: PaymentContext): Promise<PaymentIntent> {
    const config = getCardnetConfig()
    if (!config) {
      throw new Error('CardNET no está configurado en este entorno.')
    }
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
    const { urlPasarela } = await crearSesionCardnet(config, {
      monto: ctx.monto,
      moneda: 'DOP',
      referencia: ctx.referenciaId,
      urlRetorno: `${base}/api/pagos/cardnet/retorno`,
    })
    return { modo: 'redirect', url: urlPasarela, requiereComprobante: false }
  },
}

registerPaymentProvider(cardnetProvider)
