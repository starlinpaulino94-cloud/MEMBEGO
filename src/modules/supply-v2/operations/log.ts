import { registrarEvento } from '@/modules/observabilidad/eventos'
import { sanearError } from './domain'

/**
 * MEMBEGO SUPPLY · SLICE 9 · BLOQUE 2 · LOGS DEL CAMINO EXTERNO (§10).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA LÍNEA PROPIA Y NO SOLO `registrarEvento`
 *
 * `modules/observabilidad/eventos` existe para poder CONTAR —cuántos pagos
 * fallaron hoy— y por eso su `extra` solo admite etiquetas: sin arroba, sin
 * espacios, sin siete dígitos seguidos. Esa forma es la que impide que un
 * correo o un teléfono acabe en los logs, y está bien que sea así.
 *
 * Pero es justo la forma que DESCARTA lo que hace falta para seguir un pago:
 * `externalEventId` (del proveedor, con el formato que él quiera),
 * `correlationId`, `inboxId`, `outboxId`. Son identificadores NUESTROS o del
 * proveedor, no datos de una persona, y sin ellos la pregunta «qué pasó con
 * este aviso» no se puede responder leyendo logs.
 *
 * Así que se hacen las dos cosas, y cada una para lo suyo:
 *
 *   · `registrarEvento` → lo contable (dominio, acción, ok, motivo). Dimensiones
 *     en forma de etiqueta, como el resto de MembeGo.
 *   · esta línea `sv2`  → lo trazable: los identificadores del camino, con un
 *     juego de campos FIJO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ NO PUEDE SALIR POR AQUÍ
 *
 * El juego de campos es cerrado: no hay un `extra` libre ni se acepta el cuerpo
 * del evento. No se puede registrar una firma, una cabecera de autorización, un
 * secreto ni un payload, porque no hay ningún campo donde quepan. Es la misma
 * decisión de `saneaExtra`: una FORMA que solo admite lo que queremos, en vez
 * de una lista de prohibidos que siempre se queda corta. El único texto libre
 * es `errorCode`, y pasa por `sanearError`.
 */

export interface LineaSupply {
  /** Qué paso del camino es: `recibido`, `procesado`, `entregado`… */
  event: string
  provider?: string | null
  externalEventId?: string | null
  correlationId?: string | null
  inboxId?: string | null
  outboxId?: string | null
  attempt?: number | null
  status?: string | null
  /** Clasificación del fallo, ya saneada. Nunca el error crudo del proveedor. */
  errorCode?: string | null
}

/** Lo más largo que se escribe de un identificador ajeno. */
const MAX_ID = 128

/**
 * La línea, como función pura, para poder probar que lo prohibido no sale.
 *
 * `sv2` al principio es lo que permite filtrar estas líneas entre todo el ruido
 * de un log de producción, igual que `evt` en la observabilidad general.
 */
export function lineaSupply(l: LineaSupply): string {
  const campos: Record<string, string | number> = { event: recorta(l.event) }
  if (l.provider) campos.provider = recorta(l.provider)
  if (l.externalEventId) campos.externalEventId = recorta(l.externalEventId)
  if (l.correlationId) campos.correlationId = recorta(l.correlationId)
  if (l.inboxId) campos.inboxId = recorta(l.inboxId)
  if (l.outboxId) campos.outboxId = recorta(l.outboxId)
  if (typeof l.attempt === 'number' && Number.isFinite(l.attempt)) campos.attempt = l.attempt
  if (l.status) campos.status = recorta(l.status)
  if (l.errorCode) campos.errorCode = recorta(sanearError(l.errorCode))
  return `sv2 ${JSON.stringify(campos)}`
}

/**
 * Escribe la línea.
 *
 * `console.log` con la excepción explícita del linter, por la misma razón que
 * `registrarEvento`: la regla `no-console` existe para que nadie deje
 * depuración olvidada, y esto es una salida estructurada y deliberada. Usar
 * `warn` o `error` para esquivar el linter llenaría el panel de errores de
 * líneas que describen el sistema funcionando bien.
 *
 * Nunca lanza: un log que tumba el camino del dinero es peor que un log
 * perdido.
 */
export function anotarSupply(l: LineaSupply): void {
  try {
    // eslint-disable-next-line no-console
    console.log(lineaSupply(l))
  } catch {
    /* si ni esto se puede serializar, se pierde la línea y el pago sigue */
  }
}

/**
 * Lo mismo, más el evento contable.
 *
 * `dominio: 'pago'` porque es lo que esto es: el camino por el que un pago
 * externo llega a Membego. Las dimensiones van en forma de etiqueta —proveedor
 * y tipo, nada identificativo— y `registrarEvento` descarta en silencio lo que
 * no encaje, así que no hay riesgo de que un identificador se escape por ahí.
 */
export function anotarYContar(
  l: LineaSupply,
  contable: { accion: string; ok: boolean; motivo?: string }
): void {
  anotarSupply(l)
  registrarEvento({
    dominio: 'pago',
    accion: contable.accion,
    ok: contable.ok,
    motivo: contable.motivo,
    extra: {
      proveedor: (l.provider ?? 'desconocido').toLowerCase(),
      intento: typeof l.attempt === 'number' ? l.attempt : 0,
    },
  })
}

function recorta(v: string): string {
  const limpio = v.replace(/[\r\n]+/g, ' ').trim()
  return limpio.length > MAX_ID ? `${limpio.slice(0, MAX_ID)}…` : limpio
}
