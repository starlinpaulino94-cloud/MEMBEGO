import { decimal, type Decimal } from '../core/dinero'
import { montoCuadra } from '../core/precios'

/**
 * MEMBEGO SUPPLY · SLICE 9 · BLOQUE 3 · LA DECISIÓN, EN UN SOLO SITIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA PREGUNTA QUE ESTE ARCHIVO CONTESTA
 *
 * ¿Qué hace Membego cuando lo que dice la pasarela y lo que dice nuestra base
 * no coinciden?
 *
 * La respuesta NO puede estar repartida en condiciones sueltas por tres
 * servicios. Si lo estuviera, nadie podría decir con qué criterio se decide, y
 * cada caso nuevo se resolvería con un `if` más en el sitio donde apareció.
 * Aquí está la matriz completa, como función pura: sin base de datos, sin red,
 * y por tanto comprobable caso por caso.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PRINCIPIO, QUE NO SE NEGOCIA
 *
 *   «la pasarela dice PAGADO» NO es «ponlo en PAGADO».
 *
 * Cuando nuestro estado es ambiguo, la diferencia se convierte en una COSA
 * INVESTIGABLE —un incidente con dueño, severidad y motivo— y una persona
 * decide. Y al revés: si nosotros decimos PAGADO y la pasarela no sabe nada,
 * tampoco se ignora. Las dos direcciones del desacuerdo cuentan.
 *
 * La única automatización admitida es la del camino seguro completo: un evento
 * que pasó firma, frescura, identidad, orden, monto y moneda ya está
 * conciliado por construcción, y ahí el Bloque 2 ejecuta el servicio oficial
 * de confirmación. Lo que llega AQUÍ es lo que no cuadró.
 */

/** Lo que nuestra base dice de la compra. */
export type EstadoInterno =
  | 'PENDING'
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'PAYMENT_REJECTED'
  /** No encontramos la compra que el evento dice. */
  | 'UNKNOWN'

/** Lo que la pasarela dice del pago, ya traducido por el adaptador. */
export type EstadoExterno = 'PAID' | 'PENDING' | 'FAILED' | 'UNKNOWN'

export type ResultadoConciliacion =
  /** Los dos lados dicen lo mismo. No hay nada que hacer. */
  | 'MATCHED'
  /** No coinciden. Se abre incidente y decide una persona. */
  | 'MISMATCH'
  /** Todavía no se puede decir. Se vuelve a mirar más tarde. */
  | 'WAITING'
  /** No es un desacuerdo: es un evento que no nos concierne. */
  | 'IGNORED'

export type Severidad = 'LOW' | 'MEDIUM' | 'HIGH'

/**
 * Por qué no cuadra. Texto y no enum a propósito: añadir un motivo nuevo no
 * debe pedir una migración, igual que `provider` en el Bloque 2.
 */
export const MOTIVOS = {
  /** La pasarela cobró algo que no es nuestro total. */
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  /** Cobró en otra moneda. */
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  /** Dice una compra que no existe. */
  UNKNOWN_ORDER: 'UNKNOWN_ORDER',
  /** Los dos estados son incompatibles (nosotros PAGADO, él FALLIDO…). */
  STATE_CONFLICT: 'STATE_CONFLICT',
  /** La misma transacción del proveedor apareció en otra compra. */
  DUPLICATE_TRANSACTION: 'DUPLICATE_TRANSACTION',
} as const
export type Motivo = (typeof MOTIVOS)[keyof typeof MOTIVOS]

export interface Veredicto {
  resultado: ResultadoConciliacion
  motivo: Motivo | null
  severidad: Severidad
  /** Para la bitácora y el panel: en una frase, sin tecnicismos. */
  explicacion: string
}

export interface LadoInterno {
  estado: EstadoInterno
  /** Nuestro total. Null cuando no hay compra. */
  total?: Decimal | string | null
  moneda?: string | null
}

