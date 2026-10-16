/**
 * EL RECIBO QUE VE EL CLIENTE — de un pago con tarjeta hecho en la app o la web.
 *
 * Es el mismo cobro que el personal imprime en la caja (misma venta, mismo número de ticket), contado en palabras de
 * cliente: qué pagó, cuánto, con qué tarjeta y por dónde. Función PURA: lee el `snapshot` congelado de la venta con
 * los mismos sanadores que lo escribieron, y arma también el texto que la app comparte o la web imprime. Así el recibo
 * del cliente y el comprobante del mostrador no pueden contradecirse.
 *
 * NUNCA lleva el número de tarjeta: solo lo que ya quedó en el snapshot (marca, últimos 4, autorización).
 */
import { ETIQUETA_CANAL, esCanalDeCobro, sanearAutorizacion, type CanalDeCobro } from '@/modules/pagos/comprobante-tarjeta'

export interface ReciboDePago {
  ticketNumero: string
  codigo: string
  /** «Tarjeta VISA ••••4242 (en la app)». */
  formaDePago: string
  canal: CanalDeCobro | null
  autorizacion: string | null
  empresaNombre: string
  concepto: string
  monto: number
  /** ISO 8601. */
  fecha: string
  /** El recibo en texto plano, listo para compartir o imprimir. */
  texto: string
}

const fmtRD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** El texto de la forma de pago, sin nada que parezca un número de tarjeta (13+ dígitos seguidos). */
function sanearEtiqueta(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/\d{13,}/g, '').trim()
  return s.length > 0 && s.length <= 80 ? s : null
}

export interface EntradaDeRecibo {
  ticketNumero: string
  codigo: string
  snapshot: unknown
  empresaNombre: string
  /** Respaldo cuando el snapshot no trae el detalle: el nombre del plan. */
  concepto: string | null
  monto: number
  fecha: Date
  timeZone: string
}

export function armarReciboDePago(e: EntradaDeRecibo): ReciboDePago {
  const s = (e.snapshot && typeof e.snapshot === 'object' ? e.snapshot : {}) as Record<string, unknown>
  const canal = esCanalDeCobro(s.canalDeCobro) ? s.canalDeCobro : null
  const formaDePago = sanearEtiqueta(s.metodoCobroLabel) ?? (canal ? `Tarjeta (${ETIQUETA_CANAL[canal]})` : 'Tarjeta')
  const autorizacion = sanearAutorizacion(s.autorizacion)
  const detalle = typeof s.detalle === 'string' && s.detalle.trim() ? s.detalle.trim() : null
  const concepto = detalle ?? e.concepto ?? 'Pago'
  const fechaTexto = new Intl.DateTimeFormat('es-DO', { timeZone: e.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(e.fecha)
  const texto = [
    `RECIBO DE PAGO · ${e.empresaNombre}`,
    `Nº ${e.ticketNumero} · ${e.codigo}`,
    `Fecha: ${fechaTexto}`,
    `Concepto: ${concepto}`,
    `Monto: ${fmtRD(e.monto)}`,
    `Pagado con: ${formaDePago}`,
    ...(autorizacion ? [`Autorización: ${autorizacion}`] : []),
  ].join('\n')
  return {
    ticketNumero: e.ticketNumero,
    codigo: e.codigo,
    formaDePago,
    canal,
    autorizacion,
    empresaNombre: e.empresaNombre,
    concepto,
    monto: e.monto,
    fecha: e.fecha.toISOString(),
    texto,
  }
}
