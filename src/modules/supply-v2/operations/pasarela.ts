import type { EstadoExterno } from './conciliacion-dominio'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 3 · LO QUE LA PASARELA SABE (§16).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UN PUERTO, NO UNA INTEGRACIÓN
 *
 * Conciliar de verdad exige preguntarle al proveedor qué cobró —no solo creerle
 * lo que nos mandó por webhook—. Pero hoy no hay ninguna pasarela conectada a
 * Supply 2.0, y fingir una API que no existe sería peor que no tenerla: el día
 * que se conecte, el dominio tendría que cambiar para encajar con la de verdad.
 *
 * Así que lo que se define es el CONTRATO:
 *
 *   gateway.listarTransacciones(desde, hasta) → transacciones
 *   gateway.buscarTransaccion(id)             → una, o null
 *
 * Y se implementa para `TEST_GATEWAY` con lo que ya tenemos: el inbox. Los
 * eventos recibidos, firmados y verificados SON lo que esa pasarela nos dijo,
 * y conciliar contra ellos es una conciliación legítima —detecta exactamente
 * los desacuerdos entre lo que nos dijeron y lo que hicimos—. Lo que no
 * detecta, y queda dicho en el informe, es un cobro que la pasarela hizo y del
 * que nunca nos avisó: para eso hace falta su API, y el puerto está listo para
 * recibirla sin tocar el dominio.
 */

/** Una transacción tal como la pasarela la describe. */
export interface TransaccionDePasarela {
  provider: string
  externalTransactionId: string
  /** El evento que la trajo, cuando viene del inbox. */
  externalEventRowId?: string | null
  estado: EstadoExterno
  monto: string | null
  moneda: string | null
  /** La referencia de NUESTRA compra, tal como el proveedor la nombra. */
  orderReference: string | null
  correlationId?: string | null
  vistaEn: Date
}

export interface PuertoDePasarela {
  readonly provider: string
  /** Lo que la pasarela dice haber cobrado en una ventana de tiempo. */
  listarTransacciones(desde: Date, hasta: Date, limite?: number): Promise<TransaccionDePasarela[]>
  /** Una transacción concreta, para la conciliación manual. */
  buscarTransaccion(externalTransactionId: string): Promise<TransaccionDePasarela | null>
}

/** Del vocabulario de nuestro inbox al estado que la matriz entiende. */
export function estadoExternoDeEvento(eventType: string, status?: string | null): EstadoExterno {
  const tipo = eventType.trim().toUpperCase()
  if (tipo === 'PAYMENT_CONFIRMED') return 'PAID'
  if (tipo === 'PAYMENT_REJECTED') return 'FAILED'
  const estado = status?.trim().toUpperCase()
  if (estado === 'APPROVED' || estado === 'CAPTURED' || estado === 'PAID') return 'PAID'
  if (estado === 'DECLINED' || estado === 'REJECTED' || estado === 'FAILED') return 'FAILED'
  if (estado === 'PENDING') return 'PENDING'
  // Lo que no sabemos traducir NO se interpreta: es UNKNOWN, y un UNKNOWN con
  // nuestra compra pagada es precisamente uno de los casos que hay que mirar.
  return 'UNKNOWN'
}
