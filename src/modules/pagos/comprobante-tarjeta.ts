/**
 * COMPROBANTE DE UN COBRO CON TARJETA — el contenido de la venta, en una función PURA.
 *
 * Un cobro aprobado en pasarela (app, web, renovación automática) deja una venta `SALE` con método
 * TARJETA en el libro (`transactions`) y, con ella, un comprobante imprimible por el mismo motor de
 * recibos que usa la caja. Este módulo decide QUÉ lleva ese comprobante; no escribe nada ni importa
 * Prisma ni Next, para que se pruebe sin base de datos.
 *
 * LA REGLA QUE IMPORTA: el comprobante NUNCA lleva el número de tarjeta. Solo la marca, los últimos
 * cuatro dígitos y la autorización de la pasarela. Todo lo que llega de fuera pasa por un sanador que
 * descarta lo que no tenga exactamente esa forma: si un día la respuesta de la pasarela trae un número
 * completo en el campo equivocado, no llega al comprobante, a la base ni a una impresora.
 */

/** Por dónde entró el cobro. Lo dice el comprobante y lo agrupa el cierre del día. */
export const CANALES_DE_COBRO = ['APP', 'WEB', 'RENOVACION_AUTOMATICA'] as const
export type CanalDeCobro = (typeof CANALES_DE_COBRO)[number]

export const ETIQUETA_CANAL: Readonly<Record<CanalDeCobro, string>> = {
  APP: 'en la app',
  WEB: 'en la web',
  RENOVACION_AUTOMATICA: 'renovación automática',
}

export function esCanalDeCobro(v: unknown): v is CanalDeCobro {
  return typeof v === 'string' && (CANALES_DE_COBRO as readonly string[]).includes(v)
}

/** Marcas que se dejan imprimir, tal como las escribe el comprobante. Cualquier otra cosa se descarta. */
const MARCAS: Readonly<Record<string, string>> = {
  VISA: 'VISA',
  MASTERCARD: 'Mastercard',
  MASTER: 'Mastercard',
  AMEX: 'American Express',
  AMERICANEXPRESS: 'American Express',
  DISCOVER: 'Discover',
  DINERS: 'Diners Club',
  DINERSCLUB: 'Diners Club',
  UNIONPAY: 'UnionPay',
  JCB: 'JCB',
}

export interface TarjetaDeComprobante {
  marca: string | null
  /** Exactamente cuatro dígitos, o null. Nunca más. */
  ultimos4: string | null
}

/** Deja pasar solo una marca conocida y cuatro dígitos exactos. Todo lo demás se pierde A PROPÓSITO. */
export function sanearTarjeta(entrada: { marca?: unknown; ultimos4?: unknown } | null | undefined): TarjetaDeComprobante {
  const marcaCruda = typeof entrada?.marca === 'string' ? entrada.marca.toUpperCase().replace(/[^A-Z]/g, '') : ''
  const u4 = typeof entrada?.ultimos4 === 'string' || typeof entrada?.ultimos4 === 'number' ? String(entrada.ultimos4).trim() : ''
  return {
    marca: MARCAS[marcaCruda] ?? null,
    ultimos4: /^\d{4}$/.test(u4) ? u4 : null,
  }
}

/** La autorización de la pasarela: letras, dígitos y guion, hasta 24. Un valor con otra forma no se imprime. */
export function sanearAutorizacion(v: unknown): string | null {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''
  return /^[A-Za-z0-9-]{1,24}$/.test(s) ? s : null
}

/** «Tarjeta VISA ••••4242 (en la app)». Sin marca ni dígitos queda «Tarjeta (en la app)». */
export function etiquetaDeCobroConTarjeta(canal: CanalDeCobro, tarjeta: TarjetaDeComprobante): string {
  const partes = ['Tarjeta']
  if (tarjeta.marca) partes.push(tarjeta.marca)
  if (tarjeta.ultimos4) partes.push(`••••${tarjeta.ultimos4}`)
  return `${partes.join(' ')} (${ETIQUETA_CANAL[canal]})`
}

export interface EntradaDeComprobanteTarjeta {
  /** Qué se pagó: «Membresía Plan Oro». */
  detalle: string
  clienteNombre: string
  monto: number
  canal: CanalDeCobro
  /** `pago_intentos.id`: la identidad del cobro y el ancla de idempotencia de la venta. */
  pagoIntentoId: string
  autorizacion?: unknown
  tarjeta?: { marca?: unknown; ultimos4?: unknown } | null
  sucursalNombre?: string | null
  empleadoNombre?: string | null
  observaciones?: string | null
}

const dos = (n: number) => n.toFixed(2)

/**
 * El `snapshot` congelado de la venta (lo que el motor de recibos imprime: `docs/FASE_E4…`). Mismas
 * claves que `registrarVentaConfirmada` para que el recibo, la factura A4 y la reimpresión funcionen
 * sin tocar nada, más lo propio del cobro con tarjeta.
 */
export function snapshotDeCobroConTarjeta(e: EntradaDeComprobanteTarjeta): Record<string, unknown> {
  const tarjeta = sanearTarjeta(e.tarjeta)
  const autorizacion = sanearAutorizacion(e.autorizacion)
  return {
    detalle: e.detalle,
    cliente: e.clienteNombre,
    empleado: e.empleadoNombre ?? undefined,
    sucursal: e.sucursalNombre ?? undefined,
    servicio: e.detalle,
    observaciones: e.observaciones ?? undefined,
    lineas: [{ descripcion: e.detalle, cantidad: 1, precioUnitario: e.monto, descuento: 0, total: e.monto }],
    subtotal: dos(e.monto),
    total: dos(e.monto),
    metodoCobroLabel: etiquetaDeCobroConTarjeta(e.canal, tarjeta),
    referenciaPago: autorizacion ? `Aut. ${autorizacion}` : undefined,
    // Lo propio del cobro con tarjeta: trazabilidad pasarela → ticket. Nunca el número de tarjeta.
    canalDeCobro: e.canal,
    autorizacion: autorizacion ?? undefined,
    tarjeta: tarjeta.marca || tarjeta.ultimos4 ? tarjeta : undefined,
    pagoIntentoId: e.pagoIntentoId,
  }
}