export interface LadoExterno {
  estado: EstadoExterno
  /** Lo que la pasarela dice que cobró. */
  monto?: Decimal | string | number | null
  moneda?: string | null
}

/**
 * LA MATRIZ. Se lee de arriba abajo y el primer caso que encaja manda.
 *
 * El orden importa y es deliberado:
 *
 *   1. Sin compra no hay nada con lo que comparar: si además dice que cobró,
 *      es lo más grave que puede pasar —hay dinero de un cliente en la
 *      pasarela y no sabemos de qué es—.
 *   2. Un desacuerdo de ESTADO se decide antes que el monto: si él dice
 *      FALLIDO y nosotros PAGADO, comparar importes sería contestar la
 *      pregunta equivocada.
 *   3. El monto y la moneda solo se comparan cuando los dos lados afirman que
 *      hubo cobro. Comparar el importe de un pago que no ocurrió no dice nada.
 */
export function reconciliarEstadoPago(interno: LadoInterno, externo: LadoExterno): Veredicto {
  // ── 1 · no sabemos de qué compra habla ────────────────────────────────────
  if (interno.estado === 'UNKNOWN') {
    if (externo.estado === 'PAID') {
      return {
        resultado: 'MISMATCH',
        motivo: MOTIVOS.UNKNOWN_ORDER,
        severidad: 'HIGH',
        explicacion: 'La pasarela dice que cobró una compra que no existe en Membego.',
      }
    }
    // Sin cobro y sin compra no hay nada que investigar: no es asunto nuestro.
    return {
      resultado: 'IGNORED',
      motivo: null,
      severidad: 'LOW',
      explicacion: 'El evento no se refiere a ninguna compra de Membego y no reporta cobro.',
    }
  }

  // ── 2 · la pasarela todavía no sabe ───────────────────────────────────────
  if (externo.estado === 'UNKNOWN' || externo.estado === 'PENDING') {
    if (interno.estado === 'PAID') {
      // ESTA es la dirección que se suele ignorar, y no se va a ignorar: para
      // nosotros el cliente pagó y recibió lo que compró; para la pasarela, no
      // hay cobro firme. Si acaba en nada, es dinero que Membego entregó sin
      // haber cobrado.
      return {
        resultado: 'MISMATCH',
        motivo: MOTIVOS.STATE_CONFLICT,
        severidad: 'HIGH',
        explicacion: 'Membego dio la compra por pagada y la pasarela no confirma el cobro.',
      }
    }
    return {
      resultado: 'WAITING',
      motivo: null,
      severidad: 'LOW',
      explicacion: 'La pasarela aún no resuelve el cobro: se vuelve a mirar más tarde.',
    }
  }

  // ── 3 · la pasarela dice que NO se cobró ──────────────────────────────────
  if (externo.estado === 'FAILED') {
    if (interno.estado === 'PAID') {
      return {
        resultado: 'MISMATCH',
        motivo: MOTIVOS.STATE_CONFLICT,
        severidad: 'HIGH',
        explicacion: 'Membego dio la compra por pagada y la pasarela dice que el cobro falló.',
      }
    }
    // Nosotros tampoco la dimos por pagada: los dos lados dicen lo mismo.
    return {
      resultado: 'MATCHED',
      motivo: null,
      severidad: 'LOW',
      explicacion: 'El cobro falló y la compra no está pagada: los dos lados coinciden.',
    }
  }

  // ── 4 · la pasarela dice que SÍ se cobró ──────────────────────────────────
  // A partir de aquí `externo.estado === 'PAID'`.
  if (interno.estado === 'CANCELLED' || interno.estado === 'EXPIRED' || interno.estado === 'PAYMENT_REJECTED') {
    return {
      resultado: 'MISMATCH',
      motivo: MOTIVOS.STATE_CONFLICT,
      severidad: 'HIGH',
      explicacion: `La pasarela cobró una compra que en Membego está ${etiquetaInterna(interno.estado)}.`,
    }
  }

  // El dinero solo se compara cuando los dos lados afirman que hubo cobro.
  const dinero = compararDinero(interno, externo)
  if (dinero) return dinero

  if (interno.estado === 'PAID') {
    return {
      resultado: 'MATCHED',
      motivo: null,
      severidad: 'LOW',
      explicacion: 'La compra está pagada y la pasarela confirma el mismo importe.',
    }
  }

  // PENDING / AWAITING_PAYMENT con cobro externo que cuadra en monto y moneda:
  // es el caso que el camino seguro del Bloque 2 ya resuelve. Si llega aquí es
  // porque algo impidió confirmarlo, así que NO se confirma desde la
  // conciliación: se marca para que una persona ejecute el servicio oficial.
  return {
    resultado: 'MISMATCH',
    motivo: MOTIVOS.STATE_CONFLICT,
    severidad: 'MEDIUM',
    explicacion: 'La pasarela cobró el importe correcto y la compra sigue sin confirmarse en Membego.',
  }
}

