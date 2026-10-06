import { createHmac } from 'node:crypto'
import { igualesSeguro } from '@/lib/webhooks/svix'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 2 · AUTENTICIDAD Y FRESCURA (§2 y §3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ES LA PRIMERA PUERTA Y NO UNA COMPROBACIÓN MÁS
 *
 * Un endpoint de webhooks es público por necesidad: una pasarela no puede
 * llevar credenciales nuestras. Sin firma, cualquiera que descubra la URL puede
 * mandar «la orden MBG-SO-000123 está pagada» y cobrarse una compra gratis. La
 * firma es LO ÚNICO que separa «un aviso de pago» de «un POST que alguien nos
 * mandó», y por eso se verifica ANTES de tocar la base de datos, antes de
 * parsear el cuerpo como objeto de confianza y antes de registrar nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA FIRMA SE CALCULA SOBRE LOS BYTES QUE LLEGARON
 *
 * Nunca sobre un JSON reserializado. `JSON.parse` + `JSON.stringify` cambia
 * espacios, orden de claves y notación de números: la firma no cuadraría nunca
 * y el único arreglo a mano sería dejar de verificarla. El cuerpo crudo se lee
 * una vez con `request.text()` y es lo que se firma y lo que se guarda.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA IDEMPOTENCIA DEL BLOQUE 1 NO SUSTITUYE A ESTO
 *
 * El índice único evita la CONSECUENCIA duplicada de un evento repetido. No
 * dice nada de un evento REPRODUCIDO: alguien que capturó una petición válida
 * de ayer y la reenvía hoy manda un evento que nunca habíamos visto —otra
 * identidad, otra fila— y la idempotencia lo deja pasar tan contento. Lo que
 * cierra eso es la ventana de tiempo FIRMADA: el instante va dentro de lo
 * firmado, así que no se puede mover sin romper la firma.
 */

/** Lo que el endpoint le entrega al verificador. Nada de objetos parseados. */
export interface PeticionFirmada {
  provider: string
  /** Los bytes exactos del cuerpo, tal como llegaron. */
  cuerpoCrudo: string
  /** Cabeceras de la petición, en minúsculas. */
  cabeceras: Record<string, string | null>
  /** Ahora, para poder probar la ventana sin esperar. */
  ahora: Date
}

export type ResultadoVerificacion =
  | { ok: true; firmadoEn: Date }
  | { ok: false; codigo: 'INVALID_SIGNATURE' | 'REPLAY_REJECTED'; motivo: string }

/**
 * El contrato. Un proveedor nuevo implementa esto y no toca nada más: ni el
 * endpoint, ni el inbox, ni el procesador.
 */
export interface VerificadorDeEventos {
  readonly provider: string
  /** Cabeceras sin las que no merece la pena ni intentarlo. */
  readonly cabecerasRequeridas: readonly string[]
  verificar(p: PeticionFirmada): Promise<ResultadoVerificacion>
}

/**
 * Ventana de frescura, en segundos. Configurable porque depende del proveedor
 * y del reloj de los dos lados; cinco minutos es lo que usan Stripe, Svix y el
 * webhook de correo que ya tenemos.
 */
export function toleranciaSegundos(): number {
  const bruto = Number(process.env.SUPPLY_V2_WEBHOOK_TOLERANCIA_S)
  return Number.isFinite(bruto) && bruto > 0 ? Math.floor(bruto) : 5 * 60
}

/** Lo más grande que aceptamos por el cuerpo. Un aviso de pago son dos líneas. */
export function maxBytesCuerpo(): number {
  const bruto = Number(process.env.SUPPLY_V2_WEBHOOK_MAX_BYTES)
  return Number.isFinite(bruto) && bruto > 0 ? Math.floor(bruto) : 64 * 1024
}

/**
 * Comprueba que el instante firmado cae dentro de la ventana.
 *
 * Se rechaza lo viejo Y lo del futuro: un reloj adelantado en el emisor —o un
 * atacante que pone un timestamp de mañana— abriría una ventana de reenvío de
 * duración arbitraria.
 */
export function dentroDeVentana(
  firmadoEnSegundos: number,
  ahora: Date,
  tolerancia = toleranciaSegundos()
): boolean {
  if (!Number.isFinite(firmadoEnSegundos)) return false
  const ahoraS = Math.floor(ahora.getTime() / 1000)
  return Math.abs(ahoraS - firmadoEnSegundos) <= tolerancia
}

/**
 * HMAC-SHA256 en hexadecimal sobre `${timestamp}.${cuerpo}`.
 *
 * El instante va DENTRO de lo firmado: eso es lo que hace que no se pueda
 * mover para reenviar un evento viejo. Es el mismo esquema que Stripe, y el
 * mismo que `lib/webhooks/svix.ts` con otra codificación.
 */
export function firmaHmac(secreto: string, timestamp: string, cuerpoCrudo: string): string {
  return createHmac('sha256', secreto).update(`${timestamp}.${cuerpoCrudo}`).digest('hex')
}

/**
 * EL PROVEEDOR DE PRUEBA.
 *
 * Existe para demostrar la arquitectura con una firma de verdad, no para
 * fingir una integración que Supply todavía no tiene. CardNET sigue siendo una
 * integración de V1 **no conectada** a Supply 2.0 (ver el informe).
 *
 * Cabeceras:
 *   x-sv2-timestamp  unix en segundos, lo FIRMADO
 *   x-sv2-signature  `v1=<hex>`; admite varias separadas por espacio para
 *                    poder rotar el secreto sin cortar el servicio
 */
export const VERIFICADOR_TEST_GATEWAY: VerificadorDeEventos = {
  provider: 'TEST_GATEWAY',
  cabecerasRequeridas: ['x-sv2-timestamp', 'x-sv2-signature'],

  async verificar(p: PeticionFirmada): Promise<ResultadoVerificacion> {
    const secretos = secretosDe('SUPPLY_V2_TEST_GATEWAY_SECRET')
    if (secretos.length === 0) {
      // Sin secreto no se puede verificar, y lo que NO se hace es dejar pasar.
      // Fallar cerrado aquí significa que una configuración olvidada deja el
      // webhook inútil; dejar pasar significaría dejarlo abierto.
      return { ok: false, codigo: 'INVALID_SIGNATURE', motivo: 'secreto sin configurar' }
    }

    const ts = p.cabeceras['x-sv2-timestamp']
    const firma = p.cabeceras['x-sv2-signature']
    if (!ts || !firma) {
      return { ok: false, codigo: 'INVALID_SIGNATURE', motivo: 'faltan cabeceras de firma' }
    }

    const segundos = Number(ts)
    if (!Number.isFinite(segundos) || !Number.isInteger(segundos)) {
      return { ok: false, codigo: 'INVALID_SIGNATURE', motivo: 'timestamp no numérico' }
    }

    // ORDEN A PROPÓSITO: primero la firma, después la ventana.
    //
    // Si se comprobara la ventana antes, un timestamp cualquiera —sin firma
    // válida— decidiría si contestamos 400 (vencido) o 401 (firma mala), y eso
    // le diría a quien prueba cuál de las dos cosas tiene mal. Verificando
    // primero la firma, REPLAY_REJECTED solo se puede provocar con una petición
    // auténtica, que es justo lo que significa.
    const esperadas = secretos.map((s) => firmaHmac(s, ts, p.cuerpoCrudo))
    const presentadas = firma
      .split(' ')
      .map((parte) => {
        const [version, valor] = parte.split('=')
        return version === 'v1' && valor ? valor : null
      })
      .filter((x): x is string => Boolean(x))

    const cuadra = presentadas.some((dada) => esperadas.some((esp) => igualesSeguro(dada, esp)))
    if (!cuadra) return { ok: false, codigo: 'INVALID_SIGNATURE', motivo: 'firma no coincide' }

    if (!dentroDeVentana(segundos, p.ahora)) {
      return { ok: false, codigo: 'REPLAY_REJECTED', motivo: 'fuera de la ventana de frescura' }
    }

    return { ok: true, firmadoEn: new Date(segundos * 1000) }
  },
}

/**
 * Los secretos de un proveedor, admitiendo rotación: `SECRETO` o
 * `SECRETO_ANTERIOR,SECRETO_NUEVO`. Sin rotación, cambiar el secreto obliga a
 * elegir entre perder los eventos en vuelo o dejar de verificar un rato.
 */
function secretosDe(variable: string): string[] {
  return (process.env[variable] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

const VERIFICADORES: readonly VerificadorDeEventos[] = [VERIFICADOR_TEST_GATEWAY]

/**
 * El verificador de un proveedor, o null si no lo conocemos.
 *
 * Un proveedor desconocido NO se verifica «de alguna manera»: se contesta que
 * no existe. Aceptar sin verificar lo que no sabemos verificar es exactamente
 * el agujero que la firma cierra.
 */
export function verificadorDe(provider: string): VerificadorDeEventos | null {
  const buscado = provider.trim().toUpperCase()
  return VERIFICADORES.find((v) => v.provider === buscado) ?? null
}

export function proveedoresConocidos(): readonly string[] {
  return VERIFICADORES.map((v) => v.provider)
}
