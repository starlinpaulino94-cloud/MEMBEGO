/**
 * MEMBEGO SUPPLY · las reglas PURAS del cobro a nombre de la plataforma.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ESTÁ SEPARADO DE `cobro.ts`
 *
 * Por el mismo motivo que `avisos.ts` está separado de `notificar.ts`: la parte
 * que se rompe en silencio es la que decide, no la que escribe.
 *
 * `cobro.ts` es `server-only` —abre transacciones— y eso lo hace imposible de
 * importar desde una prueba. Si la comparación de montos viviera allí, la única
 * forma de comprobarla sería leer el archivo como texto, que verifica que la
 * línea existe pero no que la línea acierte. Y esto es aritmética de DINERO: es
 * exactamente lo que hay que ejecutar, no mirar.
 */

/** Los estados por los que pasa un pedido de un cliente a Membego. */
export type EstadoPedido =
  | 'INICIADO'
  | 'EN_REVISION'
  | 'PAGADO'
  | 'RECHAZADO'
  | 'EXPIRADO'
  | 'CANCELADO'

/**
 * Compara dos montos de dinero con una tolerancia de un centavo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ES `===`, Y POR QUÉ LA TOLERANCIA ES TAN ESTRECHA
 *
 * Los montos llegan del formulario como `number` y vuelven de la base como
 * `Decimal`. Comparar con `===` haría que 399 y 398.99999999999994 fueran
 * distintos, y un pago correcto se rechazaría por un error de coma flotante que
 * nadie puede ver en pantalla.
 *
 * Un centavo es el ancho justo: absorbe la aritmética binaria y no absorbe nada
 * más. Con una tolerancia del 1% —que parece razonable— un comprobante de
 * RD$395 pasaría por un pedido de RD$399, y Membego regalaría cuatro pesos por
 * venta sin que aparezca en ningún descuadre.
 */
export function montoCuadra(visto: number, esperado: number): boolean {
  if (!Number.isFinite(visto) || !Number.isFinite(esperado)) return false
  return Math.abs(visto - esperado) < 0.01
}

/**
 * Qué transiciones de estado son legales.
 *
 * Se escribe como tabla y no como una cadena de `if` porque así se puede LEER
 * de un vistazo qué NO se puede hacer, que es la pregunta que importa: de
 * PAGADO no se sale (el derecho ya está emitido y el cliente ya tiene su
 * voucher), y de EXPIRADO tampoco (la unidad volvió al pool y puede estar
 * vendida a otro).
 */
export const TRANSICIONES_PEDIDO: Record<EstadoPedido, readonly EstadoPedido[]> = {
  INICIADO: ['EN_REVISION', 'RECHAZADO', 'EXPIRADO', 'CANCELADO'],
  EN_REVISION: ['PAGADO', 'RECHAZADO', 'EXPIRADO'],
  // Los cuatro finales. Un pedido que llegó aquí no vuelve a moverse: si hay que
  // devolver dinero, eso es un reembolso —un hecho nuevo, con su propio rastro—
  // y no un pedido que retrocede de estado.
  PAGADO: [],
  RECHAZADO: [],
  EXPIRADO: [],
  CANCELADO: [],
}

/** ¿Se puede pasar de `desde` a `hacia`? */
export function transicionLegal(desde: EstadoPedido, hacia: EstadoPedido): boolean {
  return TRANSICIONES_PEDIDO[desde].includes(hacia)
}

/** Un pedido en un estado final ya no se toca. */
export function esFinal(estado: EstadoPedido): boolean {
  return TRANSICIONES_PEDIDO[estado].length === 0
}

/**
 * Lo que el cliente lee de su propio pedido.
 *
 * El texto de RECHAZADO no lleva el motivo pegado: el motivo lo escribe una
 * persona y puede decir cualquier cosa, así que se muestra aparte y no
 * concatenado dentro de una frase que parezca de la plataforma.
 */
export const TEXTO_ESTADO_PEDIDO: Record<EstadoPedido, string> = {
  INICIADO: 'Esperando tu comprobante',
  EN_REVISION: 'Estamos verificando tu pago',
  PAGADO: 'Pago confirmado. Tu beneficio ya está listo',
  RECHAZADO: 'No pudimos confirmar el pago',
  EXPIRADO: 'El tiempo se agotó y la unidad volvió a estar disponible',
  CANCELADO: 'Cancelaste este pedido',
}

/**
 * El desglose de una venta de unidad COMPLETA, para no confundirla nunca con un
 * subsidio (Fase 24 y ADR-0003).
 *
 * En una venta completa el comercio NO recibe nada del cliente: ya cobró por
 * contrato. Lo que el cliente paga va entero a Membego, y la diferencia con el
 * costo es el margen. Si esto devolviera algo distinto de 0 en
 * `aporteClienteAlComercio`, sería un subsidio, y los dos no se mezclan.
 */
export interface DesgloseVenta {
  precioCliente: number
  costoMembego: number
  margen: number
  aporteClienteAlComercio: number
}

export function desglosarVenta(precioCliente: number, costoMembego: number): DesgloseVenta {
  if (!Number.isFinite(precioCliente) || precioCliente < 0) {
    throw new Error('El precio al cliente no puede ser negativo.')
  }
  if (!Number.isFinite(costoMembego) || costoMembego < 0) {
    throw new Error('El costo de Membego no puede ser negativo.')
  }
  return {
    precioCliente,
    costoMembego,
    // Puede ser NEGATIVO y no se corrige: vender por debajo del costo es una
    // decisión comercial legítima (liquidar un lote que vence), y redondearlo a
    // cero escondería justo la pérdida que hay que ver.
    margen: Number((precioCliente - costoMembego).toFixed(2)),
    aporteClienteAlComercio: 0,
  }
}