/**
 * Monto y moneda. Null cuando cuadran o cuando no hay con qué comparar.
 *
 * NUNCA con `Number`: los importes viajan como `Decimal` o como texto y se
 * comparan con el mismo criterio que el checkout (`montoCuadra`, un centavo de
 * tolerancia). Pasarlos por coma flotante es cómo aparecen las diferencias de
 * un centavo que nadie sabe explicar.
 */
export function compararDinero(interno: LadoInterno, externo: LadoExterno): Veredicto | null {
  const nuestraMoneda = normalizarMoneda(interno.moneda)
  const suMoneda = normalizarMoneda(externo.moneda)
  if (nuestraMoneda && suMoneda && nuestraMoneda !== suMoneda) {
    return {
      resultado: 'MISMATCH',
      motivo: MOTIVOS.CURRENCY_MISMATCH,
      severidad: 'HIGH',
      explicacion: `La pasarela cobró en ${suMoneda} y la compra está en ${nuestraMoneda}.`,
    }
  }

  if (interno.total == null) return null
  if (externo.monto == null) {
    // Dice que cobró y no dice cuánto: no se puede dar por bueno.
    return {
      resultado: 'MISMATCH',
      motivo: MOTIVOS.AMOUNT_MISMATCH,
      severidad: 'MEDIUM',
      explicacion: 'La pasarela dice que cobró pero no informa el importe.',
    }
  }

  let cuadra: boolean
  try {
    cuadra = montoCuadra(externo.monto as string, interno.total as string)
  } catch {
    cuadra = false
  }
  if (cuadra) return null

  return {
    resultado: 'MISMATCH',
    motivo: MOTIVOS.AMOUNT_MISMATCH,
    severidad: 'HIGH',
    explicacion: `La pasarela reporta ${textoDeMonto(externo.monto)} y la compra es de ${textoDeMonto(interno.total)}.`,
  }
}

/** La diferencia, para poder ordenarla y sumarla. Null si falta un lado. */
export function diferenciaDeMonto(
  interno: Decimal | string | null | undefined,
  externo: Decimal | string | number | null | undefined
): Decimal | null {
  if (interno == null || externo == null) return null
  try {
    return decimal(externo as string).minus(decimal(interno as string))
  } catch {
    return null
  }
}

/**
 * El veredicto de una transacción que aparece en DOS compras distintas.
 *
 * Es su propio caso porque no se deduce de la matriz: los dos lados pueden
 * cuadrar perfectamente y seguir siendo un problema grave. Un identificador de
 * transacción es único en el sistema del proveedor; verlo en dos compras
 * significa que alguien lo reutilizó, que el proveedor se equivocó, o que
 * estamos a punto de dar por pagadas dos compras con un solo cobro.
 */
export function veredictoDeTransaccionDuplicada(
  externalTransactionId: string,
  ordenOriginal: string
): Veredicto {
  return {
    resultado: 'MISMATCH',
    motivo: MOTIVOS.DUPLICATE_TRANSACTION,
    severidad: 'HIGH',
    explicacion: `La transacción ${externalTransactionId} ya estaba asociada a otra compra (${ordenOriginal}): no se acepta la segunda.`,
  }
}

/** ¿Este veredicto merece abrir un incidente? */
export function abreIncidente(v: Veredicto): boolean {
  return v.resultado === 'MISMATCH'
}

/**
 * IDENTIDAD ESTABLE DEL PROBLEMA.
 *
 * Es lo que impide que cinco entregas del mismo webhook abran cinco
 * incidentes. Deliberadamente NO incluye el `correlationId` ni la fecha: el
 * mismo problema, visto otra vez, es el mismo problema. Sí incluye el motivo,
 * porque «el monto no cuadra» y «la moneda no cuadra» sobre la misma
 * transacción son dos cosas distintas que un operador quiere ver por separado.
 */
export function claveDeIncidente(d: {
  provider: string
  externalTransactionId?: string | null
  externalEventId?: string | null
  orderId?: string | null
  motivo: Motivo
}): string {
  const referencia = d.externalTransactionId?.trim() || d.externalEventId?.trim() || 'sin-referencia'
  return [
    d.provider.trim().toUpperCase(),
    referencia,
    d.orderId?.trim() || 'sin-orden',
    d.motivo,
  ].join(':')
}

/** Estados en los que un incidente sigue necesitando a alguien. */
export const INCIDENTE_VIVO = ['OPEN', 'INVESTIGATING'] as const

/**
 * Las resoluciones posibles, y qué significa cada una.
 *
 * `ACCEPT_EXTERNAL` NO mueve dinero por sí misma: significa «la evidencia de
 * la pasarela es correcta». Mover el dinero es ejecutar el servicio oficial de
 * confirmación, con su candado, su validación de importe y sus derechos. Un
 * `UPDATE` directo a `paymentStatus` desde la resolución de un incidente
 * saltaría todo eso.
 */
export const RESOLUCIONES = {
  /** Lo nuestro es correcto; lo que manda la pasarela no se acepta. */
  ACCEPT_INTERNAL: 'ACCEPT_INTERNAL',
  /** La evidencia externa es correcta → se ejecuta el servicio financiero oficial. */
  ACCEPT_EXTERNAL: 'ACCEPT_EXTERNAL',
  /** No había problema: la detección se equivocó. */
  MARK_FALSE_POSITIVE: 'MARK_FALSE_POSITIVE',
  /** Hace falta una corrección que este flujo no puede hacer solo. */
  MANUAL_CORRECTION_REQUIRED: 'MANUAL_CORRECTION_REQUIRED',
} as const
export type Resolucion = (typeof RESOLUCIONES)[keyof typeof RESOLUCIONES]

/** ¿Esta resolución implica ejecutar el servicio financiero oficial? */
export function exigeServicioFinanciero(r: Resolucion): boolean {
  return r === RESOLUCIONES.ACCEPT_EXTERNAL
}

// ── Internos ────────────────────────────────────────────────────────────────

function normalizarMoneda(m: string | null | undefined): string | null {
  const limpio = m?.trim().toUpperCase()
  return limpio ? limpio : null
}

function textoDeMonto(v: Decimal | string | number): string {
  try {
    return decimal(v as string).toFixed(2)
  } catch {
    return String(v)
  }
}

function etiquetaInterna(e: EstadoInterno): string {
  switch (e) {
    case 'CANCELLED':
      return 'cancelada'
    case 'EXPIRED':
      return 'vencida'
    case 'PAYMENT_REJECTED':
      return 'con el pago rechazado'
    case 'PAID':
      return 'pagada'
    case 'UNKNOWN':
      return 'inexistente'
    default:
      return 'sin pagar'
  }
}
